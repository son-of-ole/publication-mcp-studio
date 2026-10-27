import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublishedPublicationFetchHandler, createPublicPublicationFetchHandler, getPublicPublicationMetadata, getPublicPublicationMarkdown } from '../src/public'
import type { PublicationArticleRecord } from '../src/types'

function article(overrides: Partial<PublicationArticleRecord> = {}): PublicationArticleRecord {
  return {
    id: 'article-id', slug: 'example', title: 'Example', status: 'published',
    contentMarkdown: '---\ntitle: "Example"\nabstract: "A complete public article."\nauthors:\n  - "Ada"\nheroImage: "/images/hero.png"\n---\n\n## Evidence\n\nComplete readable body.\n\n![Figure](/images/plot.png)\n',
    metadata: {}, category: null, tags: [], createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T01:00:00.000Z', ...overrides,
  }
}

test('separate published feed ignores credentials and private selectors and rejects mutations and ID aliases', async () => {
  const records = [article(), article({ id: 'draft-id', slug: 'secret', status: 'draft' })]
  const handler = createPublishedPublicationFetchHandler({
    async listArticles(options) { assert.equal(options?.status, 'published'); return records }, // deliberately faulty adapter
    async getArticleByIdentifier(id) { return records.find(record => record.id === id || record.slug === id) || null },
  })
  const read = (route: string, method = 'GET') => handler(new Request(`https://feed.example${route}`, { method, headers: { authorization: 'Bearer admin', cookie: 'admin=true' } }))
  assert.deepEqual((await (await read('/articles?status=all&includeDrafts=true')).json()).articles.map((record: PublicationArticleRecord) => record.slug), ['example'])
  assert.equal((await read('/articles/secret')).status, 404)
  assert.equal((await read('/articles/draft-id')).status, 404)
  assert.equal((await read('/articles/article-id')).status, 404)
  assert.equal((await read('/articles/%E0%A4%A')).status, 404)
  assert.equal((await read('/api/publications/mcp')).status, 404)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await read('/articles/example', method)).status, 405)
  const head = await read('/articles/example', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal(head.headers.get('cache-control'), 'no-store')
})

function host(records: PublicationArticleRecord[]) {
  return createPublicPublicationFetchHandler({
    siteUrl: 'https://publications.example',
    store: {
      async getArticleByIdentifier(slug) { return records.find(record => record.slug === slug || record.id === slug) ?? null },
      async listArticles({ status, offset = 0, limit = 100 } = {}) {
        return records.filter(record => record.status === status).slice(offset, offset + limit)
      },
    },
  })
}
const request = (path: string, init?: RequestInit) => new Request(`https://untrusted-host.invalid${path}`, init)

test('public HTML includes content, metadata, structured data and Markdown discovery on the initial response', async () => {
  const response = await host([article()])(request('/publications/example'))
  assert.equal(response?.status, 200)
  const html = await response!.text()
  assert.match(html, /Complete readable body/)
  assert.match(html, /<title>Example \| Publication MCP Studio<\/title>/)
  assert.match(html, /name="description" content="A complete public article\."/)
  assert.match(html, /rel="canonical" href="https:\/\/publications.example\/publications\/example"/)
  assert.match(html, /rel="alternate" type="text\/markdown"/)
  assert.match(html, /property="og:title"/)
  assert.match(html, /name="twitter:card"/)
  const ld = JSON.parse(html.match(/type="application\/ld\+json">(.*?)<\/script>/)![1])
  assert.equal(ld.author[0].name, 'Ada')
  assert.equal(ld.image, 'https://publications.example/images/hero.png')
  assert.equal(ld.dateModified, article().updatedAt)
  assert.equal(response!.headers.get('cache-control'), 'no-store')
  assert.doesNotMatch(html, /untrusted-host/)
})

test('Markdown is a complete public text file with canonical metadata and absolute media links', async () => {
  const handler = host([article()])
  const response = await handler(request('/publications/example.md'))
  assert.match(response!.headers.get('content-type')!, /^text\/markdown/)
  const markdown = await response!.text()
  assert.match(markdown, /authors:\n  - "Ada"/)
  assert.match(markdown, /canonicalUrl: "https:\/\/publications.example\/publications\/example"/)
  assert.match(markdown, /!\[Figure\]\(https:\/\/publications.example\/images\/plot.png\)/)
  assert.equal(await (await handler(request('/publications/example/raw')))!.text(), markdown)
  const head = await handler(request('/publications/example.md', { method: 'HEAD' }))
  assert.equal(head?.status, 200)
  assert.equal(await head!.text(), '')
})

test('drafts and missing articles are indistinguishable, even with admin credentials', async () => {
  const handler = host([article({ status: 'draft', title: 'PRIVATE TITLE', contentMarkdown: 'PRIVATE BODY' })])
  for (const suffix of ['', '.md', '/raw']) {
    const draft = await handler(request(`/publications/example${suffix}`, { headers: { cookie: 'publication_admin_session=admin', authorization: 'Bearer admin' } }))
    const missing = await handler(request(`/publications/missing${suffix}`))
    assert.equal(draft?.status, 404)
    assert.equal(draft?.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.equal(await draft!.text(), await missing!.text())
  }
  for (const path of ['/sitemap.xml', '/publications']) {
    assert.doesNotMatch(await (await handler(request(path)))!.text(), /PRIVATE|\/example/)
  }
})

test('publish, edit, slug change, unpublish and deletion are reflected immediately without stale public content', async () => {
  const record = article({ status: 'draft' })
  const records = [record]
  const handler = host(records)
  assert.equal((await handler(request('/publications/example')))?.status, 404)
  record.status = 'published'
  assert.equal((await handler(request('/publications/example')))?.status, 200)
  record.contentMarkdown = 'Updated body'
  assert.match(await (await handler(request('/publications/example.md')))!.text(), /Updated body/)
  record.slug = 'renamed'
  assert.equal((await handler(request('/publications/example')))?.status, 404)
  assert.match(await (await handler(request('/sitemap.xml')))!.text(), /\/renamed/)
  record.status = 'draft'
  for (const path of ['/publications/renamed', '/publications/renamed.md', '/publications/renamed/raw']) assert.equal((await handler(request(path)))?.status, 404)
  assert.doesNotMatch(await (await handler(request('/sitemap.xml')))!.text(), /\/renamed/)
  records.length = 0
  assert.equal((await handler(request('/publications/renamed')))?.status, 404)
})

test('sitemap paginates beyond 100 articles and never includes drafts; robots points to configured origin', async () => {
  const records = Array.from({ length: 205 }, (_, i) => article({ id: `id-${i}`, slug: `published-${i}` }))
  records.push(article({ status: 'draft', slug: 'secret-draft' }))
  const handler = host(records)
  const sitemap = await (await handler(request('/sitemap.xml')))!.text()
  assert.equal((sitemap.match(/<loc>/g) || []).length, 206)
  assert.match(sitemap, /published-204/)
  assert.doesNotMatch(sitemap, /secret-draft/)
  const robots = await (await handler(request('/robots.txt')))!.text()
  assert.match(robots, /Disallow: \/admin/)
  assert.match(robots, /Sitemap: https:\/\/publications.example\/sitemap.xml/)
})

test('HTML and bootstrap escape hostile metadata; draft identities and malformed paths never fall through to an indexable SPA', async () => {
  const hostile = '</script><script>alert(1)</script>'
  const handler = host([article({ title: hostile, contentMarkdown: `---\ntitle: ${JSON.stringify(hostile)}\n---\nText` })])
  const html = await (await handler(request('/publications/example')))!.text()
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /&lt;\/script&gt;/)
  for (const slug of ['%E0%A4%A', 'example%2Fhidden', 'article-id', 'example/other']) assert.equal((await handler(request(`/publications/${slug}`)))?.status, 404)
  assert.equal((await handler(request('/publications/example', { method: 'POST' })))?.status, 405)
  assert.equal(await handler(request('/admin/login')), null)
})

test('Markdown preserves code examples when normalizing links', () => {
  const record = article({ contentMarkdown: '![Figure](./plot.png)\n\n`[code](/untouched)`\n\n```md\n[code](/untouched)\n```' })
  const markdown = getPublicPublicationMarkdown(record, getPublicPublicationMetadata(record, 'https://publications.example'))
  assert.match(markdown, /!\[Figure\]\(https:\/\/publications.example\/publications\/plot.png\)/)
  assert.equal((markdown.match(/\[code\]\(\/untouched\)/g) || []).length, 2)
})
