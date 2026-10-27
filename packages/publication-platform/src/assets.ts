import { createHash, randomUUID } from 'node:crypto'
import { PublicationApiError } from './errors'
import { getPublicationAttachments } from './attachments'
import { assertPublicationMutation, assertPublicationPermission, updatePublicationIfUnchanged } from './lifecycle'
import { PUBLICATION_MEDIA_LIMIT } from './limits'
import type { PublicationArticleRecord, PublicationAttachment, PublicationAuthContext, PublicationMediaAsset, PublicationPlatform } from './types'

export const PUBLICATION_UPLOAD_CHUNK_BYTES = 256 * 1024
const TTL = 15 * 60_000
const MAX_RESERVED = 64 * 1024 * 1024
type Tool = { name: string; description: string; inputSchema: { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } }
const str = { type: 'string' }
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }
}
export const PUBLICATION_ASSET_TOOLS: Tool[] = [
  tool('begin_media_upload', 'Begin a private, bounded file upload (up to 8 MiB). Supply SHA-256 of the complete file.', { identifier: str, fileName: str, contentType: str, sizeBytes: { type: 'integer', minimum: 1, maximum: PUBLICATION_MEDIA_LIMIT }, sha256: str }, ['identifier', 'fileName', 'sizeBytes', 'sha256']),
  tool('upload_media_chunk', 'Append a base64 chunk in order. Retrying the same index and bytes is safe.', { uploadId: str, index: { type: 'integer', minimum: 0 }, dataBase64: str }, ['uploadId', 'index', 'dataBase64']),
  tool('complete_media_upload', 'Verify length/checksum and store the private file. Then use attach_media.', { uploadId: str }, ['uploadId']),
  tool('abort_media_upload', 'Discard an unfinished upload.', { uploadId: str }, ['uploadId']),
  tool('attach_media', 'Attach a stored file to a private publication. It becomes public only with the publication. Optional textContent makes PDF/data contents readable in the Markdown.', { identifier: str, url: str, label: str, description: str, textContent: str }, ['identifier', 'url']),
  tool('detach_media', 'Remove an attachment from a draft/revision. Stored bytes remain private unless another live reference exists.', { identifier: str, attachmentId: str }, ['identifier', 'attachmentId']),
  tool('list_attachments', 'Read structured publication attachments.', { identifier: str }, ['identifier']),
]
export function publicationAssetToolScope(name: string) {
  return name === 'list_attachments' ? 'articles:read' as const : 'articles:write' as const
}
function required(args: Record<string, unknown>, key: string, max = 1024) {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new PublicationApiError(400, 'invalid_arguments', `${key} must be a nonempty string of at most ${max} characters.`)
  return value.trim()
}
function optional(args: Record<string, unknown>, key: string, max: number) {
  if (args[key] === undefined) return ''
  if (typeof args[key] !== 'string' || (args[key] as string).length > max) throw new PublicationApiError(400, 'invalid_arguments', `${key} exceeds its text limit.`)
  return (args[key] as string).trim()
}
export function inferPublicationAssetKind(contentType: string): PublicationMediaAsset['kind'] {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  return contentType === 'application/pdf' ? 'document' : 'other'
}
export function publicationAssetContentType(fileName: string, input?: string) {
  const type = input || ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', csv: 'text/csv', json: 'application/json', txt: 'text/plain', md: 'text/markdown', mp4: 'video/mp4', mp3: 'audio/mpeg' } as Record<string, string>)[fileName.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream'
  if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(type)) throw new PublicationApiError(400, 'invalid_content_type', 'Use a MIME type without parameters.')
  return type.toLowerCase()
}

/** Per-engine bounded staging. Incomplete uploads expire and disappear on restart. */
export function createPublicationAssetTools(platform: PublicationPlatform, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now
  type Upload = { owner: string; articleId: string; fileName: string; contentType: string; sizeBytes: number; sha256: string; expiresAt: number; chunks: Buffer[]; bytes: number; busy?: boolean; asset?: PublicationMediaAsset }
  const uploads = new Map<string, Upload>()
  const purge = () => { for (const [id, value] of uploads) if (!value.busy && value.expiresAt <= now()) uploads.delete(id) }
  async function article(identifier: string, actor: PublicationAuthContext, mutate = true) {
    const value = await platform.publicationStore.getArticleByIdentifier(identifier)
    if (!value) throw new PublicationApiError(404, 'article_not_found', 'Article not found.')
    if (mutate) assertPublicationMutation(actor, value, value.status)
    return value
  }
  async function namespace(value: PublicationArticleRecord) {
    const revision = value.metadata.publicationRevision as { articleId?: string } | undefined
    const original = revision?.articleId ? await platform.publicationStore.getArticleByIdentifier(revision.articleId) : value
    if (!original || !/^[a-zA-Z0-9_-]+$/.test(original.slug)) throw new PublicationApiError(400, 'invalid_media_namespace', 'The original article needs a safe media slug.')
    return original.slug
  }
  return async function execute(name: string, args: Record<string, unknown>, actor: PublicationAuthContext, ownerKey: string) {
    assertPublicationPermission(actor, [publicationAssetToolScope(name)])
    if (!ownerKey) throw new PublicationApiError(401, 'upload_identity_required', 'A stable authenticated connection identity is required.')
    ownerKey = createHash('sha256').update(ownerKey).digest('hex')
    if (!PUBLICATION_ASSET_TOOLS.some(tool => tool.name === name)) throw new PublicationApiError(400, 'unknown_tool', 'Unknown asset tool.')
    purge()
    if (name === 'begin_media_upload') {
      if (!platform.mediaStore.readMedia || !platform.mediaStore.getMediaByPublicUrl) throw new PublicationApiError(501, 'private_media_unavailable', 'This adapter must support private media delivery.')
      const value = await article(required(args, 'identifier'), actor)
      const fileName = required(args, 'fileName', 160)
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(fileName)) throw new PublicationApiError(400, 'invalid_file_name', 'Use a simple file name with letters, numbers, dots, dashes or underscores.')
      const sizeBytes = args.sizeBytes
      if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > PUBLICATION_MEDIA_LIMIT) throw new PublicationApiError(413, 'payload_too_large', 'Files must contain between 1 byte and 8 MiB.')
      const sha256 = required(args, 'sha256', 64).toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw new PublicationApiError(400, 'invalid_checksum', 'SHA-256 must be 64 hex characters.')
      const reserved = [...uploads.values()].reduce((sum, item) => sum + (item.asset ? 0 : item.sizeBytes), 0)
      if (uploads.size >= 128 || [...uploads.values()].filter(item => !item.asset).length >= 16 || reserved + (sizeBytes as number) > MAX_RESERVED) throw new PublicationApiError(429, 'upload_capacity', 'Upload staging is full. Complete/abort pending uploads or retry after expiry.')
      const uploadId = randomUUID(), expiresAt = now() + TTL
      uploads.set(uploadId, { owner: ownerKey, articleId: value.id, fileName, contentType: publicationAssetContentType(fileName, optional(args, 'contentType', 128)), sizeBytes: sizeBytes as number, sha256, expiresAt, chunks: [], bytes: 0 })
      return { uploadId, chunkBytes: PUBLICATION_UPLOAD_CHUNK_BYTES, expiresAt: new Date(expiresAt).toISOString() }
    }
    if (['upload_media_chunk', 'complete_media_upload', 'abort_media_upload'].includes(name)) {
      const id = required(args, 'uploadId'), upload = uploads.get(id)
      if (!upload || upload.owner !== ownerKey) throw new PublicationApiError(404, 'upload_not_found', 'Upload not found or expired.')
      if (upload.busy) throw new PublicationApiError(409, 'upload_busy', 'Upload completion is in progress.')
      if (name === 'abort_media_upload') { uploads.delete(id); return { aborted: true } }
      if (name === 'upload_media_chunk') {
        if (upload.asset) throw new PublicationApiError(409, 'upload_complete', 'Upload already completed.')
        const encoded = required(args, 'dataBase64', Math.ceil(PUBLICATION_UPLOAD_CHUNK_BYTES / 3) * 4)
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new PublicationApiError(400, 'invalid_base64', 'Chunk must be canonical base64.')
        const bytes = Buffer.from(encoded, 'base64'), index = args.index
        if (!bytes.length || bytes.length > PUBLICATION_UPLOAD_CHUNK_BYTES || !Number.isSafeInteger(index) || (index as number) < 0) throw new PublicationApiError(400, 'invalid_chunk', 'Invalid chunk size or index.')
        if ((index as number) < upload.chunks.length && upload.chunks[index as number].equals(bytes)) return { nextIndex: upload.chunks.length, receivedBytes: upload.bytes }
        if (index !== upload.chunks.length || upload.bytes + bytes.length > upload.sizeBytes || (bytes.length !== PUBLICATION_UPLOAD_CHUNK_BYTES && upload.bytes + bytes.length !== upload.sizeBytes)) throw new PublicationApiError(409, 'chunk_out_of_order', 'Use full-size chunks in order, except for the final chunk.')
        upload.chunks.push(bytes); upload.bytes += bytes.length
        return { nextIndex: upload.chunks.length, receivedBytes: upload.bytes }
      }
      if (upload.asset) return { asset: upload.asset }
      if (upload.bytes !== upload.sizeBytes) throw new PublicationApiError(409, 'upload_incomplete', 'Uploaded length does not match the declared file length.')
      const hash = createHash('sha256'); for (const bytes of upload.chunks) hash.update(bytes)
      if (hash.digest('hex') !== upload.sha256) { uploads.delete(id); throw new PublicationApiError(400, 'checksum_mismatch', 'File checksum mismatch; start a new upload.') }
      upload.busy = true
      try {
        const value = await article(upload.articleId, actor), slug = await namespace(value)
        const data = Buffer.concat(upload.chunks), kind = inferPublicationAssetKind(upload.contentType)
        upload.asset = await platform.mediaStore.uploadMedia({ articleSlug: slug, fileName: upload.fileName, contentType: upload.contentType, data, kind, embedMarkdown: `[${upload.fileName}](/${slug}/${upload.fileName})` })
        upload.chunks = []
        return { asset: upload.asset }
      } finally { upload.busy = false }
    }
    const value = await article(required(args, 'identifier'), actor, name !== 'list_attachments')
    let attachments = getPublicationAttachments(value)
    if (name === 'list_attachments') return { attachments }
    if (name === 'detach_media') attachments = attachments.filter(item => item.id !== required(args, 'attachmentId'))
    else {
      const url = required(args, 'url')
      const asset = await platform.mediaStore.getMediaByPublicUrl?.(url)
      if (!asset || asset.articleSlug !== await namespace(value) || !/^\/__publication-(?:local\/media|assets)\//.test(asset.publicUrl)) throw new PublicationApiError(404, 'asset_not_found', 'Private asset does not belong to this publication.')
      const existing = attachments.find(item => item.url === url)
      const attachment: PublicationAttachment = { id: existing?.id || randomUUID(), url, fileName: asset.fileName, contentType: asset.contentType, sizeBytes: asset.sizeBytes, kind: asset.kind, label: optional(args, 'label', 200) || asset.fileName, description: optional(args, 'description', 4000), textContent: optional(args, 'textContent', 16_000) || undefined }
      attachments = [...attachments.filter(item => item.url !== url), attachment]
      if (attachments.length > 30 || Buffer.byteLength(JSON.stringify(attachments)) > 256 * 1024) throw new PublicationApiError(413, 'attachment_limit', 'At most 30 attachments and 256 KiB of attachment metadata/text are supported per publication.')
    }
    const updated = await updatePublicationIfUnchanged(platform.publicationStore, value, { metadata: { ...value.metadata, attachments }, updatedAt: new Date().toISOString() })
    return { article: updated, attachments }
  }
}

/** Public delivery always rechecks the article; credentials cannot expand access. */
export function createPublishedMediaFetchHandler(platform: Pick<PublicationPlatform, 'publicationStore' | 'mediaStore'>) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Read-only media', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } })
    const pathname = new URL(request.url).pathname
    const match = /^\/__publication-(?:local\/media|assets)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/.exec(pathname)
    const missing = () => new Response('Not found', { status: 404, headers })
    if (!match) return missing()
    const article = await platform.publicationStore.getArticleByIdentifier(match[1])
    if (article?.status !== 'published' || article.slug !== match[1] || (!article.contentMarkdown.includes(pathname) && !getPublicationAttachments(article).some(asset => asset.url === pathname))) return missing()
    const asset = await platform.mediaStore.getMediaByPublicUrl?.(pathname)
    if (!asset || asset.articleSlug !== article.slug || !platform.mediaStore.readMedia) return missing()
    const inline = /^(?:image\/(?:png|jpeg|webp|gif|avif)|video\/mp4|audio\/mpeg)$/.test(asset.contentType)
    const responseHeaders = { ...headers, 'Content-Type': asset.contentType, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asset.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"` }
    if (request.method === 'HEAD') return new Response(null, { headers: responseHeaders })
    const bytes = await platform.mediaStore.readMedia(asset)
    if (bytes.byteLength > PUBLICATION_MEDIA_LIMIT) throw new PublicationApiError(413, 'payload_too_large', 'Stored media exceeds delivery limit.')
    return new Response(new Uint8Array(bytes), { headers: responseHeaders })
  }
}
