import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_BYTES = 128 * 1024 * 1024
const assetPath = /^public\/__publication-local\/media\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/
function key(passphrase: string, salt: Buffer) {
  if (passphrase.length < 20) throw new Error('Backup passphrase must contain at least 20 characters.')
  return scryptSync(passphrase, salt, 32)
}
async function boundedFile(file: string) {
  if ((await stat(file)).size > MAX_BYTES) throw new Error('Backup size limit exceeded (128 MiB).')
  return readFile(file)
}

/** Encrypted point-in-time local state plus inventory-backed media; no env or client credentials. */
export async function backupLocalPublications({ rootDir, destination, passphrase }: { rootDir: string; destination: string; passphrase: string }) {
  const root = await realpath(rootDir)
  const state = JSON.parse((await boundedFile(path.join(root, '.publication-mcp-studio/state.json'))).toString())
  if (!Array.isArray(state.articles) || !Array.isArray(state.media) || !Array.isArray(state.versions)) throw new Error('Invalid publication state.')
  const files: Record<string, string> = {}
  let bytes = Buffer.byteLength(JSON.stringify(state))
  for (const asset of state.media) {
    if (typeof asset.publicUrl !== 'string' || !asset.publicUrl.startsWith('/__publication-local/')) continue
    const relative = 'public' + asset.publicUrl
    if (!assetPath.test(relative)) throw new Error('Unsafe media inventory path.')
    const source = await realpath(path.join(root, relative))
    if (!source.startsWith(root + path.sep)) throw new Error('Media path escapes the data root.')
    const data = await boundedFile(source)
    bytes += data.length
    if (bytes > MAX_BYTES / 2) throw new Error('Local backup exceeds the in-memory budget. Use a managed volume/database backup.')
    files[relative] = data.toString('base64')
  }
  const salt = randomBytes(16), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), state, files })), cipher.final()])
  const output = Buffer.from(JSON.stringify({ format: 'publication-backup-v1', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }))
  await writeFile(destination, output, { flag: 'wx', mode: 0o600 })
  return { destination, articles: state.articles.length, mediaFiles: Object.keys(files).length, sha256: createHash('sha256').update(output).digest('hex') }
}

/** Restore only into a new directory. Existing stores can never be overwritten. */
export async function restoreLocalPublications({ backupFile, destinationRoot, passphrase }: { backupFile: string; destinationRoot: string; passphrase: string }) {
  const envelope = JSON.parse((await boundedFile(backupFile)).toString())
  if (envelope.format !== 'publication-backup-v1') throw new Error('Unsupported backup format.')
  const salt = Buffer.from(envelope.salt, 'base64'), iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64')
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('Malformed backup.')
  const decipher = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv)
  decipher.setAuthTag(tag)
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString())
  if (payload.version !== 1 || !Array.isArray(payload.state?.articles) || !Array.isArray(payload.state?.media) || !Array.isArray(payload.state?.versions) || !payload.files || typeof payload.files !== 'object' || Array.isArray(payload.files)) throw new Error('Invalid backup payload.')
  for (const [name, data] of Object.entries(payload.files)) if (!assetPath.test(name) || typeof data !== 'string' || name.split('/').some(part => part === '.' || part === '..')) throw new Error('Unsafe backup path.')
  // Restoring an older inventory must not resurrect tokens revoked after backup.
  for (const token of payload.state.tokens ?? []) token.revokedAt = new Date().toISOString()
  await mkdir(destinationRoot, { mode: 0o700 }) // EEXIST is intentional; no recursive root creation.
  const stateDir = path.join(destinationRoot, '.publication-mcp-studio')
  await mkdir(stateDir, { mode: 0o700 })
  await writeFile(path.join(stateDir, 'state.json'), JSON.stringify(payload.state, null, 2), { flag: 'wx', mode: 0o600 })
  for (const [name, data] of Object.entries(payload.files)) {
    const target = path.join(destinationRoot, name)
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, Buffer.from(data as string, 'base64'), { flag: 'wx', mode: 0o600 })
  }
  return { destinationRoot, articles: payload.state.articles.length, mediaFiles: Object.keys(payload.files).length }
}
