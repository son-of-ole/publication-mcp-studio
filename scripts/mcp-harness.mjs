import { runPublicationMcpStdio } from '../packages/publication-platform/dist/stdio.js'
import { ensureLocalConnection } from './local-connection.mjs'
try {
  const initial = await ensureLocalConnection()
  await runPublicationMcpStdio({ url: initial.url, getAuthorization: async () => {
    const connection = await ensureLocalConnection()
    if (connection.url !== initial.url) throw new Error('Engine address changed. Restart the bridge.')
    return connection.headers.Authorization
  } })
} catch {
  console.error('Publication MCP bridge unavailable. Start the local engine and check its private connection configuration.')
  process.exitCode = 1
}
