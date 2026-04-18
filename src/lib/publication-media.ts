import { Buffer } from 'node:buffer'
import { getPublicationServiceClient } from '@/lib/publication-db'
import { PublicationApiError } from '@/lib/publication-errors'
import { slugifyPublicationTitle } from '@/lib/publication-service'

const PUBLICATION_MEDIA_BUCKET = 'article-assets'
const PUBLICATION_MEDIA_ROOT = 'publications'

export type PublicationMediaAsset = {
  bucket: string
  path: string
  publicUrl: string
  fileName: string
  contentType: string
  sizeBytes: number | null
  kind: 'image' | 'video' | 'audio' | 'document' | 'other'
  articleSlug: string
  embedMarkdown: string
  createdAt?: string
  updatedAt?: string
}

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
  const storagePath = `${PUBLICATION_MEDIA_ROOT}/${articleSlug}/${Date.now()}-${fileName}`
  const supabase = getPublicationServiceClient()

  const { error } = await supabase.storage.from(PUBLICATION_MEDIA_BUCKET).upload(storagePath, sourceBuffer, {
    cacheControl: '3600',
    contentType,
    upsert: false,
  })

  if (error) {
    throw new PublicationApiError(500, 'media_upload_failed', error.message, error)
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(PUBLICATION_MEDIA_BUCKET).getPublicUrl(storagePath)

  return {
    asset: {
      bucket: PUBLICATION_MEDIA_BUCKET,
      path: storagePath,
      publicUrl,
      fileName,
      contentType,
      sizeBytes: sourceBuffer.byteLength,
      kind,
      articleSlug,
      embedMarkdown: buildPublicationMediaEmbedMarkdown({
        fileName,
        publicUrl,
        kind,
        altText: input.altText,
        caption: input.caption,
        posterUrl: input.posterUrl,
      }),
    } satisfies PublicationMediaAsset,
  }
}

export async function listPublicationMedia(input: {
  articleIdentifier?: string
  articleSlug?: string
  limit?: number
}) {
  const articleSlug = await resolvePublicationMediaArticleSlug(input.articleIdentifier, input.articleSlug)
  const supabase = getPublicationServiceClient()
  const { data, error } = await supabase.storage.from(PUBLICATION_MEDIA_BUCKET).list(`${PUBLICATION_MEDIA_ROOT}/${articleSlug}`, {
    limit: clampPublicationMediaLimit(input.limit),
    sortBy: {
      column: 'updated_at',
      order: 'desc',
    },
  })

  if (error) {
    throw new PublicationApiError(500, 'media_list_failed', error.message, error)
  }

  return {
    articleSlug,
    assets: (data ?? [])
      .filter((entry) => entry.name && entry.id)
      .map((entry) => {
        const path = `${PUBLICATION_MEDIA_ROOT}/${articleSlug}/${entry.name}`
        const {
          data: { publicUrl },
        } = supabase.storage.from(PUBLICATION_MEDIA_BUCKET).getPublicUrl(path)
        const contentType = normalizePublicationMediaContentType(
          typeof entry.metadata?.mimetype === 'string' ? entry.metadata.mimetype : undefined,
          entry.name,
        )
        const kind = inferPublicationMediaKind(contentType, entry.name)

        return {
          bucket: PUBLICATION_MEDIA_BUCKET,
          path,
          publicUrl,
          fileName: entry.name,
          contentType,
          sizeBytes: readPublicationMediaSize(entry.metadata),
          kind,
          articleSlug,
          embedMarkdown: buildPublicationMediaEmbedMarkdown({
            fileName: entry.name,
            publicUrl,
            kind,
          }),
          createdAt: entry.created_at ?? undefined,
          updatedAt: entry.updated_at ?? undefined,
        } satisfies PublicationMediaAsset
      }),
  }
}

export async function deletePublicationMedia(path: string) {
  const normalizedPath = normalizePublicationMediaPath(path)
  const supabase = getPublicationServiceClient()
  const { error } = await supabase.storage.from(PUBLICATION_MEDIA_BUCKET).remove([normalizedPath])

  if (error) {
    throw new PublicationApiError(500, 'media_delete_failed', error.message, error)
  }

  return {
    deleted: true,
    bucket: PUBLICATION_MEDIA_BUCKET,
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

  const supabase = getPublicationServiceClient()
  let query = supabase.from('articles').select('slug').limit(1)

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedIdentifier)) {
    query = query.eq('id', requestedIdentifier)
  } else {
    query = query.eq('slug', requestedIdentifier)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new PublicationApiError(500, 'media_article_lookup_failed', error.message, error)
  }

  return data?.slug ? slugifyPublicationTitle(data.slug) : slugifyPublicationTitle(requestedIdentifier)
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

function readPublicationMediaSize(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return null
  }

  const size =
    typeof metadata.size === 'number'
      ? metadata.size
      : typeof metadata.size === 'string'
        ? Number.parseInt(metadata.size, 10)
        : typeof metadata.contentLength === 'number'
          ? metadata.contentLength
          : null

  return typeof size === 'number' && !Number.isNaN(size) ? size : null
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
