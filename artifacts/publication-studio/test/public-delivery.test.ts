import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLocalPublicationPlatform } from '@publication-mcp-studio/platform'
import { createPublicationClient } from '../../../packages/publication-client/src/index.js'
import { createPublishedApp } from '../../api-server/src/published-app.js'
import { websiteEnvironment } from '../../../scripts/website-env.mjs'
import { createPublicationWebsite } from '../server.mjs'

test('production website serves public HTML/Markdown/discovery while preserving the draft boundary', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'publication-public-'))
  const overrides = {
    PUBLICATION_PLATFORM_ADAPTER: 'local', PUBLICATION_LOCAL_ROOT_DIR: root,
    PUBLICATION_LOCAL_SEED_DEMO_CONTENT: 'false', PUBLICATION_ADMIN_EMAIL: 'owner@example.invalid',
    PUBLICATION_ADMIN_PASSWORD: 'test-only-password', PUBLICATION_API_SECRET: 'test-only-secret', LOG_LEVEL: 'silent',
  }
  const previous = { ...process.env }
  Object.assign(process.env, overrides)
  delete process.env.PUBLICATION_ADMIN_ORIGIN
  t.after(async () => {
    for (const key of [...Object.keys(overrides), 'PUBLICATION_ADMIN_ORIGIN']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await rm(root, { recursive: true, force: true })
  })
  const { default: api } = await import('../../api-server/src/app.js')
  const apiServer = api.listen(0, '127.0.0.1')
  await once(apiServer, 'listening')
  const apiAddress = apiServer.address() as { port: number }
  const apiOrigin = `http://127.0.0.1:${apiAddress.port}`
  const feed = createPublishedApp().listen(0, '127.0.0.1')
  await once(feed, 'listening')
  const publishedOrigin = `http://127.0.0.1:${(feed.address() as { port: number }).port}`
  const web = createPublicationWebsite({ siteUrl: 'https://publisher.example', publishedOrigin }).listen(0, '127.0.0.1')
  await once(web, 'listening')
  const webOrigin = `http://127.0.0.1:${(web.address() as { port: number }).port}`
  for (const server of [web, feed, apiServer]) t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const login = await fetch(`${apiOrigin}/api/auth/local-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: overrides.PUBLICATION_ADMIN_EMAIL, password: overrides.PUBLICATION_ADMIN_PASSWORD }),
  })
  assert.equal(login.status, 200, await login.clone().text())
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const signed = await createPublicationClient({ origin: apiOrigin }).adminLogin({ email: overrides.PUBLICATION_ADMIN_EMAIL, password: overrides.PUBLICATION_ADMIN_PASSWORD })
  const engine = createPublicationClient({ origin: apiOrigin, token: signed.token.token })
  const platform = createLocalPublicationPlatform({ rootDir: root, seedDemoContent: false })
  const record = await platform.publicationStore.createArticle({
    id: 'public-test-id', title: 'Crawlable evidence', slug: 'crawlable-evidence', status: 'draft', category: null, tags: [], metadata: {},
    contentMarkdown: '---\ntitle: "Crawlable evidence"\nabstract: "Description visible to crawlers."\nauthors:\n  - "Ada Example"\nheroImage: "/figure.png"\n---\n\n## Initial response\n\nThe entire article is readable without JavaScript.\n\n![Evidence](/figure.png)\n',
    createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T01:00:00.000Z',
  })
  await t.test('website has no authoring surface, proxy, or writable routes even with valid engine credentials', async () => {
    for (const route of ['/admin/login', '/admin/articles', '/api/auth/local-login', '/api/publications/mcp', '/api/publications/tokens', '/mcp', '/%61pi/publications/mcp']) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const response = await fetch(webOrigin + route, { method, headers: { cookie, authorization: `Bearer ${signed.token.token}` } })
        assert.equal(response.status, 404, `${method} ${route}`)
      }
    }
    for (const route of ['/publications', '/content/articles', '/sitemap.xml']) {
      assert.equal((await fetch(webOrigin + route, { method: 'POST' })).status, 405)
    }
    for (const route of ['/articles', '/articles/crawlable-evidence', '/api/publications/mcp']) assert.equal((await fetch(publishedOrigin + route, { method: 'POST' })).status, 405)
    assert.equal((await fetch(publishedOrigin + '/api/publications/mcp')).status, 404)
    assert.doesNotMatch(await (await fetch(webOrigin)).text(), /Open Admin|MCP Health|AdminLoginPage/)
    const env = websiteEnvironment({ PATH: '/bin', PUBLICATION_API_SECRET: 'private', DATABASE_URL: 'private', VITE_PRIVATE_TOKEN: 'private' }, { port: 5180, publishedOrigin, siteUrl: webOrigin })
    assert.deepEqual(Object.keys(env).sort(), ['BASE_PATH', 'HOST', 'NODE_ENV', 'PATH', 'PORT', 'PUBLICATION_PUBLISHED_ORIGIN', 'PUBLICATION_SITE_URL'].sort())
  })
  await t.test('public JSON feed cannot be promoted to draft access with tokens or query options', async () => {
    for (const origin of [webOrigin + '/content', publishedOrigin]) {
      const headers = { cookie, authorization: `Bearer ${signed.token.token}` }
      assert.equal((await fetch(`${origin}/articles/${record.slug}?status=all`, { headers })).status, 404)
      const response = await fetch(`${origin}/articles?status=all&includeDrafts=true&includeContent=true`, { headers })
      assert.deepEqual((await response.json()).articles, [])
      assert.equal((await fetch(`${origin}/articles/${record.id}`, { headers })).status, 404)
    }
  })
  await t.test('one scoped harness publishes PDF, image and dataset attachments with readable text and immediate withdrawal', async () => {
    const minted = await fetch(apiOrigin + '/api/publications/tokens', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Harness', scopes: ['mcp:connect', 'articles:read', 'articles:write', 'articles:publish'] }) })
    assert.equal(minted.status, 201)
    const token = (await minted.json()).token.token
    const agent = createPublicationClient({ origin: apiOrigin, token })
    const toolNames = (await agent.listTools()).result.tools.map(tool => tool.name)
    assert.ok(toolNames.includes('begin_media_upload'))
    assert.ok(toolNames.includes('publish_article'))
    assert.ok(!toolNames.includes('delete_article'))
    assert.ok(!toolNames.includes('delete_media'))
    const article = (await agent.createArticle({ title: 'Attached evidence', slug: 'attached-evidence', body: '## Findings\n\nRead the supporting evidence.' })).article
    const assets = []
    for (const file of [
      { fileName: 'report.pdf', contentType: 'application/pdf', data: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1200000, 32)]), label: 'Full report', textContent: 'The report supports the published finding.' },
      { fileName: 'plot.png', contentType: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'), label: 'Evidence plot', textContent: '' },
      { fileName: 'data.csv', contentType: 'text/csv', data: Buffer.from('sample,value\na,42'), label: 'Supporting dataset', textContent: 'sample,value\na,42' },
    ]) {
      const { asset } = await agent.uploadMedia({ identifier: article.id, ...file })
      assets.push(asset)
      await agent.attachMedia(article.id, { url: asset.publicUrl, label: file.label, description: 'Supporting material attached through MCP.', textContent: file.textContent })
      assert.equal((await fetch(webOrigin + asset.publicUrl)).status, 404)
    }
    assert.equal((await agent.getArticle(article.id)).article.metadata.attachments instanceof Array, true)
    await assert.rejects(() => agent.listTokens(), { status: 403 })
    await agent.publishArticle(article.id)
    const html = await (await fetch(webOrigin + '/publications/' + article.slug)).text()
    assert.match(html, /The report supports the published finding/)
    assert.match(html, /href="[^"]+\.pdf"/)
    assert.match(html, /alt="Supporting material attached through MCP/)
    const markdown = await (await fetch(webOrigin + '/publications/' + article.slug + '.md')).text()
    assert.match(markdown, /https:\/\/publisher.example\/__publication-local\/media\/attached-evidence/)
    assert.match(markdown, /sample,value/)
    for (const asset of assets) {
      const live = await fetch(webOrigin + asset.publicUrl)
      assert.equal(live.status, 200)
      assert.equal(live.headers.get('content-type'), asset.contentType)
      assert.equal(live.headers.get('x-robots-tag'), null)
      if (asset.contentType === 'application/pdf') assert.match(live.headers.get('content-disposition')!, /^attachment/)
      await live.arrayBuffer()
    }
    await agent.unpublishArticle(article.id)
    for (const asset of assets) assert.equal((await fetch(webOrigin + asset.publicUrl)).status, 404)
    assert.equal((await fetch(webOrigin + '/publications/' + article.slug + '.md')).status, 404)
    await engine.deleteArticle(article.id)
  })
  await t.test('MCP alone creates, edits, publishes, updates and unpublishes across the reader website', async () => {
    const tool = async (name: string, args: Record<string, unknown>) => {
      const response = await engine.callTool<any>(name, args)
      assert.ok(!response.error && !response.result?.isError, JSON.stringify(response))
      return response.result.structuredContent
    }
    const { article } = await tool('create_article', { title: 'Engine lifecycle', slug: 'engine-lifecycle', body: 'Private original draft', status: 'draft' })
    assert.equal((await fetch(webOrigin + '/publications/engine-lifecycle')).status, 404)
    assert.equal((await fetch(webOrigin + '/publications/engine-lifecycle.md')).status, 404)
    await tool('update_article', { identifier: article.id, body: 'Verified through MCP, separate from the website.' })
    assert.match((await tool('get_article', { identifier: article.id })).article.contentMarkdown, /Verified through MCP/)
    await tool('publish_article', { identifier: article.id })
    assert.match(await (await fetch(webOrigin + '/publications/engine-lifecycle')).text(), /Verified through MCP/)
    assert.match(await (await fetch(webOrigin + '/publications/engine-lifecycle.md')).text(), /Verified through MCP/)
    assert.match(await (await fetch(webOrigin + '/sitemap.xml')).text(), /engine-lifecycle/)
    assert.equal((await fetch(webOrigin + '/content/articles/' + article.id)).status, 404, 'public feed requires canonical slug, not engine ID')
    const revision = (await tool('create_revision', { identifier: article.id })).article
    await tool('update_article', { identifier: revision.id, body: 'A revised public edition.' })
    assert.doesNotMatch(await (await fetch(webOrigin + '/publications/engine-lifecycle.md')).text(), /A revised public edition/)
    assert.equal((await fetch(webOrigin + '/publications/' + revision.slug + '.md')).status, 404)
    const review = await tool('prepare_publication', { identifier: revision.id })
    await tool('publish_revision', { identifier: revision.id, expectedDigest: review.digest })
    assert.match(await (await fetch(webOrigin + '/publications/engine-lifecycle.md')).text(), /A revised public edition/)
    await tool('unpublish_article', { identifier: article.id })
    for (const suffix of ['', '.md', '/raw']) assert.equal((await fetch(webOrigin + '/publications/engine-lifecycle' + suffix)).status, 404)
    assert.doesNotMatch(await (await fetch(webOrigin + '/sitemap.xml')).text(), /engine-lifecycle/)
    assert.doesNotMatch(await (await fetch(webOrigin + '/publications')).text(), /engine-lifecycle/)
    assert.equal((await tool('get_article', { identifier: article.id })).article.status, 'draft')
  })
  await t.test('drafts never appear publicly, even for a signed-in admin', async () => {
    for (const suffix of ['', '.md', '/raw']) {
      const response = await fetch(`${webOrigin}/publications/${record.slug}${suffix}`, { headers: { cookie } })
      assert.equal(response.status, 404)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.doesNotMatch(await response.text(), /Crawlable evidence|Ada Example|entire article/)
    }
    for (const path of ['/publications', '/sitemap.xml']) assert.doesNotMatch(await (await fetch(webOrigin + path)).text(), /crawlable-evidence/)
  })
  await t.test('uploaded local media remains private until referenced by its published article and disappears on unpublish', async () => {
    const created = await engine.callTool<any>('create_article', { title: 'Media lifecycle', slug: 'media-lifecycle', body: 'Private media draft' })
    const id = created.result.structuredContent.article.id
    const uploaded = await engine.callTool<any>('upload_media', { articleIdentifier: id, fileName: 'proof.svg', contentType: 'image/svg+xml', dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>').toString('base64') })
    const asset = uploaded.result.structuredContent.asset
    assert.ok(asset.publicUrl.startsWith('/__publication-local/'))
    assert.equal((await fetch(webOrigin + asset.publicUrl)).status, 404)
    await engine.callTool('update_article', { identifier: id, body: asset.embedMarkdown })
    assert.equal((await fetch(webOrigin + asset.publicUrl)).status, 404)
    await engine.callTool('publish_article', { identifier: id })
    const response = await fetch(webOrigin + asset.publicUrl)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type')!, /image\/svg\+xml/)
    assert.match(await response.text(), /fill="blue"/)
    const revise = async (body: string) => {
      const fork = (await engine.callTool<any>('create_revision', { identifier: id })).result.structuredContent.article
      await engine.callTool('update_article', { identifier: fork.id, body })
      const review = (await engine.callTool<any>('prepare_publication', { identifier: fork.id })).result.structuredContent
      const published = await engine.callTool<any>('publish_revision', { identifier: fork.id, expectedDigest: review.digest })
      assert.ok(!published.error && !published.result?.isError)
    }
    await revise('No longer referencing the uploaded asset.')
    assert.equal((await fetch(webOrigin + asset.publicUrl)).status, 404)
    await revise(asset.embedMarkdown)
    await engine.callTool('unpublish_article', { identifier: id })
    assert.equal((await fetch(webOrigin + asset.publicUrl)).status, 404)
  })
  await platform.publicationStore.updateArticle(record.id, { status: 'published' })
  await t.test('draft uploads cannot evict live assets, and approved revision media survives revision cleanup', async () => {
    const issued = await fetch(apiOrigin + '/api/publications/tokens', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Draft-only media author', scopes: ['mcp:connect', 'articles:read', 'articles:write'] }) })
    const writer = createPublicationClient({ origin: apiOrigin, token: (await issued.json()).token.token })
    const create = await engine.callTool<any>('create_article', { title: 'Revision media', slug: 'revision-media', body: 'Draft' })
    const id = create.result.structuredContent.article.id
    const upload = async (client: typeof engine, identifier: string, fileName: string) => {
      const result = await client.callTool<any>('upload_media', { articleIdentifier: identifier, fileName, contentType: 'text/plain', dataBase64: 'eA==' })
      assert.ok(!result.error && !result.result?.isError)
      return result.result.structuredContent.asset
    }
    const originalAsset = await upload(writer, id, 'original.txt')
    await engine.callTool('update_article', { identifier: id, body: originalAsset.embedMarkdown })
    await engine.callTool('publish_article', { identifier: id })
    for (let index = 0; index < 200; index++) await upload(writer, id, `additional-${index}.txt`)
    assert.equal((await fetch(webOrigin + originalAsset.publicUrl)).status, 200)
    const fork = (await writer.callTool<any>('create_revision', { identifier: id })).result.structuredContent.article
    const newAsset = await upload(writer, fork.id, 'revision.txt')
    assert.match(newAsset.publicUrl, /\/media\/revision-media\//)
    assert.equal((await fetch(webOrigin + newAsset.publicUrl)).status, 404)
    await writer.callTool('update_article', { identifier: fork.id, body: newAsset.embedMarkdown })
    const prepared = (await writer.callTool<any>('prepare_publication', { identifier: fork.id })).result.structuredContent
    await engine.callTool('publish_revision', { identifier: fork.id, expectedDigest: prepared.digest })
    assert.equal((await fetch(webOrigin + newAsset.publicUrl)).status, 200)
    await engine.callTool('delete_article', { identifier: fork.id })
    assert.equal((await fetch(webOrigin + newAsset.publicUrl)).status, 200)
    await engine.callTool('unpublish_article', { identifier: id })
    assert.equal((await fetch(webOrigin + newAsset.publicUrl)).status, 404)
  })
  await t.test('all iframe directives are sandboxed and bibliography metadata cannot become HTML', async () => {
    const guarded = await platform.publicationStore.createArticle({ ...record, id: 'renderer-guard', slug: 'renderer-guard', status: 'published', contentMarkdown: '## Embeds\n\n::interactive{src="https://viewer.example/a"}\n\n::notebook{src="https://viewer.example/b"}\n\n::lean{src="https://viewer.example/c"}\n\n::proof{src="https://viewer.example/d"}\n\n::reference{id="example" title="<img src=x onerror=alert(1)>" authors="Person Example" year="2026"}\n\n::bibliography{}' })
    try {
      const response = await fetch(webOrigin + '/publications/renderer-guard')
      assert.match(response.headers.get('content-security-policy')!, /object-src 'none'/)
      const html = await response.text(), frames = html.match(/<iframe[^>]*>/g) || []
      assert.equal(frames.length, 4)
      for (const frame of frames) { assert.match(frame, /sandbox="allow-scripts"/); assert.match(frame, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/) }
      assert.doesNotMatch(html, /<img src=x onerror=alert/)
      assert.equal((await fetch(webOrigin + '/healthz')).status, 200)
    } finally { await platform.publicationStore.deleteArticle(guarded.id) }
  })
  await t.test('initial HTML includes rendered article, metadata, canonical and discoverable Markdown', async () => {
    const response = await fetch(`${webOrigin}/publications/${record.slug}`)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /<h1[^>]*>[\s\S]*?Crawlable evidence/)
    assert.match(html, /The entire article is readable without JavaScript\./)
    assert.match(html, /<h2[^>]*id="initial-response"/)
    assert.match(html, /name="description" content="Description visible to crawlers\."/)
    assert.match(html, /https:\/\/publisher.example\/publications\/crawlable-evidence.md/)
    assert.match(html, /<script[^>]+src="\/assets\//)
    const ld = JSON.parse(html.match(/type="application\/ld\+json">(.*?)<\/script>/)![1])
    assert.equal(ld.headline, record.title)
    assert.equal(ld.author[0].name, 'Ada Example')
    const css = html.match(/href="(\/assets\/[^" ]+\.css)"/)![1]
    assert.equal((await fetch(webOrigin + css)).status, 200)
  })
  await t.test('quoted article titles agree between rendered HTML and structured metadata', async () => {
    const title = 'Crawlable "quoted" evidence'
    await platform.publicationStore.updateArticle(record.id, {
      title,
      contentMarkdown: record.contentMarkdown.replace('title: "Crawlable evidence"', `title: ${JSON.stringify(title)}`),
    })
    const html = await (await fetch(`${webOrigin}/publications/${record.slug}`)).text()
    const ld = JSON.parse(html.match(/type="application\/ld\+json">(.*?)<\/script>/)![1])
    assert.equal(ld.headline, title)
    assert.match(html, /<h1[^>]*>[\s\S]*?Crawlable &quot;quoted&quot; evidence/)
  })
  await t.test('public Markdown and raw alias need no credentials; HEAD returns headers without content', async () => {
    const response = await fetch(`${webOrigin}/publications/${record.slug}.md`)
    assert.match(response.headers.get('content-type')!, /^text\/markdown/)
    const markdown = await response.text()
    assert.match(markdown, /## Initial response/)
    assert.match(markdown, /canonicalUrl: "https:\/\/publisher.example\/publications\/crawlable-evidence"/)
    assert.match(markdown, /https:\/\/publisher.example\/figure.png/)
    assert.equal(await (await fetch(`${webOrigin}/publications/${record.slug}/raw`)).text(), markdown)
    const head = await fetch(`${webOrigin}/publications/${record.slug}.md`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  })
  await t.test('chart values are present in an HTML table without executing JavaScript', async () => {
    await platform.publicationStore.updateArticle(record.id, {
      contentMarkdown: `${record.contentMarkdown}\n::chart{title="Crawler chart" labels="Alpha|Beta" series="Measure:12,24"}\n`,
    })
    const html = await (await fetch(`${webOrigin}/publications/${record.slug}`)).text()
    assert.match(html, /<table[\s\S]*?<th scope="col">Measure<\/th>/)
    assert.match(html, /<th scope="row">Alpha<\/th><td>12<\/td>/)
    assert.match(html, /<th scope="row">Beta<\/th><td>24<\/td>/)
  })
  await t.test('directory and sitemap contain all published records beyond the first page', async () => {
    for (let i = 0; i < 104; i++) await platform.publicationStore.createArticle({ ...record, id: `page-${i}`, slug: `page-${i}`, title: `Page ${i}`, status: 'published' })
    const xml = await (await fetch(`${webOrigin}/sitemap.xml`)).text()
    assert.equal((xml.match(/<loc>/g) || []).length, 106)
    assert.match(xml, /page-103/)
    const directory = await (await fetch(`${webOrigin}/publications`)).text()
    assert.match(directory, /href="\/publications\/page-103"/)
    assert.match(await (await fetch(`${webOrigin}/robots.txt`)).text(), /Sitemap: https:\/\/publisher.example\/sitemap.xml/)
  })
  await t.test('edits appear immediately and unpublishing removes HTML, Markdown and sitemap entries', async () => {
    await platform.publicationStore.updateArticle(record.id, { contentMarkdown: 'Updated published evidence', updatedAt: '2026-10-21T02:00:00.000Z' })
    assert.match(await (await fetch(`${webOrigin}/publications/${record.slug}.md`)).text(), /Updated published evidence/)
    assert.match(await (await fetch(`${webOrigin}/publications/${record.slug}`)).text(), /Updated published evidence/)
    await platform.publicationStore.updateArticle(record.id, { status: 'draft' })
    for (const suffix of ['', '.md', '/raw']) {
      const response = await fetch(`${webOrigin}/publications/${record.slug}${suffix}`, { headers: { cookie } })
      assert.equal(response.status, 404)
      assert.doesNotMatch(await response.text(), /Updated published evidence/)
    }
    assert.doesNotMatch(await (await fetch(`${webOrigin}/sitemap.xml`)).text(), /crawlable-evidence/)
    assert.doesNotMatch(await (await fetch(`${webOrigin}/publications`)).text(), /crawlable-evidence/)
  })
})
