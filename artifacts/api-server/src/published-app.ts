import express from 'express'
import { createPublishedMediaFetchHandler } from '@publication-mcp-studio/platform'
import { createPublishedPublicationFetchHandler } from '@publication-mcp-studio/platform/public'
import type { PublicationStore } from '@publication-mcp-studio/platform/types'
import { getPublicationPlatform } from './publication-lib/publication-platform.js'

/** Separate listener with no authentication, authoring routes or mutation capability. */
export function createPublishedApp(getStore: () => Pick<PublicationStore, 'listArticles' | 'getArticleByIdentifier'> = () => getPublicationPlatform().publicationStore) {
  const app = express()
  app.disable('x-powered-by')
  app.use(async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.set('Allow', 'GET, HEAD').status(405).json({ error: 'Read-only published feed' })
      return
    }
    try {
      if (req.path === '/healthz') { await getStore().listArticles({ status: 'published', limit: 1 }); res.json({ status: 'ready', service: 'published-content' }); return }
      const store = getStore()
      const request = new Request(`http://published.invalid${req.originalUrl}`, { method: req.method })
      const response = req.path.startsWith('/__publication-')
        ? await createPublishedMediaFetchHandler({ publicationStore: store as PublicationStore, mediaStore: getPublicationPlatform().mediaStore })(request)
        : await createPublishedPublicationFetchHandler(store)(request)
      res.status(response.status)
      response.headers.forEach((value, key) => res.setHeader(key, value))
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
    } catch { res.status(503).json({ error: 'Published content unavailable' }) }
  })
  return app
}
