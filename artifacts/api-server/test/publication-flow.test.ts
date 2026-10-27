import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPublicationClient, PUBLICATION_SCOPES } from '../../../packages/publication-client/src/index.js'

test('HTTP host: authenticated draft/edit/publish, public read, SDK, MCP and logout', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'publication-flow-'))
  const env = {
    PUBLICATION_PLATFORM_ADAPTER: 'local', PUBLICATION_LOCAL_ROOT_DIR: root,
    PUBLICATION_LOCAL_SEED_DEMO_CONTENT: 'false', PUBLICATION_ADMIN_EMAIL: 'test@example.invalid',
    PUBLICATION_ADMIN_PASSWORD: 'test-only-password', PUBLICATION_API_SECRET: 'test-only-token-secret',
    LOG_LEVEL: 'silent',
  }
  const previous = { ...process.env }
  Object.assign(process.env, env)
  delete process.env.PUBLICATION_ADMIN_ORIGIN
  t.after(async () => {
    for (const key of [...Object.keys(env), 'PUBLICATION_ADMIN_ORIGIN']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await rm(root, { recursive: true, force: true })
  })
  const { default: app } = await import('../src/app.js')
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  async function request(route: string, method = 'GET', body?: unknown, cookie?: string, headers = {}) {
    return fetch(`${origin}/api${route}`, {
      method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
    })
  }
  const loginBody = { email: env.PUBLICATION_ADMIN_EMAIL, password: env.PUBLICATION_ADMIN_PASSWORD }
  await t.test('forged session cannot read, mutate or mint API tokens', async () => {
    const forged = 'publication_admin_session=test%40example.invalid'
    assert.equal((await request('/admin/articles-list', 'GET', undefined, forged)).status, 401)
    assert.equal((await request('/admin/articles', 'POST', { title: 'forged' }, forged)).status, 401)
    assert.equal((await request('/publications/tokens', 'POST', {}, forged)).status, 401)
    assert.equal((await request('/auth/local-login', 'POST', { ...loginBody, password: 'wrong' })).status, 401)
    assert.equal((await request('/auth/local-login', 'POST', loginBody, undefined, { origin: 'https://attacker.invalid' })).status, 403)
  })
  const login = await request('/auth/local-login', 'POST', loginBody, undefined, { origin })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  assert.match(login.headers.get('set-cookie')!, /HttpOnly/)
  assert.equal((await request('/admin/articles-list', 'GET', undefined, cookie)).status, 200)
  await t.test('SDK operator tokens can list and revoke while ordinary agent tokens cannot manage credentials', async () => {
    const issued = await request('/publications/tokens', 'POST', { label: 'SDK operator verification', scopes: [...PUBLICATION_SCOPES] }, cookie, { origin })
    assert.equal(issued.status, 201)
    const payload = await issued.json()
    const operator = createPublicationClient({ origin, token: payload.token.token })
    assert.ok((await operator.listTokens()).tokens.some(token => token.id === payload.tokenRecord.id))
    assert.equal((await request('/publications/tokens', 'GET', undefined, cookie, { authorization: 'Bearer invalid' })).status, 401)
    await operator.revokeToken(payload.tokenRecord.id)
    await assert.rejects(() => operator.listArticles(), { status: 401 })
  })
  let articleId = ''
  await t.test('draft stays private and edits persist through the real stores', async () => {
    const created = await request('/admin/articles', 'POST', {
      title: 'Local flow', slug: 'local-flow', contentMarkdown: '## Evidence\n\nOriginal draft.', status: 'draft',
    }, cookie, { origin })
    assert.equal(created.status, 201, await created.clone().text())
    articleId = (await created.json()).article.id
    const publicList = await (await request('/publications/articles?status=all')).json()
    assert.equal(publicList.articles.length, 0)
    assert.equal((await request('/publications/articles/local-flow')).status, 403)
    const edited = await request(`/admin/articles/${articleId}`, 'PATCH', {
      title: 'Verified local flow', contentMarkdown: '## Evidence\n\nEdited and persisted.', status: 'draft',
    }, cookie, { origin })
    assert.equal(edited.status, 200, await edited.clone().text())
    const reread = await (await request(`/admin/articles-list/${articleId}`, 'GET', undefined, cookie)).json()
    assert.match(reread.article.contentMarkdown, /Edited and persisted/)
    assert.match(await readFile(path.join(root, '.publication-mcp-studio', 'state.json'), 'utf8'), /Edited and persisted/)
  })
  const anonymousClient = createPublicationClient({ origin })
  const signed = await anonymousClient.adminLogin(loginBody)
  const client = createPublicationClient({ origin, token: signed.token.token })
  await t.test('SDK reads draft, publishes, and public readers receive the saved content', async () => {
    assert.equal((await client.getArticle(articleId)).article.status, 'draft')
    assert.equal((await client.publishArticle(articleId)).article.status, 'published')
    const publicArticle = await (await request('/publications/articles/local-flow')).json()
    assert.equal(publicArticle.article.title, 'Verified local flow')
    assert.match(publicArticle.article.contentMarkdown, /Edited and persisted/)
    const versions = await (await request(`/publications/articles/${articleId}/versions`, 'GET', undefined, cookie)).json()
    assert.ok(versions.versions.length >= 3)
  })
  await t.test('MCP initializes, discovers and executes create/edit/publish/read tools', async () => {
    const initialized = await client.mcpRequest<any>({ method: 'initialize' })
    assert.equal(initialized.result.serverInfo.name, 'publication-mcp-studio')
    assert.ok((await client.listTools()).result.tools.some(tool => tool.name === 'create_article'))
    const created = await client.callTool<any>('create_article', { title: 'MCP flow', slug: 'mcp-flow', body: 'MCP original', status: 'draft' })
    assert.ok(!created.error, JSON.stringify(created.error))
    const mcpId = created.result.structuredContent.article.id
    const updated = await client.callTool<any>('update_article', { identifier: mcpId, body: 'MCP edited' })
    assert.match(updated.result.structuredContent.article.contentMarkdown, /MCP edited/)
    const published = await client.callTool<any>('publish_article', { identifier: mcpId })
    assert.equal(published.result.structuredContent.article.status, 'published')
    const read = await client.callTool<any>('get_article', { identifier: mcpId })
    assert.match(read.result.structuredContent.article.contentMarkdown, /MCP edited/)
    assert.equal((await anonymousClient.getArticle('mcp-flow')).article.status, 'published')
  })
  await t.test('read-only token cannot mutate through REST or MCP and revocation takes effect', async () => {
    const issued = await request('/publications/tokens', 'POST', { label: 'Read only', scopes: ['mcp:connect', 'articles:read'] }, cookie, { origin })
    assert.equal(issued.status, 201)
    const token = await issued.json()
    const reader = createPublicationClient({ origin, token: token.token.token })
    assert.equal((await reader.getArticle(articleId)).article.id, articleId)
    await assert.rejects(() => reader.createArticle({ title: 'Denied' }), { status: 403 })
    const denied = await reader.callTool<any>('create_article', { title: 'Denied' }).catch(error => error)
    assert.ok(denied.status === 403 || denied.error, 'MCP must reject unauthorized writes')
    const correlated = await request('/publications/mcp', 'POST', { jsonrpc: '2.0', id: 'denied-write-receipt', method: 'tools/call', params: { name: 'create_article', arguments: { title: 'Denied' } } }, undefined, { authorization: `Bearer ${token.token.token}` })
    assert.equal(correlated.status, 403)
    const rejection = await correlated.json()
    assert.equal(rejection.id, 'denied-write-receipt')
    assert.equal(rejection.error.data.code, 'insufficient_scope')
    assert.equal((await request(`/publications/tokens/${token.tokenRecord.id}/revoke`, 'POST', {}, cookie, { origin })).status, 200)
    await assert.rejects(() => reader.getArticle(articleId), { status: 401 })
  })
  await t.test('draft writers cannot publish, withdraw, restore into live state or change a live article through alternate routes', async () => {
    const issued = await request('/publications/tokens', 'POST', { label: 'Draft writer', scopes: ['mcp:connect', 'articles:read', 'articles:write'] }, cookie, { origin })
    const token = (await issued.json()).token.token
    const headers = { authorization: `Bearer ${token}` }
    assert.equal((await request('/publications/articles', 'POST', { title: 'Denied publish', status: 'published' }, undefined, headers)).status, 403)
    assert.equal((await request(`/publications/articles/${articleId}`, 'PATCH', { status: 'draft' }, undefined, headers)).status, 403)
    assert.equal((await request(`/publications/articles/${articleId}`, 'PATCH', { body: 'Hidden overwrite' }, undefined, headers)).status, 403)
    const versions = (await (await request(`/publications/articles/${articleId}/versions`, 'GET', undefined, cookie)).json()).versions
    const publishedVersion = versions.find((version: any) => version.status === 'published')
    assert.ok(publishedVersion)
    assert.equal((await request(`/publications/articles/${articleId}/versions/${publishedVersion.id}/restore`, 'POST', {}, undefined, headers)).status, 403)
    assert.equal((await request(`/publications/articles/${articleId}/unpublish`, 'POST', {}, undefined, headers)).status, 403)
    const writer = createPublicationClient({ origin, token })
    const denied = await writer.callTool<any>('create_article', { title: 'MCP denied', status: 'published' }).catch(error => error)
    assert.ok(denied.status === 403 || denied.error || denied.result?.isError)
    await client.unpublishArticle(articleId)
    const restored = await request(`/publications/articles/${articleId}/versions/${publishedVersion.id}/restore`, 'POST', {}, undefined, headers)
    assert.equal(restored.status, 200, await restored.clone().text())
    assert.equal((await restored.json()).article.status, 'draft', 'historical published status must not silently republish')
    for (const route of ['/extract-text', '/publications/import', '/publications/media']) {
      const form = new FormData(); form.append('file', new Blob(['Private upload']), 'article.md')
      assert.equal((await fetch(`${origin}/api${route}`, { method: 'POST', body: form })).status, 401)
    }
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]), 'large.md')
    assert.equal((await fetch(origin + '/api/publications/import', { method: 'POST', headers, body: form })).status, 413)
  })
  await t.test('logout revokes captured cookie and protected requests return 401', async () => {
    assert.equal((await request('/auth/signout', 'POST', undefined, cookie, { origin })).status, 302)
    assert.equal((await request('/admin/articles-list', 'GET', undefined, cookie)).status, 401)
  })
})
