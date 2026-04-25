import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLocalPublicationPlatform } from '@publication-mcp-studio/platform/local'

async function createTempRoot() {
  return mkdtemp(path.join(tmpdir(), 'publication-platform-'))
}

test('seeds demo content by default', async (t) => {
  const rootDir = await createTempRoot()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  const platform = createLocalPublicationPlatform({ rootDir })
  const articles = await platform.publicationStore.listArticles()

  assert.equal(articles.length, 1)
  assert.equal(articles[0]?.slug, 'portable-publication-system-demo')
})

test('persists articles and token records across adapter instances', async (t) => {
  const rootDir = await createTempRoot()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  const firstPlatform = createLocalPublicationPlatform({ rootDir, seedDemoContent: false })
  const now = new Date().toISOString()

  await firstPlatform.publicationStore.createArticle({
    id: 'article-1',
    title: 'Portable Adapter Article',
    slug: 'portable-adapter-article',
    content_markdown: '# Portable Adapter Article',
    status: 'draft',
    created_at: now,
    updated_at: now,
  })

  const tokenRecord = await firstPlatform.tokenStore.createTokenRecord({
    label: 'Local Test Token',
    scopes: ['articles:read'],
    issuedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })

  await firstPlatform.auditStore.recordEvent({
    action: 'articles.create',
    actor_label: 'Test Suite',
    actor_type: 'static',
    scopes: ['articles:write'],
    route: '/tests',
    method: 'POST',
    article_id: 'article-1',
    article_slug: 'portable-adapter-article',
    status: 'success',
    metadata: { source: 'node-test' },
  })

  const secondPlatform = createLocalPublicationPlatform({ rootDir, seedDemoContent: false })
  const persistedArticle = await secondPlatform.publicationStore.getArticleByIdentifier('portable-adapter-article')
  const persistedToken = await secondPlatform.tokenStore.getTokenRecord(tokenRecord.id)
  const auditEvents = await secondPlatform.auditStore.listEvents()
  const stateJson = JSON.parse(
    await readFile(path.join(rootDir, '.publication-mcp-studio', 'state.json'), 'utf8')
  ) as {
    articles: Array<{ slug: string }>
    tokens: Array<{ id: string }>
    audit: Array<{ action: string }>
  }

  assert.equal(persistedArticle?.title, 'Portable Adapter Article')
  assert.equal(persistedToken?.label, 'Local Test Token')
  assert.equal(auditEvents[0]?.action, 'articles.create')
  assert.equal(stateJson.articles[0]?.slug, 'portable-adapter-article')
  assert.equal(stateJson.tokens[0]?.id, tokenRecord.id)
  assert.equal(stateJson.audit[0]?.action, 'articles.create')
})

test('writes, lists, and deletes media assets inside the configured root directory', async (t) => {
  const rootDir = await createTempRoot()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  const platform = createLocalPublicationPlatform({ rootDir, seedDemoContent: false })
  const upload = await platform.mediaStore.uploadMedia({
    articleSlug: 'portable-adapter-article',
    fileName: 'diagram.txt',
    contentType: 'text/plain',
    data: new TextEncoder().encode('portable media asset'),
    kind: 'document',
    embedMarkdown: '[diagram](/portable-adapter-article/diagram.txt)',
  })

  const diskPath = path.join(rootDir, 'public', upload.publicUrl.replace(/^\//, ''))
  await access(diskPath)

  const listedAssets = await platform.mediaStore.listMedia('portable-adapter-article')
  assert.equal(listedAssets.length, 1)
  assert.equal(listedAssets[0]?.path, upload.path)
  assert.match(listedAssets[0]?.embedMarkdown ?? '', /__publication-local\/media/)

  await platform.mediaStore.deleteMedia(upload.path)
  const remainingAssets = await platform.mediaStore.listMedia('portable-adapter-article')

  assert.deepEqual(remainingAssets, [])
})

test('does not reseed over an invalid local state file', async (t) => {
  const rootDir = await createTempRoot()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  const stateDir = path.join(rootDir, '.publication-mcp-studio')
  await access(rootDir)
  await rm(stateDir, { recursive: true, force: true })
  await mkdir(stateDir, { recursive: true })
  await writeFile(path.join(stateDir, 'state.json'), '{"articles": [')

  const platform = createLocalPublicationPlatform({ rootDir })

  await assert.rejects(
    () => platform.publicationStore.listArticles(),
    /invalid JSON/i
  )

  const rawState = await readFile(path.join(stateDir, 'state.json'), 'utf8')
  assert.equal(rawState, '{"articles": [')
})

test('serializes concurrent local writes to avoid lost article updates', async (t) => {
  const rootDir = await createTempRoot()
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  const platform = createLocalPublicationPlatform({ rootDir, seedDemoContent: false })
  const now = new Date().toISOString()

  await platform.publicationStore.createArticle({
    id: 'article-1',
    title: 'Concurrent Local Write Test',
    slug: 'concurrent-local-write-test',
    content_markdown: '# Initial',
    status: 'draft',
    created_at: now,
    updated_at: now,
  })

  await Promise.all([
    platform.publicationStore.updateArticle('article-1', {
      content_markdown: '# Updated',
      updated_at: new Date(Date.now() + 1_000).toISOString(),
    }),
    platform.auditStore.recordEvent({
      action: 'articles.update',
      actor_label: 'Test Suite',
      actor_type: 'static',
      scopes: ['articles:write'],
      route: '/tests',
      method: 'PATCH',
      article_id: 'article-1',
      article_slug: 'concurrent-local-write-test',
      status: 'success',
      metadata: { source: 'concurrency-test' },
    }),
  ])

  const reloadedPlatform = createLocalPublicationPlatform({ rootDir, seedDemoContent: false })
  const article = await reloadedPlatform.publicationStore.getArticleByIdentifier('concurrent-local-write-test')
  const auditEvents = await reloadedPlatform.auditStore.listEvents()

  assert.equal(article?.content_markdown, '# Updated')
  assert.equal(auditEvents[0]?.action, 'articles.update')
})
