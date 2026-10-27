import { PublicationApiError } from './errors'

export const PUBLICATION_JSON_LIMIT = 1024 * 1024
export const PUBLICATION_MEDIA_LIMIT = 8 * 1024 * 1024

export async function readPublicationBytes(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) return new Uint8Array()
  const reader = body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new PublicationApiError(413, 'payload_too_large', `Payload exceeds ${maxBytes} bytes.`) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

export async function readPublicationJson(request: Request) {
  const bytes = await readPublicationBytes(request.body, PUBLICATION_JSON_LIMIT)
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch { throw new PublicationApiError(400, 'invalid_json', 'A JSON object is required.') }
}
