import assert from 'node:assert/strict'
import test from 'node:test'
import { createNeonPublicationPlatform } from '@publication-mcp-studio/platform/neon'

type Call = { sql: string; params: unknown[] }

function makeFakeSqlClient() {
  const calls: Call[] = []
  const fake = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      return { rows: [] }
    },
  }
  return { fake, calls }
}

test('Neon recordEvent inlines NULL for null article_id (issue #2 regression)', async () => {
  const { fake, calls } = makeFakeSqlClient()
  const platform = createNeonPublicationPlatform({ sql: fake })

  await platform.auditStore.recordEvent({
    action: 'test.smoke',
    actor_label: 'sdk-test',
    actor_type: 'system',
    scopes: [],
    route: '/x',
    method: 'GET',
    article_id: null,
    article_slug: null,
    status: 'ok',
    metadata: {},
  })

  const insert = calls.find((c) => /INSERT INTO publication_api_audit_log/i.test(c.sql))
  assert.ok(insert, 'expected an INSERT into publication_api_audit_log')
  assert.match(
    insert.sql,
    /VALUES\s*\([^)]*\bNULL\b[^)]*\)/i,
    `expected the INSERT to inline NULL when article_id is null. got SQL:\n${insert.sql}`
  )
  for (const param of insert.params) {
    assert.notEqual(param, '', 'no param should be the empty string when article_id is null')
  }
})

test('Neon recordEvent binds $N::uuid for a real article_id', async () => {
  const { fake, calls } = makeFakeSqlClient()
  const platform = createNeonPublicationPlatform({ sql: fake })
  const realUuid = '11111111-2222-4333-8444-555555555555'

  await platform.auditStore.recordEvent({
    action: 'test.smoke',
    actor_label: 'sdk-test',
    actor_type: 'system',
    scopes: [],
    route: '/x',
    method: 'GET',
    article_id: realUuid,
    article_slug: 'something',
    status: 'ok',
    metadata: {},
  })

  const insert = calls.find((c) => /INSERT INTO publication_api_audit_log/i.test(c.sql))
  assert.ok(insert, 'expected an INSERT')
  assert.match(insert.sql, /\$\d+::uuid/, 'expected a $N::uuid binding when article_id is present')
  assert.ok(
    (insert.params as unknown[]).includes(realUuid),
    `expected real uuid in params, got: ${JSON.stringify(insert.params)}`
  )
})
