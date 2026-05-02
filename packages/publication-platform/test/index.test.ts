import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  authenticatePublicationRequest,
  createPublicationPlatformRegistry,
  formatArticleFrontmatter,
  getAvailablePublicationPlatformAdapters,
  getLocalPublicationPlatformOptionsFromEnv,
  getPublicationMediaBucketName,
  getPublicationMediaStorageOptionsFromEnv,
  getNeonPublicationPlatformOptionsFromEnv,
  hasPublicationS3MediaStorageConfig,
  hasNeonPublicationPlatformConfig,
  hasSupabasePublicationPlatformConfig,
  issuePublicationToken,
  migrateNeonPublicationPlatform,
  NEON_PUBLICATION_SCHEMA_SQL,
  parseArticleFrontmatter,
  PUBLICATION_MCP_TOOL_SCOPES,
  resolvePublicationMediaStorageDriver,
  resolvePublicationPlatformAdapterName,
} from '@publication-mcp-studio/platform'
import { PublicationApiError } from '@publication-mcp-studio/platform/errors'

test('lists the built-in adapters in stable order', () => {
  assert.deepEqual(getAvailablePublicationPlatformAdapters(), ['local', 'neon', 'supabase'])
})

test('defaults to the local adapter when supabase config is absent', () => {
  assert.equal(hasSupabasePublicationPlatformConfig({}), false)
  assert.equal(resolvePublicationPlatformAdapterName({}), 'local')
})

test('selects the supabase adapter when all required env vars are present', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  }

  assert.equal(hasSupabasePublicationPlatformConfig(env), true)
  assert.equal(resolvePublicationPlatformAdapterName(env), 'supabase')
})

test('selects the neon adapter when a neon database url is present', () => {
  const env = {
    NEON_DATABASE_URL: 'postgresql://user:pass@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech/neondb?sslmode=require',
  }

  assert.equal(hasNeonPublicationPlatformConfig(env), true)
  assert.equal(resolvePublicationPlatformAdapterName(env), 'neon')
})

test('honors an explicit adapter override before auto-detection', () => {
  const env = {
    PUBLICATION_PLATFORM_ADAPTER: 'local',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  }

  assert.equal(resolvePublicationPlatformAdapterName(env), 'local')
})

test('throws a structured error for an unknown adapter override', () => {
  assert.throws(
    () => resolvePublicationPlatformAdapterName({ PUBLICATION_PLATFORM_ADAPTER: 'sqlite' }),
    (error: unknown) => {
      assert.ok(error instanceof PublicationApiError)
      assert.equal(error.code, 'platform_adapter_unknown')
      return true
    }
  )
})

test('reads local adapter options from env for portable integrations', () => {
  const env = {
    PUBLICATION_LOCAL_ROOT_DIR: '/tmp/publication-platform-fixture',
    PUBLICATION_LOCAL_SEED_DEMO_CONTENT: 'false',
    PUBLICATION_ADMIN_EMAIL: 'admin@example.com',
    PUBLICATION_ADMIN_PASSWORD: 'secret',
  }

  assert.deepEqual(getLocalPublicationPlatformOptionsFromEnv(env), {
    rootDir: '/tmp/publication-platform-fixture',
    seedDemoContent: false,
    adminEmail: 'admin@example.com',
    adminPassword: 'secret',
  })
})

test('reads neon adapter options from env for portable integrations', () => {
  const env = {
    NEON_DATABASE_URL: 'postgresql://user:pass@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech/neondb?sslmode=require',
    PUBLICATION_LOCAL_ROOT_DIR: '/tmp/publication-platform-fixture',
    PUBLICATION_ADMIN_EMAIL: 'admin@example.com',
    PUBLICATION_ADMIN_PASSWORD: 'secret',
    PUBLICATION_MEDIA_DRIVER: 's3',
    PUBLICATION_MEDIA_S3_BUCKET: 'publication-assets',
    PUBLICATION_MEDIA_S3_REGION: 'us-east-2',
    PUBLICATION_MEDIA_S3_ACCESS_KEY_ID: 'key-id',
    PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
    PUBLICATION_MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/publication-assets',
  }

  assert.deepEqual(getNeonPublicationPlatformOptionsFromEnv(env), {
    databaseUrl:
      'postgresql://user:pass@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech/neondb?sslmode=require',
    rootDir: '/tmp/publication-platform-fixture',
    seedDemoContent: undefined,
    adminEmail: 'admin@example.com',
    adminPassword: 'secret',
    mediaStorage: {
      driver: 's3',
      bucket: 'publication-assets',
      region: 'us-east-2',
      endpoint: undefined,
      accessKeyId: 'key-id',
      secretAccessKey: 'secret-key',
      sessionToken: undefined,
      publicBaseUrl: 'https://cdn.example.com/publication-assets',
      prefix: undefined,
      forcePathStyle: undefined,
    },
  })
})

test('reads publication media storage options from env', () => {
  const env = {
    PUBLICATION_MEDIA_DRIVER: 's3',
    PUBLICATION_MEDIA_S3_BUCKET: 'publication-assets',
    PUBLICATION_MEDIA_S3_REGION: 'us-east-2',
    PUBLICATION_MEDIA_S3_ENDPOINT: 'https://s3.us-east-2.amazonaws.com',
    PUBLICATION_MEDIA_S3_ACCESS_KEY_ID: 'key-id',
    PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
    PUBLICATION_MEDIA_S3_SESSION_TOKEN: 'session-token',
    PUBLICATION_MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/publication-assets',
    PUBLICATION_MEDIA_PREFIX: 'tenant-a',
    PUBLICATION_MEDIA_S3_FORCE_PATH_STYLE: 'true',
  }

  assert.deepEqual(getPublicationMediaStorageOptionsFromEnv(env), {
    driver: 's3',
    bucket: 'publication-assets',
    region: 'us-east-2',
    endpoint: 'https://s3.us-east-2.amazonaws.com',
    accessKeyId: 'key-id',
    secretAccessKey: 'secret-key',
    sessionToken: 'session-token',
    publicBaseUrl: 'https://cdn.example.com/publication-assets',
    prefix: 'tenant-a',
    forcePathStyle: true,
  })
})

test('defaults publication media storage to local when s3 config is absent', () => {
  assert.equal(resolvePublicationMediaStorageDriver({}), 'local')
  assert.equal(getPublicationMediaBucketName({}), 'local-publication-assets')
  assert.equal(hasPublicationS3MediaStorageConfig({}), false)
})

test('detects s3 publication media storage when config is complete', () => {
  const env = {
    PUBLICATION_MEDIA_S3_BUCKET: 'publication-assets',
    PUBLICATION_MEDIA_S3_REGION: 'us-east-2',
    PUBLICATION_MEDIA_S3_ACCESS_KEY_ID: 'key-id',
    PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY: 'secret-key',
    PUBLICATION_MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/publication-assets',
  }

  assert.equal(hasPublicationS3MediaStorageConfig(env), true)
  assert.equal(resolvePublicationMediaStorageDriver(env), 's3')
  assert.equal(getPublicationMediaBucketName(env), 'publication-assets')
})

test('threads local adapter env options into the registry', async () => {
  const env = {
    PUBLICATION_LOCAL_ROOT_DIR: '/tmp/publication-platform-registry',
    PUBLICATION_LOCAL_SEED_DEMO_CONTENT: 'false',
  }

  const platform = createPublicationPlatformRegistry(env).local()
  const articles = await platform.publicationStore.listArticles()

  assert.equal(platform.kind, 'local')
  assert.deepEqual(articles, [])
})

test('ships canonical MCP tool scope metadata', () => {
  assert.equal(PUBLICATION_MCP_TOOL_SCOPES.create_article, 'articles:write')
  assert.equal(PUBLICATION_MCP_TOOL_SCOPES.publish_article, 'articles:publish')
  assert.equal(PUBLICATION_MCP_TOOL_SCOPES.generate_publication_draft, 'agent:generate')
})

test('frontmatter helpers parse and format canonical article metadata', () => {
  const markdown = formatArticleFrontmatter(
    {
      title: 'SDK Article',
      authors: ['Ada', 'Grace'],
      category: 'science',
    },
    '## Body'
  )
  const parsed = parseArticleFrontmatter(markdown)

  assert.deepEqual(parsed.frontmatter, {
    title: 'SDK Article',
    authors: ['Ada', 'Grace'],
    category: 'science',
  })
  assert.equal(parsed.body, '## Body')
})

test('auth helper verifies signed tokens, registry records, scopes, and touch metadata', async () => {
  const platform = createPublicationPlatformRegistry({
    PUBLICATION_LOCAL_ROOT_DIR: '/tmp/publication-platform-auth-helper',
    PUBLICATION_LOCAL_SEED_DEMO_CONTENT: 'false',
  }).local()
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 60_000).toISOString()
  const tokenRecord = await platform.tokenStore.createTokenRecord({
    label: 'SDK Auth Test',
    scopes: ['articles:read'],
    issuedAt,
    expiresAt,
  })
  const issued = issuePublicationToken({
    tokenId: tokenRecord.id,
    label: tokenRecord.label,
    scopes: tokenRecord.scopes,
    issuedAt,
    expiresAt,
    secret: 'test-secret',
  })
  const auth = await authenticatePublicationRequest({
    headers: new Headers({ authorization: `Bearer ${issued.token}` }),
    requiredScopes: ['articles:read'],
    platform,
    secrets: ['test-secret'],
    route: '/tests',
    method: 'GET',
  })
  const touchedRecord = await platform.tokenStore.getTokenRecord(tokenRecord.id)

  assert.equal(auth.tokenId, tokenRecord.id)
  assert.equal(touchedRecord?.last_used_route, '/tests')
  await assert.rejects(
    () => authenticatePublicationRequest({
      headers: new Headers({ authorization: `Bearer ${issued.token}` }),
      requiredScopes: ['articles:write'],
      platform,
      secrets: ['test-secret'],
    }),
    /missing the required scope/
  )
})

test('neon adapter avoids fragile SELECT star and RETURNING star patterns', async () => {
  const source = await readFile(new URL('../src/neon.ts', import.meta.url), 'utf8')

  assert.equal(/\bSELECT\s+\*/i.test(source), false)
  assert.equal(/\bRETURNING\s+\*/i.test(source), false)
  assert.match(source, /id::text AS id/)
  assert.match(source, /metadata jsonb NOT NULL DEFAULT/)
})

test('neon migration helper and packaged SQL include metadata schema', async () => {
  const migrationFile = await readFile(
    new URL('../migrations/neon_schema.sql', import.meta.url),
    'utf8'
  )

  assert.equal(typeof migrateNeonPublicationPlatform, 'function')
  assert.match(NEON_PUBLICATION_SCHEMA_SQL, /metadata jsonb NOT NULL DEFAULT/)
  assert.match(migrationFile, /metadata jsonb NOT NULL DEFAULT/)
})
