import { spawnSync } from 'node:child_process'

// Vite validates these even for static builds. Deployment can override them.
const env = { ...process.env, PORT: process.env.PORT || '5180', BASE_PATH: process.env.BASE_PATH || '/', NODE_ENV: 'production' }
for (const args of [
  ['run', 'build:sdk'],
  ['run', 'typecheck'],
  ['-r', '--filter', './artifacts/**', '--filter', './scripts', '--if-present', 'run', 'build'],
]) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
