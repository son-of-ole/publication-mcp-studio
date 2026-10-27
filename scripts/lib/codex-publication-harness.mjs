import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

/** Exercise the real Codex MCP router without starting a model turn or a persistent chat. */
export async function connectCodexPublicationHarness({ cwd, codexBin } = {}) {
  const candidates = [codexBin, process.env.PUBLICATION_CODEX_BIN, '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex'].filter(Boolean)
  let executable
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break } catch {} }
  if (!executable) throw new Error('Set PUBLICATION_CODEX_BIN to a working Codex binary.')
  // The verification process does not connect unrelated user MCP servers.
  const config = await readFile(`${homedir()}/.codex/config.toml`, 'utf8').catch(() => '')
  const overrides = Array.from(config.matchAll(/^\[mcp_servers\.([^\].]+)\]/gm), match => match[1]).filter(name => name !== 'publication_engine').flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`])
  const child = spawn(executable, ['app-server', ...overrides], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  let nextId = 1, stopped = false
  const pending = new Map(), events = []
  // Do not persist stderr: other runtime diagnostics may contain local account context.
  child.stderr.on('data', () => {})
  child.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) } pending.clear() })
  child.on('exit', () => { stopped = true; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Codex verification process exited.')) } pending.clear() })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.method && message.id !== undefined) {
      child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Interactive server requests are not supported by this internal verifier.' } }) + '\n')
    } else if (message.id !== undefined) {
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id); clearTimeout(item.timer)
      if (message.error) item.reject(new Error(`Codex RPC ${item.method}: ${message.error.message}`))
      else item.resolve(message.result)
    } else if (message.method) events.push(message.method)
  })
  function request(method, params, timeout = 120_000) {
    if (stopped) return Promise.reject(new Error('Codex verification process is closed.'))
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex RPC timed out: ${method}`)) }, timeout)
      pending.set(id, { resolve, reject, timer, method })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }
  async function close() {
    if (stopped) return
    child.stdin.end()
    const timer = setTimeout(() => child.kill('SIGTERM'), 3000).unref()
    await new Promise(resolve => { if (stopped) resolve(); else child.once('exit', resolve) })
    clearTimeout(timer); lines.close()
  }
  try {
    const initialized = await request('initialize', { clientInfo: { name: 'publication_internal_verifier', version: '0.4.0' }, capabilities: { experimentalApi: true } })
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    const started = await request('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never' })
    const threadId = started.thread.id
    const status = await request('mcpServerStatus/list', { threadId, serverName: 'publication_engine', detail: 'toolsAndAuthOnly' })
    const server = status.data.find(server => server.name === 'publication_engine')
    if (!server || !Object.keys(server.tools || {}).length) throw new Error('Codex did not load publication_engine tools from this project.')
    return {
      executable, initialized, threadId, server, events,
      async callTool(tool, args = {}) {
        const response = await request('mcpServer/tool/call', { threadId, server: 'publication_engine', tool, arguments: args })
        if (response.isError) throw new Error(`MCP tool failed: ${tool}: ${response.content?.find(item => item.type === 'text')?.text || 'unknown'}`)
        if (response.structuredContent !== undefined && response.structuredContent !== null) return response.structuredContent
        const text = response.content?.find(item => item.type === 'text')?.text
        if (!text) throw new Error(`MCP tool returned no structured result: ${tool}`)
        return JSON.parse(text)
      },
      close,
    }
  } catch (error) { await close(); throw error }
}
