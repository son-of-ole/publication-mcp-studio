import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublicationClient } from '../src/index.js'

test('query parameters are appended once for origin, full and relative API bases', async () => {
  for (const options of [
    { origin: 'https://studio.example.invalid' },
    { baseUrl: 'https://studio.example.invalid/api/publications' },
    { baseUrl: '/api/publications' },
  ]) {
    const requests: string[] = []
    const client = createPublicationClient({ ...options, fetch: async input => {
      requests.push(String(input))
      return Response.json({ article: {}, articles: [] })
    } })
    await client.getArticle('article / name', false)
    await client.listArticles({ status: 'draft', tags: ['one', 'two'], offset: 2 })
    assert.equal(requests[0], `${client.baseUrl}/articles/article%20%2F%20name?includeContent=false`)
    assert.equal(requests[1], `${client.baseUrl}/articles?status=draft&tags=one&tags=two&offset=2`)
  }
})
