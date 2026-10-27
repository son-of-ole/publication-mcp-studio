import { renderToString } from 'react-dom/server'
import { createPublicPublicationFetchHandler } from '@publication-mcp-studio/platform/public'
import type { PublicationArticleRecord } from '@publication-mcp-studio/platform/types'
import { ArticleView } from './pages/ArticlePage'
import { PublicationsView, publicationCards } from './pages/PublicationsPage'
import { createPublishedContentReader } from '../published-content.mjs'

export async function handlePublicRequest(request: Request, options: { siteUrl: string; publishedOrigin: string; headHtml: string }) {
  const read = createPublishedContentReader(options.publishedOrigin)
  async function api(path: string) {
    // Public rendering is always anonymous, even when the visitor is an admin.
    const response = await read(path)
    if (response.status === 404 || response.status === 403) return null
    if (!response.ok) throw new Error('Public article store unavailable')
    return response.json()
  }
  const handler = createPublicPublicationFetchHandler({
    siteUrl: options.siteUrl,
    headHtml: options.headHtml,
    store: {
      async getArticleByIdentifier(slug) {
        const result = await api(`/articles/${encodeURIComponent(slug)}?includeContent=true`)
        return result?.article as PublicationArticleRecord | null
      },
      async listArticles({ offset = 0, limit = 100 } = {}) {
        const result = await api(`/articles?status=published&includeContent=true&offset=${offset}&limit=${limit}`)
        return result?.articles ?? []
      },
    },
    renderArticle: article => renderToString(<ArticleView article={article} />),
    renderDirectory: articles => renderToString(<PublicationsView articles={publicationCards(articles)} />),
  })
  return handler(request)
}
