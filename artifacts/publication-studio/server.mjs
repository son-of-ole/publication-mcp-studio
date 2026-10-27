import express from 'express'
import { createReaderMiddleware } from './published-content.mjs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { handlePublicRequest } from './dist/server/entry-public.js'

const publicDir = fileURLToPath(new URL('./dist/public/', import.meta.url))
const template = await readFile(new URL('./dist/public/index.html', import.meta.url), 'utf8')
const assets = (template.match(/<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*rel="stylesheet"[^>]*>/g) || []).join('')
export function createPublicationWebsite({ siteUrl, publishedOrigin = 'http://127.0.0.1:8081' }) {
  if (!siteUrl) throw new Error('PUBLICATION_SITE_URL must be the public website origin (for example https://publications.example.com).')
  const canonical = new URL(siteUrl)
  if (!['http:', 'https:'].includes(canonical.protocol) || canonical.username || canonical.password || canonical.pathname !== '/' || canonical.search || canonical.hash) throw new Error('PUBLICATION_SITE_URL must be a bare HTTP(S) origin.')
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.set({ 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; media-src 'self' https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' })
    next()
  })
  app.use(createReaderMiddleware({ publishedOrigin }))
  app.use(async (req, res, next) => {
    try {
      const response = await handlePublicRequest(new Request(new URL(req.originalUrl, siteUrl), { method: req.method }), { siteUrl, publishedOrigin, headHtml: assets })
      if (!response) return next()
      res.status(response.status)
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(req.method === 'HEAD' ? undefined : await response.text())
    } catch { res.status(503).set('Cache-Control', 'no-store').end('Publication temporarily unavailable') }
  })
  app.use(express.static(publicDir, { index: false }))
  app.get('/', (_req, res) => res.sendFile(`${publicDir}/index.html`))
  app.use((_req, res) => res.status(404).set('Cache-Control', 'no-store').end('Not found'))
  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createPublicationWebsite({ siteUrl: process.env.PUBLICATION_SITE_URL, publishedOrigin: process.env.PUBLICATION_PUBLISHED_ORIGIN })
    .listen(Number(process.env.PORT || 19344), process.env.HOST || '0.0.0.0', () => console.log('Publication website listening'))
}
