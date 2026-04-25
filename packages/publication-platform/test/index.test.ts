import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPublicationPlatformRegistry,
  getAvailablePublicationPlatformAdapters,
  getLocalPublicationPlatformOptionsFromEnv,
  getPublicationMediaBucketName,
  getPublicationMediaStorageOptionsFromEnv,
  getNeonPublicationPlatformOptionsFromEnv,
  hasPublicationS3MediaStorageConfig,
  hasNeonPublicationPlatformConfig,
  hasSupabasePublicationPlatformConfig,
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
