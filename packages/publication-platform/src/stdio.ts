import type { Readable, Writable } from 'node:stream'
import { PUBLICATION_JSON_LIMIT, readPublicationBytes } from './limits'

/** Stateless HTTP MCP bridge for harnesses that launch stdio servers. stdout is JSON-RPC only. */
export async function runPublicationMcpStdio(options: {
  url: string
  getAuthorization: () => Promise<string>
  input?: Readable
  output?: Writable
  fetch?: typeof globalThis.fetch
}) {
  const url = new URL(options.url)
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) throw new Error('MCP transport requires HTTPS, or HTTP on loopback.')
  const input = options.input ?? process.stdin, output = options.output ?? process.stdout
  const send = (data: unknown) => new Promise<void>((resolve, reject) => output.write(JSON.stringify(data) + '\n', error => error ? reject(error) : resolve()))
  let buffered = Buffer.alloc(0)
  async function dispatch(line: Buffer) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(line.toString('utf8'))
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error()
    } catch { await send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON request.' } }); return }
    const notification = payload.id === undefined
    try {
      const response = await (options.fetch ?? globalThis.fetch)(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: await options.getAuthorization() }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) })
      if (notification) { await response.body?.cancel(); return }
      const bytes = await readPublicationBytes(response.body, 4 * PUBLICATION_JSON_LIMIT)
      const result = JSON.parse(new TextDecoder().decode(bytes))
      if (!result || result.jsonrpc !== '2.0' || result.id !== payload.id) throw new Error('Invalid engine response.')
      // Business conflicts use non-2xx HTTP responses but retain valid JSON-RPC
      // errors. Forward them so a harness can distinguish stale review from a
      // disconnected or unauthenticated transport.
      if (!response.ok && (!result.error || typeof result.error.message !== 'string' || !Number.isInteger(result.error.code))) throw new Error('Invalid engine error response.')
      await send(result)
    } catch {
      if (!notification) await send({ jsonrpc: '2.0', id: payload.id ?? null, error: { code: -32000, message: 'Publication engine request failed. Check connection, credential expiry and engine availability.' } })
    }
  }
  for await (const chunk of input) {
    buffered = Buffer.concat([buffered, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    let end: number
    while ((end = buffered.indexOf(10)) !== -1) {
      const line = buffered.subarray(0, end); buffered = buffered.subarray(end + 1)
      if (line.byteLength > PUBLICATION_JSON_LIMIT) throw new Error('MCP request exceeds 1 MiB.')
      if (line.toString('utf8').trim()) await dispatch(line)
    }
    if (buffered.byteLength > PUBLICATION_JSON_LIMIT) throw new Error('MCP request exceeds 1 MiB.')
  }
  if (buffered.length) await dispatch(buffered)
}
