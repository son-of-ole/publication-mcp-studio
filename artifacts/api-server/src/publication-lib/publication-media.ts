import { Buffer } from 'node:buffer'
import { getPublicationMediaBucketName, getPublicationPlatform } from './publication-platform.js'
import type { PublicationMediaAsset } from '@publication-mcp-studio/platform'
import { PublicationApiError } from './publication-errors.js'
import { slugifyPublicationTitle } from './publication-service.js'

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
    assertSafePublicationMediaSourceUrl(sourceUrl)
    await assertSafePublicationMediaSourceUrlDns(sourceUrl)
    const { fetch: undiciFetch } = await import('undici')
    const dispatcher = await createSafePublicationMediaDispatcher()
    const response = await undiciFetch(sourceUrl, { redirect: 'manual', dispatcher })

    if (response.status >= 300 && response.status < 400) {
      throw new PublicationApiError(
        400,
        'media_source_redirect_blocked',
        'Redirects are not allowed when fetching remote media to prevent SSRF.',
      )
    }

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

function assertSafePublicationMediaSourceUrl(rawUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new PublicationApiError(400, 'media_source_url_invalid', 'The provided sourceUrl is not a valid URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PublicationApiError(400, 'media_source_url_protocol', 'Only http(s) URLs are allowed for sourceUrl.')
  }

  if (parsed.username || parsed.password) {
    throw new PublicationApiError(400, 'media_source_url_credentials', 'Embedded credentials in sourceUrl are not allowed.')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) {
    throw new PublicationApiError(400, 'media_source_url_host', 'sourceUrl must include a host.')
  }

  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new PublicationApiError(403, 'media_source_url_blocked', 'Local/internal hosts are not allowed for sourceUrl.')
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split('.').map(Number)
    const [a, b] = parts
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224
    if (isPrivate) {
      throw new PublicationApiError(403, 'media_source_url_blocked', 'Private/loopback IPs are not allowed for sourceUrl.')
    }
  }

  if (hostname.includes(':')) {
    throw new PublicationApiError(403, 'media_source_url_blocked', 'IPv6 hosts are not allowed for sourceUrl.')
  }
}

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0 ||
    a >= 224
  )
}

async function assertSafePublicationMediaSourceUrlDns(rawUrl: string) {
  const { lookup } = await import('node:dns/promises')
  const parsed = new URL(rawUrl)
  let addresses: { address: string; family: number }[]
  try {
    addresses = await lookup(parsed.hostname, { all: true })
  } catch {
    throw new PublicationApiError(400, 'media_source_url_unresolvable', 'sourceUrl host could not be resolved.')
  }
  for (const { address, family } of addresses) {
    if (family === 6) {
      throw new PublicationApiError(403, 'media_source_url_blocked', 'IPv6 destinations are not allowed for sourceUrl.')
    }
    if (isPrivateOrReservedIPv4(address)) {
      throw new PublicationApiError(403, 'media_source_url_blocked', 'sourceUrl resolves to a private/reserved IP address.')
    }
  }
}

// Custom undici dispatcher whose connector re-validates the resolved IP at
// connect time (closing the DNS-rebinding/TOCTOU window between preflight DNS
// validation and the actual TCP connect).
async function createSafePublicationMediaDispatcher() {
  const { Agent, buildConnector } = await import('undici')
  const baseConnector = buildConnector({})
  return new Agent({
    connect: (opts, cb) => {
      baseConnector(opts, (err, socket) => {
        if (err || !socket) return cb(err, socket as never)
        const remote = (socket as unknown as { remoteAddress?: string; remoteFamily?: string }).remoteAddress
        const family = (socket as unknown as { remoteFamily?: string }).remoteFamily
        if (!remote) {
          socket.destroy()
          return cb(
            new PublicationApiError(403, 'media_source_url_blocked', 'sourceUrl connection target could not be verified.'),
            null as never,
          )
        }
        if (family === 'IPv6') {
          socket.destroy()
          return cb(
            new PublicationApiError(403, 'media_source_url_blocked', 'sourceUrl resolved to an IPv6 destination at connect time.'),
            null as never,
          )
        }
        if (isPrivateOrReservedIPv4(remote)) {
          socket.destroy()
          return cb(
            new PublicationApiError(403, 'media_source_url_blocked', 'sourceUrl resolved to a private/reserved IP at connect time.'),
            null as never,
          )
        }
        cb(null, socket)
      })
    },
  })
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
