import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { websiteEnvironment } from './website-env.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const configPath = new URL('../.env.local', import.meta.url)
try {
  await writeFile(configPath, [
    'PUBLICATION_PLATFORM_ADAPTER=local',
    'PUBLICATION_LOCAL_ROOT_DIR=.publication-local-dev',
    'PUBLICATION_LOCAL_SEED_DEMO_CONTENT=false',
    'PUBLICATION_ADMIN_EMAIL=admin@localhost',
    `PUBLICATION_ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}`,
    `PUBLICATION_API_SECRET=${randomBytes(32).toString('base64url')}`,
    'PUBLICATION_WEB_PORT=5180',
    'PUBLICATION_API_PORT=8080',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 })
  console.log('Created private .env.local with generated local admin credentials.')
} catch (error) {
  if (error.code !== 'EEXIST') throw error
}
const config = parseEnv(await readFile(configPath, 'utf8'))
if (config.PUBLICATION_PLATFORM_ADAPTER !== 'local') {
  throw new Error('pnpm dev is the isolated local runner; set PUBLICATION_PLATFORM_ADAPTER=local in .env.local.')
}
const env = { ...process.env, ...config, NODE_ENV: 'development', HOST: '127.0.0.1' }
delete env.REPL_ID
if (!config.PUBLICATION_ADMIN_ORIGIN) delete env.PUBLICATION_ADMIN_ORIGIN
env.PUBLICATION_LOCAL_ROOT_DIR = resolve(root, config.PUBLICATION_LOCAL_ROOT_DIR || '.publication-local-dev')
const webPort = config.PUBLICATION_WEB_PORT || '5180'
const apiPort = config.PUBLICATION_API_PORT || '8080'
const feedPort = config.PUBLICATION_FEED_PORT || '8081'
env.PUBLICATION_FEED_PORT = feedPort

// Build exported SDK entry points before starting their consumers.
await new Promise((resolve, reject) => {
  const build = spawn('pnpm', ['run', 'build:sdk'], { cwd: root, env, stdio: 'inherit' })
  build.on('error', reject)
  build.on('exit', code => code === 0 ? resolve() : reject(new Error(`SDK build exited ${code}`)))
})
const children = [
  spawn('pnpm', ['--filter', '@workspace/api-server', 'dev'], {
    cwd: root, env: { ...env, PORT: apiPort }, stdio: 'inherit', detached: process.platform !== 'win32',
  }),
  spawn('pnpm', ['--filter', '@workspace/publication-studio', 'dev'], {
    cwd: root, env: websiteEnvironment(process.env, { port: webPort, publishedOrigin: `http://127.0.0.1:${feedPort}`, siteUrl: config.PUBLICATION_SITE_URL || `http://127.0.0.1:${webPort}` }), stdio: 'inherit', detached: process.platform !== 'win32',
  }),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) {
    try { if (process.platform === 'win32') child.kill('SIGTERM'); else process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => stop(code || 0))
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
console.log(`Website: http://127.0.0.1:${webPort}/publications`)
console.log(`Private MCP engine: http://127.0.0.1:${apiPort}/api/publications/mcp`)
console.log(`Published feed: http://127.0.0.1:${feedPort} — all services bind to loopback. Private credentials stay in .env.local.`)
