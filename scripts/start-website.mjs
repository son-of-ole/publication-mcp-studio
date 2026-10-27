import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { websiteEnvironment } from './website-env.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = websiteEnvironment(process.env, { port: process.env.PORT || 19344, publishedOrigin: process.env.PUBLICATION_PUBLISHED_ORIGIN || 'http://127.0.0.1:8081', siteUrl: process.env.PUBLICATION_SITE_URL || '' })
env.NODE_ENV = 'production'
env.HOST = process.env.HOST || '0.0.0.0'
const child = spawn(process.execPath, ['artifacts/publication-studio/server.mjs'], { cwd: root, env, stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
