import { readFile, mkdir, writeFile, chmod, rename, unlink, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { PUBLICATION_SCOPES, PUBLICATION_AGENT_SCOPES } from '../packages/publication-client/dist/index.js'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const roles = { agent: [...PUBLICATION_AGENT_SCOPES], writer: ['mcp:connect', 'articles:read', 'articles:write'], publisher: ['mcp:connect', 'articles:read', 'articles:publish'], owner: PUBLICATION_SCOPES }
export async function ensureLocalConnection(role = 'agent', rotate = false) {
  if (!roles[role]) throw new Error('Use --role agent (default), writer, publisher or owner.')
  const config = parseEnv(await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  if (config.PUBLICATION_PLATFORM_ADAPTER !== 'local') throw new Error('This helper only provisions the isolated local engine.')
  const origin = `http://127.0.0.1:${config.PUBLICATION_API_PORT || 8080}`
  const directory = resolve(root, config.PUBLICATION_LOCAL_ROOT_DIR || '.publication-local-dev')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const output = resolve(directory, role === 'writer' ? 'mcp-connection.json' : `mcp-${role}-connection.json`)
  async function existing() {
    try {
      const value = JSON.parse(await readFile(output, 'utf8')).mcpServers.publicationEngine
      const token = JSON.parse(Buffer.from(value.headers.Authorization.slice('Bearer pubtok_'.length).split('.')[0], 'base64url').toString())
      if (value.url !== `${origin}/api/publications/mcp` || !Array.isArray(token.scopes) || token.scopes.length !== roles[role].length || roles[role].some(scope => !token.scopes.includes(scope))) return null
      return { value, token }
    } catch { return null }
  }
  let previous = await existing()
  if (!rotate && previous && previous.token.exp * 1000 > Date.now() + 3600_000) return { ...previous.value, output, directory }
  const lockPath = output + '.lock'
  let lock
  for (let attempt = 0; attempt < 100; attempt++) {
    try { lock = await open(lockPath, 'wx', 0o600); break } catch (error) { if (error.code !== 'EEXIST') throw error; await delay(100) }
  }
  if (!lock) throw new Error('Connection rotation is locked. Check for an interrupted bootstrap before removing its .lock file.')
  await lock.writeFile(String(process.pid)); await lock.close()
  let cookie
  try {
    previous = await existing()
    if (!rotate && previous && previous.token.exp * 1000 > Date.now() + 3600_000) return { ...previous.value, output, directory }
    const login = await fetch(origin + '/api/auth/local-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: config.PUBLICATION_ADMIN_EMAIL, password: config.PUBLICATION_ADMIN_PASSWORD }), signal: AbortSignal.timeout(10_000) })
    if (!login.ok) throw new Error(`Local owner bootstrap failed (${login.status}).`)
    cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) throw new Error('Owner bootstrap did not create a session.')
    const issued = await fetch(origin + '/api/publications/tokens', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ label: `Local MCP ${role}`, scopes: roles[role], expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString() }), signal: AbortSignal.timeout(10_000) })
    if (!issued.ok) throw new Error(`Scoped token issuance failed (${issued.status}).`)
    const signed = await issued.json()
    const value = { url: `${origin}/api/publications/mcp`, headers: { Authorization: `Bearer ${signed.token.token}` } }
    const temporary = output + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, JSON.stringify({ mcpServers: { publicationEngine: value } }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await chmod(temporary, 0o600); await rename(temporary, output)
    } finally { await unlink(temporary).catch(() => undefined) }
    if (previous?.token.jti && /^[a-zA-Z0-9-]+$/.test(previous.token.jti)) {
      const revoked = await fetch(`${origin}/api/publications/tokens/${previous.token.jti}/revoke`, { method: 'POST', headers: { cookie }, signal: AbortSignal.timeout(10_000) })
      if (!revoked.ok) throw new Error('New connection saved, but previous-token revocation failed. Revoke the old token through the private engine.')
    }
    return { ...value, output, directory }
  } finally {
    if (cookie) await fetch(origin + '/api/auth/signout', { method: 'POST', headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch(() => undefined)
    await unlink(lockPath)
  }
}
