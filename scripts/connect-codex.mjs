import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { root, ensureLocalConnection } from './local-connection.mjs'

await ensureLocalConnection()
const directory = resolve(root, '.codex'), file = resolve(directory, 'config.toml')
await mkdir(directory, { recursive: true, mode: 0o700 })
let previous = ''
try { previous = await readFile(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
if (/^\[mcp_servers\.publication_engine\]/m.test(previous)) {
  console.log(`Existing publication_engine entry preserved in ${file}.`)
} else {
  const tools = ['list_articles', 'get_article', 'create_article', 'update_article', 'prepare_publication', 'publish_article', 'unpublish_article', 'create_revision', 'publish_revision', 'begin_media_upload', 'upload_media_chunk', 'complete_media_upload', 'abort_media_upload', 'attach_media', 'detach_media', 'list_attachments']
  const content = `${previous.trimEnd()}\n\n# Local publication engine; credentials stay in the private local bridge.\n[mcp_servers.publication_engine]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(resolve(root, 'scripts/mcp-harness.mjs'))}]\ncwd = ${JSON.stringify(root)}\nenabled = true\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\nenabled_tools = ${JSON.stringify(tools)}\n`
  await writeFile(file, content.trimStart(), { mode: 0o600 })
  await chmod(file, 0o600)
  console.log(`Connected this trusted project to publication_engine in ${file}. No global harness configuration was changed.`)
}
