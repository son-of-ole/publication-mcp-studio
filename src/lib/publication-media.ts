import { Buffer } from 'node:buffer'
import { getPublicationMediaBucketName, getPublicationPlatform } from '@publication-platform'
import type { PublicationMediaAsset } from '@publication-platform/types'
import { PublicationApiError } from '@/lib/publication-errors'
import { slugifyPublicationTitle } from '@/lib/publication-service'

const PUBLICATION_MEDIA_ROOT = 'publications'

export async function uploadPublicationMedia(input: {
  articleIdentifier?: string
  articleSlug?: string
  fileName: string
  contentType?: string
  dataBase64?: string
  sourceUrl?: string
  altText?: string
  caption?: string
  posterUrl?: string
}) {
  const fileName = sanitizePublicationMediaFileName(input.fileName)

  if (!fileName) {
    throw new PublicationApiError(400, 'media_file_name_missing', 'A media file name is required.')
  }

  const sourceBuffer = await resolvePublicationMediaBuffer(input)
  const contentType = normalizePublicationMediaContentType(input.contentType, fileName)
  const articleSlug = await resolvePublicationMediaArticleSlug(input.articleIdentifier, input.articleSlug)
  const kind = inferPublicationMediaKind(contentType, fileName)
  const embedMarkdown = buildPublicationMediaEmbedMarkdown({
    fileName,
    publicUrl: `/${articleSlug}/${fileName}`,
    kind,
    altText: input.altText,
    caption: input.caption,
    posterUrl: input.posterUrl,
  })
  const asset = await getPublicationPlatform().mediaStore.uploadMedia({
    articleSlug,
    fileName,
    contentType,
    data: sourceBuffer,
    kind,
    embedMarkdown,
  })

  return {
    asset,
  }
}

export async function listPublicationMedia(input: {
  articleIdentifier?: string
  articleSlug?: string
  limit?: number
}) {
  const articleSlug = await resolvePublicationMediaArticleSlug(input.articleIdentifier, input.articleSlug)

  return {
    articleSlug,
    assets: await getPublicationPlatform().mediaStore.listMedia(articleSlug, clampPublicationMediaLimit(input.limit)),
  }
}

export async function deletePublicationMedia(path: string) {
  const normalizedPath = normalizePublicationMediaPath(path)
  await getPublicationPlatform().mediaStore.deleteMedia(normalizedPath)

  return {
    deleted: true,
    bucket: getPublicationPlatform().kind === 'supabase' ? 'article-assets' : getPublicationMediaBucketName(process.env),
    path: normalizedPath,
  }
}

function clampPublicationMediaLimit(limit?: number) {
  if (!limit || Number.isNaN(limit)) {
    return 50
  }

  return Math.min(200, Math.max(1, Math.floor(limit)))
}

async function resolvePublicationMediaArticleSlug(articleIdentifier?: string, articleSlug?: string) {
  const requestedSlug = articleSlug?.trim()

  if (requestedSlug) {
    return slugifyPublicationTitle(requestedSlug)
  }

  const requestedIdentifier = articleIdentifier?.trim()
  if (!requestedIdentifier) {
    return 'shared'
  }

  const article = await getPublicationPlatform().publicationStore.getArticleByIdentifier(requestedIdentifier)
  return article?.slug ? slugifyPublicationTitle(article.slug) : slugifyPublicationTitle(requestedIdentifier)
}

async function resolvePublicationMediaBuffer(input: {
  dataBase64?: string
  sourceUrl?: string
}) {
  const dataBase64 = input.dataBase64?.trim()

  if (dataBase64) {
    const normalizedBase64 = dataBase64.includes(',')
      ? dataBase64.slice(dataBase64.indexOf(',') + 1)
      : dataBase64

    try {
      return Buffer.from(normalizedBase64, 'base64')
    } catch (error) {
      throw new PublicationApiError(400, 'media_base64_invalid', 'The media payload is not valid base64.', error)
    }
  }

  const sourceUrl = input.sourceUrl?.trim()
  if (sourceUrl) {
    const response = await fetch(sourceUrl)

    if (!response.ok) {
      throw new PublicationApiError(
        400,
        'media_source_fetch_failed',
        `Failed to fetch media from "${sourceUrl}": ${response.status} ${response.statusText}.`,
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  throw new PublicationApiError(
    400,
    'media_source_missing',
    'Provide either dataBase64 or sourceUrl when uploading publication media.',
  )
}

function normalizePublicationMediaContentType(contentType: string | undefined, fileName: string) {
  const normalizedContentType = contentType?.trim().toLowerCase()

  if (normalizedContentType) {
    return normalizedContentType
  }

  const lowerCaseFileName = fileName.toLowerCase()

  if (lowerCaseFileName.endsWith('.png')) return 'image/png'
  if (lowerCaseFileName.endsWith('.jpg') || lowerCaseFileName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerCaseFileName.endsWith('.webp')) return 'image/webp'
  if (lowerCaseFileName.endsWith('.gif')) return 'image/gif'
  if (lowerCaseFileName.endsWith('.svg')) return 'image/svg+xml'
  if (lowerCaseFileName.endsWith('.mp4')) return 'video/mp4'
  if (lowerCaseFileName.endsWith('.webm')) return 'video/webm'
  if (lowerCaseFileName.endsWith('.mov')) return 'video/quicktime'
  if (lowerCaseFileName.endsWith('.mp3')) return 'audio/mpeg'
  if (lowerCaseFileName.endsWith('.wav')) return 'audio/wav'
  if (lowerCaseFileName.endsWith('.pdf')) return 'application/pdf'

  return 'application/octet-stream'
}

function inferPublicationMediaKind(contentType: string, fileName: string): PublicationMediaAsset['kind'] {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) return 'document'

  return 'other'
}

function sanitizePublicationMediaFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
}

function normalizePublicationMediaPath(path: string) {
  const normalizedPath = path.trim().replace(/^\/+/, '')

  if (!normalizedPath.startsWith(`${PUBLICATION_MEDIA_ROOT}/`)) {
    throw new PublicationApiError(
      400,
      'media_path_invalid',
      `Media path must stay inside "${PUBLICATION_MEDIA_ROOT}/".`,
    )
  }

  return normalizedPath
}

function buildPublicationMediaEmbedMarkdown(input: {
  fileName: string
  publicUrl: string
  kind: PublicationMediaAsset['kind']
  altText?: string
  caption?: string
  posterUrl?: string
}) {
  const altText = input.altText?.trim() || input.fileName
  const caption = input.caption?.trim() || stripPublicationMediaFileExtension(input.fileName)

  switch (input.kind) {
    case 'image':
      return `::figure{src="${input.publicUrl}" alt="${escapePublicationDirectiveValue(altText)}" caption="${escapePublicationDirectiveValue(caption)}"}`
    case 'video':
      return `::video{src="${input.publicUrl}"${input.posterUrl?.trim() ? ` poster="${escapePublicationDirectiveValue(input.posterUrl.trim())}"` : ''} caption="${escapePublicationDirectiveValue(caption)}"}`
    case 'document':
      return `::download{href="${input.publicUrl}" label="Open ${escapePublicationDirectiveValue(input.fileName)}"}`
    default:
      return `[${input.fileName}](${input.publicUrl})`
  }
}

function stripPublicationMediaFileExtension(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, '')
}

function escapePublicationDirectiveValue(value: string) {
  return value.replace(/"/g, '\\"')
}
