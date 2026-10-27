import { writeFile, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ensureLocalConnection, root } from './local-connection.mjs'
const args = process.argv.slice(2).filter(value => value !== '--')
const role = args.length ? args[0] === '--role' && args.length === 2 ? args[1] : '' : 'agent'
const connection = await ensureLocalConnection(role, true)
console.log(`Local MCP ${role} HTTP connection saved to ${connection.output}; valid for seven days. Treat this file as a credential.`)
if (role === 'agent') {
  const output = resolve(connection.directory, 'mcp-harness.json')
  await writeFile(output, JSON.stringify({ mcpServers: { publicationEngine: { command: process.execPath, args: [resolve(root, 'scripts/mcp-harness.mjs')] } } }, null, 2) + '\n', { mode: 0o600 })
  await chmod(output, 0o600)
  console.log(`Use ${output} for a local stdio harness. The bridge renews its scoped connection automatically while the local engine is running.`)
}
