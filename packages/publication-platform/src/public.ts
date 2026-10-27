import { formatArticleFrontmatter, parseArticleFrontmatter } from './frontmatter'
import { publicationMarkdownWithAttachments, getPublicationAttachments } from './attachments'
import { createPublishedMediaFetchHandler } from './assets'
import type { MediaStore } from './types'
import type { PublicationArticleRecord, PublicationStore } from './types'

export type PublicPublicationMetadata = {
  title: string
  description: string
  canonicalUrl: string
  markdownUrl: string
  authors: string[]
  image?: string
  publishedAt: string
  modifiedAt: string
}

export type PublicPublicationOptions = {
  store: Pick<PublicationStore, 'getArticleByIdentifier' | 'listArticles'>
  siteUrl: string
  siteName?: string
  mediaStore?: MediaStore
  publicationsPath?: string
  /** Trusted host markup, such as stylesheet and module-script tags. */
  headHtml?: string
  renderArticle?: (article: PublicationArticleRecord, metadata: PublicPublicationMetadata) => string | Promise<string>
  renderDirectory?: (articles: PublicationArticleRecord[]) => string | Promise<string>
}

/** A capability-limited JSON feed for a separate reader website. Never uses auth. */
export function createPublishedPublicationFetchHandler(store: Pick<PublicationStore, 'listArticles' | 'getArticleByIdentifier'>) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Read-only published feed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } })
    let result: Response
    try {
      const url = new URL(request.url)
      if (url.pathname === '/articles') {
        const integer = (key: string, fallback: number, max: number) => {
          const value = Number(url.searchParams.get(key) ?? fallback)
          return Number.isSafeInteger(value) && value >= 0 ? Math.min(max, value) : fallback
        }
        const articles = await store.listArticles({ status: 'published', offset: integer('offset', 0, Number.MAX_SAFE_INTEGER), limit: Math.max(1, integer('limit', 100, 100)) })
        result = json({ articles: articles.filter(article => article.status === 'published') })
      } else {
        const match = /^\/articles\/([^/]+)$/.exec(url.pathname)
        const slug = match ? decodeURIComponent(match[1]) : null
        const article = slug ? await store.getArticleByIdentifier(slug) : null
        result = article?.status === 'published' && article.slug === slug ? json({ article }) : json({ error: 'Not found' }, 404)
      }
    } catch (error) {
      result = error instanceof URIError ? json({ error: 'Not found' }, 404) : json({ error: 'Published content unavailable' }, 503)
    }
    return request.method === 'HEAD' ? new Response(null, { status: result.status, headers: result.headers }) : result
  }
}

export function escapePublicationHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function serializePublicPublicationData(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function httpUrl(value: string, base: string) {
  try {
    const url = new URL(value, base)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

export function getPublicPublicationMetadata(article: PublicationArticleRecord, siteUrl: string, publicationsPath = '/publications'): PublicPublicationMetadata {
  const { frontmatter, body } = parseArticleFrontmatter(article.contentMarkdown)
  const text = (key: string) => typeof frontmatter[key] === 'string' ? frontmatter[key] as string : ''
  const articleUrl = new URL(`${publicationsPath}/${encodeURIComponent(article.slug)}`, siteUrl).href
  const authorValue = frontmatter.authors
  const published = text('published')
  return {
    title: text('title') || article.title,
    description: text('abstract') || text('description') || text('subtitle') || body.replace(/[#*`>\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240),
    canonicalUrl: httpUrl(text('canonicalUrl') || articleUrl, siteUrl) || articleUrl,
    markdownUrl: `${articleUrl}.md`,
    authors: Array.isArray(authorValue) ? authorValue : typeof authorValue === 'string' ? [authorValue] : [],
    image: text('heroImage') ? httpUrl(text('heroImage'), articleUrl) : undefined,
    publishedAt: published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : article.createdAt,
    modifiedAt: article.updatedAt,
  }
}

export function getPublicPublicationMarkdown(article: PublicationArticleRecord, metadata: PublicPublicationMetadata) {
  const { frontmatter, body } = parseArticleFrontmatter(publicationMarkdownWithAttachments(article))
  const absolute = (url: string) => url.startsWith('#') ? url : httpUrl(url, metadata.markdownUrl.slice(0, -3)) || url
  // Preserve prose/code; normalize Markdown link/image targets, reference targets
  // and publication media-directive URLs for an independently fetched document.
  const markdown = body.split(/(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`+[^`]*`+)/g).map((part, index) => index % 2 ? part : part
    .replace(/(!?\[[^\]\n]*\]\()([^\s)]+)([^)\n]*\))/g, (_all, before, url, after) => `${before}${absolute(url)}${after}`)
    .replace(/^(\s*\[[^\]\n]+\]:\s*)(\S+)/gm, (_all, before, url) => `${before}${absolute(url)}`)
    .replace(/\b(src|href|url|poster)="([^"]+)"/g, (_all, key, url) => `${key}="${absolute(url)}"`)).join('')
  return `${formatArticleFrontmatter({
    ...frontmatter,
    title: metadata.title,
    authors: metadata.authors,
    canonicalUrl: metadata.canonicalUrl,
    published: metadata.publishedAt,
    revised: metadata.modifiedAt,
  }, markdown)}\n`
}

/** Public GET/HEAD delivery. Cookies and API tokens never grant draft access. */
export function createPublicPublicationFetchHandler(options: PublicPublicationOptions) {
  const site = new URL(options.siteUrl)
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) {
    throw new Error('siteUrl must be an absolute HTTP(S) origin without credentials or a path.')
  }
  const basePath = `/${(options.publicationsPath || '/publications').replace(/^\/+|\/+$/g, '')}`
  const directoryUrl = new URL(basePath, site).href
  const siteName = options.siteName || 'Publication MCP Studio'
  const escape = escapePublicationHtml

  async function allPublished() {
    const articles: PublicationArticleRecord[] = []
    const seen = new Set<string>()
    for (let offset = 0; ; offset += 100) {
      const page = await options.store.listArticles({ status: 'published', offset, limit: 100 })
      for (const article of page) {
        if (seen.has(article.id)) throw new Error('Publication store must support offset pagination.')
        seen.add(article.id)
        if (article.status === 'published') articles.push(article)
      }
      if (page.length < 100) return articles
    }
  }

  function document(title: string, head: string, body: string, data?: unknown) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.svg"><title>${escape(title)}</title>${head}${options.headHtml || ''}</head><body><div id="root">${body}</div>${data ? `<script id="publication-data" type="application/json">${serializePublicPublicationData(data)}</script>` : ''}</body></html>`
  }

  return async function publicPublicationHandler(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname.replace(/\/$/, '') || '/'
    if (options.mediaStore && path.startsWith('/__publication-')) {
      try { return await createPublishedMediaFetchHandler({ publicationStore: options.store as PublicationStore, mediaStore: options.mediaStore })(request) }
      catch { return new Response('Media unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
    }
    const isDirectory = path === basePath
    const isDiscovery = path === '/sitemap.xml' || path === '/robots.txt'
    if (!isDirectory && !isDiscovery && !path.startsWith(`${basePath}/`)) return null
    const respond = (body: string, type: string, status = 200, extra: Record<string, string> = {}) => new Response(request.method === 'HEAD' ? null : body, {
      status,
      headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
    })
    if (!['GET', 'HEAD'].includes(request.method)) return respond('Method not allowed', 'text/plain', 405, { allow: 'GET, HEAD' })
    const notFound = () => respond(document('Publication not found', '<meta name="robots" content="noindex, nofollow">', '<main><h1>Publication not found</h1></main>'), 'text/html', 404, { 'x-robots-tag': 'noindex, nofollow' })
    try {
      if (path === '/robots.txt') {
        return respond(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${new URL('/sitemap.xml', site).href}\n`, 'text/plain')
      }
      if (path === '/sitemap.xml' || isDirectory) {
        const articles = await allPublished()
        if (path === '/sitemap.xml') {
          const entries = [{ url: directoryUrl, modified: '' }, ...articles.map(article => ({
            url: new URL(`${basePath}/${encodeURIComponent(article.slug)}`, site).href,
            modified: article.updatedAt,
          }))]
          return respond(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(entry => `<url><loc>${escape(entry.url)}</loc>${entry.modified && Number.isFinite(Date.parse(entry.modified)) ? `<lastmod>${new Date(entry.modified).toISOString()}</lastmod>` : ''}</url>`).join('')}</urlset>`, 'application/xml')
        }
        const body = options.renderDirectory ? await options.renderDirectory(articles) : `<main><h1>Publications</h1><ul>${articles.map(article => `<li><a href="${escape(`${basePath}/${encodeURIComponent(article.slug)}`)}">${escape(article.title)}</a></li>`).join('')}</ul></main>`
        return respond(document(`Publications | ${siteName}`, `<link rel="canonical" href="${escape(directoryUrl)}"><meta name="description" content="Browse published articles.">`, body, { kind: 'directory', articles }), 'text/html')
      }
      const rawPath = path.slice(basePath.length + 1)
      const markdown = rawPath.endsWith('.md') || rawPath.endsWith('/raw')
      const slug = decodeURIComponent(markdown ? rawPath.replace(/(?:\.md|\/raw)$/, '') : rawPath)
      if (!slug || slug.includes('/') || slug.includes('\\')) return notFound()
      const article = await options.store.getArticleByIdentifier(slug)
      if (!article || article.status !== 'published' || article.slug !== slug) return notFound()
      const meta = getPublicPublicationMetadata(article, site.href, basePath)
      if (markdown) return respond(getPublicPublicationMarkdown(article, meta), 'text/markdown', 200, {
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(article.slug)}.md`,
        link: `<${meta.canonicalUrl}>; rel="canonical"`,
        'x-robots-tag': 'noindex',
      })
      const data = {
        '@context': 'https://schema.org', '@type': 'Article', headline: meta.title,
        description: meta.description, url: meta.canonicalUrl,
        datePublished: meta.publishedAt, dateModified: meta.modifiedAt,
        author: meta.authors.map(name => ({ '@type': 'Person', name })), image: meta.image,
        encoding: { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: meta.markdownUrl },
        associatedMedia: getPublicationAttachments(article).map(asset => ({ '@type': 'MediaObject', name: asset.label, description: asset.description, encodingFormat: asset.contentType, contentUrl: new URL(asset.url, site).href })),
      }
      const head = `<meta name="description" content="${escape(meta.description)}"><link rel="canonical" href="${escape(meta.canonicalUrl)}"><link rel="alternate" type="text/markdown" href="${escape(meta.markdownUrl)}">` +
        `<meta property="og:type" content="article"><meta property="og:title" content="${escape(meta.title)}"><meta property="og:description" content="${escape(meta.description)}"><meta property="og:url" content="${escape(meta.canonicalUrl)}">` +
        `<meta property="article:published_time" content="${escape(meta.publishedAt)}"><meta property="article:modified_time" content="${escape(meta.modifiedAt)}">` +
        `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escape(meta.title)}"><meta name="twitter:description" content="${escape(meta.description)}">` +
        (meta.image ? `<meta property="og:image" content="${escape(meta.image)}"><meta name="twitter:image" content="${escape(meta.image)}">` : '') +
        `<script type="application/ld+json">${serializePublicPublicationData(data)}</script>`
      const body = options.renderArticle ? await options.renderArticle(article, meta) : `<main><article><h1>${escape(meta.title)}</h1><pre>${escape(parseArticleFrontmatter(publicationMarkdownWithAttachments(article)).body)}</pre><a href="${escape(meta.markdownUrl)}">Read Markdown</a></article></main>`
      return respond(document(`${meta.title} | ${siteName}`, head, body, { kind: 'article', article }), 'text/html', 200, {
        link: `<${meta.markdownUrl}>; rel="alternate"; type="text/markdown"`,
      })
    } catch (error) {
      if (error instanceof URIError) return notFound()
      // Fail closed on store/render errors; never expose internal exceptions.
      return respond('Publication temporarily unavailable', 'text/plain', 503, { 'x-robots-tag': 'noindex' })
    }
  }
}
