import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { createLocalPublicationPlatform } from './local'
import { PublicationApiError } from './errors'
import {
  hasPublicationS3MediaStorageConfig,
  resolvePublicationMediaStorageDriver,
} from './media-storage'
import type {
  AuditStore,
  MediaStore,
  NeonPublicationPlatformOptions,
  PublicationArticleListOptions,
  PublicationArticleRecord,
  PublicationArticleVersionRecord,
  PublicationAuditEntry,
  PublicationMediaAsset,
  PublicationMediaUploadPayload,
  PublicationPlatform,
  PublicationStore,
  PublicationTokenInventoryRecord,
  PublicationVersionStore,
  TokenStore,
} from './types'

const LOCAL_NEON_MEDIA_BUCKET = 'local-publication-assets'
const NEON_MEDIA_PUBLIC_PREFIX = '/__publication-local/media'

export const NEON_PUBLICATION_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.articles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  content_markdown text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  category text NULL,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS category text NULL,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS articles_category_idx ON public.articles (category);
CREATE INDEX IF NOT EXISTS articles_tags_gin_idx ON public.articles USING gin (tags);

CREATE TABLE IF NOT EXISTS public.publication_api_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  action text NOT NULL,
  actor_label text NOT NULL,
  actor_type text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  route text NOT NULL,
  method text NOT NULL,
  article_id uuid NULL REFERENCES public.articles(id) ON DELETE SET NULL,
  article_slug text NULL,
  status text NOT NULL DEFAULT 'success',
  metadata jsonb NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.publication_api_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  token_type text NOT NULL DEFAULT 'signed',
  scopes text[] NOT NULL DEFAULT '{}',
  profile_id text NULL,
  profile_label text NULL,
  profile_enabled_skill_ids text[] NOT NULL DEFAULT '{}',
  token_enabled_skill_ids text[] NULL,
  allow_profile_skill_overrides boolean NOT NULL DEFAULT false,
  issued_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone NULL,
  last_used_at timestamp with time zone NULL,
  last_used_route text NULL,
  last_used_method text NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.publication_api_tokens
  ADD COLUMN IF NOT EXISTS profile_id text NULL,
  ADD COLUMN IF NOT EXISTS profile_label text NULL,
  ADD COLUMN IF NOT EXISTS profile_enabled_skill_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS token_enabled_skill_ids text[] NULL,
  ADD COLUMN IF NOT EXISTS allow_profile_skill_overrides boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.publication_article_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  source_action text NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  content_markdown text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  actor_label text NULL,
  actor_type text NULL,
  metadata jsonb NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(article_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.publication_media_assets (
  path text PRIMARY KEY,
  bucket text NOT NULL,
  public_url text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'other')),
  article_slug text NOT NULL,
  embed_markdown text NOT NULL DEFAULT '',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_articles_modtime ON public.articles;
CREATE TRIGGER update_articles_modtime
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

DROP TRIGGER IF EXISTS update_publication_api_tokens_modtime ON public.publication_api_tokens;
CREATE TRIGGER update_publication_api_tokens_modtime
  BEFORE UPDATE ON public.publication_api_tokens
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

DROP TRIGGER IF EXISTS update_publication_media_assets_modtime ON public.publication_media_assets;
CREATE TRIGGER update_publication_media_assets_modtime
  BEFORE UPDATE ON public.publication_media_assets
  FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
`

const ARTICLE_COLUMNS = `
  id::text AS id,
  title,
  slug,
  content_markdown,
  COALESCE(metadata, '{}'::jsonb)::text AS metadata_json,
  category,
  array_to_json(tags)::text AS tags_json,
  status,
  created_at::text AS created_at,
  updated_at::text AS updated_at
`

const VERSION_COLUMNS = `
  id::text AS id,
  article_id::text AS article_id,
  version_number,
  source_action,
  title,
  slug,
  content_markdown,
  status,
  actor_label,
  actor_type,
  metadata::text AS metadata_json,
  created_at::text AS created_at
`

const TOKEN_COLUMNS = `
  id::text AS id,
  label,
  token_type,
  array_to_json(scopes)::text AS scopes_json,
  profile_id,
  profile_label,
  array_to_json(profile_enabled_skill_ids)::text AS profile_enabled_skill_ids_json,
  CASE
    WHEN token_enabled_skill_ids IS NULL THEN NULL
    ELSE array_to_json(token_enabled_skill_ids)::text
  END AS token_enabled_skill_ids_json,
  allow_profile_skill_overrides,
  issued_at::text AS issued_at,
  expires_at::text AS expires_at,
  revoked_at::text AS revoked_at,
  last_used_at::text AS last_used_at,
  last_used_route,
  last_used_method,
  created_at::text AS created_at,
  updated_at::text AS updated_at
`

const AUDIT_COLUMNS = `
  id::text AS id,
  action,
  actor_label,
  actor_type,
  array_to_json(scopes)::text AS scopes_json,
  route,
  method,
  article_id::text AS article_id,
  article_slug,
  status,
  metadata::text AS metadata_json,
  created_at::text AS created_at
`

const MEDIA_COLUMNS = `
  bucket,
  path,
  public_url,
  file_name,
  content_type,
  size_bytes,
  kind,
  article_slug,
  embed_markdown,
  created_at::text AS created_at,
  updated_at::text AS updated_at
`

type NeonSqlClient = ReturnType<typeof neon> & {
  query?: (text: string, params?: unknown[]) => Promise<unknown[] | { rows?: unknown[] }>
}

function getNeonDatabaseUrl(options: NeonPublicationPlatformOptions = {}, env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = [
    options.databaseUrl,
    env.NEON_DATABASE_URL,
    env.DATABASE_URL,
    env.POSTGRES_URL,
    env.POSTGRES_PRISMA_URL,
  ].find((value) => value?.trim())?.trim()

  if (!databaseUrl) {
    throw new PublicationApiError(
      500,
      'neon_database_url_missing',
      'Set NEON_DATABASE_URL or DATABASE_URL before using the Neon publication adapter.'
    )
  }

  return databaseUrl
}

function createNeonSql(options: NeonPublicationPlatformOptions = {}) {
  return neon(getNeonDatabaseUrl(options)) as NeonSqlClient
}

async function queryRows(sql: NeonSqlClient, statement: string, params: unknown[] = []) {
  if (typeof sql.query !== 'function') {
    throw new PublicationApiError(500, 'neon_query_unavailable', 'The Neon SQL client does not expose sql.query.')
  }

  try {
    const result = await sql.query(statement, params)
    return (Array.isArray(result) ? result : result.rows ?? []) as Record<string, unknown>[]
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes("Cannot read properties of null (reading 'map')")) {
      return []
    }
    throw error
  }
}

export async function migrateNeonPublicationPlatform(options: NeonPublicationPlatformOptions = {}) {
  const sql = createNeonSql(options)
  const statements = splitSqlStatements(NEON_PUBLICATION_SCHEMA_SQL)

  for (const statement of statements) {
    await queryRows(sql, statement)
  }

  return {
    ok: true,
    statements: statements.length,
  }
}

function splitSqlStatements(sql: string) {
  const statements: string[] = []
  let current = ''
  let dollarQuote: string | null = null

  for (let index = 0; index < sql.length; index += 1) {
    const rest = sql.slice(index)
    const dollarMatch = /^\$[A-Za-z0-9_]*\$/.exec(rest)
    if (dollarMatch) {
      const tag = dollarMatch[0]
      if (!dollarQuote) {
        dollarQuote = tag
      } else if (dollarQuote === tag) {
        dollarQuote = null
      }
      current += tag
      index += tag.length - 1
      continue
    }

    const char = sql[index]
    if (char === ';' && !dollarQuote) {
      const statement = current.trim()
      if (statement) {
        statements.push(statement)
      }
      current = ''
      continue
    }

    current += char
  }

  const tail = current.trim()
  if (tail) {
    statements.push(tail)
  }

  return statements
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  if (!limit || Number.isNaN(limit)) {
    return fallback
  }

  return Math.min(max, Math.max(1, Math.floor(limit)))
}

function isUuid(identifier: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier)
}

function parseJsonObject(value: unknown) {
  if (!value) {
    return {}
  }

  if (typeof value === 'object') {
    return value as Record<string, unknown>
  }

  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value: unknown) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string')
  }

  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function normalizeTimestamp(value: unknown) {
  return value ? new Date(String(value)).toISOString() : new Date(0).toISOString()
}

function normalizeArticleRow(row: Record<string, unknown>): PublicationArticleRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    content_markdown: String(row.content_markdown ?? ''),
    metadata: parseJsonObject(row.metadata_json),
    category: row.category ? String(row.category) : null,
    tags: parseJsonArray(row.tags_json),
    status: row.status === 'published' ? 'published' : 'draft',
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  }
}

function normalizeVersionRow(row: Record<string, unknown>): PublicationArticleVersionRecord {
  return {
    id: String(row.id),
    article_id: String(row.article_id),
    version_number: Number(row.version_number),
    source_action: String(row.source_action),
    title: String(row.title),
    slug: String(row.slug),
    content_markdown: String(row.content_markdown ?? ''),
    status: row.status === 'published' ? 'published' : 'draft',
    actor_label: row.actor_label ? String(row.actor_label) : null,
    actor_type: row.actor_type ? String(row.actor_type) : null,
    metadata: row.metadata_json ? parseJsonObject(row.metadata_json) : null,
    created_at: normalizeTimestamp(row.created_at),
  }
}

function normalizeTokenRow(row: Record<string, unknown>): PublicationTokenInventoryRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    token_type: 'signed',
    scopes: parseJsonArray(row.scopes_json) as PublicationTokenInventoryRecord['scopes'],
    profile_id: row.profile_id ? String(row.profile_id) : null,
    profile_label: row.profile_label ? String(row.profile_label) : null,
    profile_enabled_skill_ids: parseJsonArray(row.profile_enabled_skill_ids_json),
    token_enabled_skill_ids: row.token_enabled_skill_ids_json
      ? parseJsonArray(row.token_enabled_skill_ids_json)
      : null,
    allow_profile_skill_overrides: row.allow_profile_skill_overrides === true,
    issued_at: normalizeTimestamp(row.issued_at),
    expires_at: normalizeTimestamp(row.expires_at),
    revoked_at: row.revoked_at ? normalizeTimestamp(row.revoked_at) : null,
    last_used_at: row.last_used_at ? normalizeTimestamp(row.last_used_at) : null,
    last_used_route: row.last_used_route ? String(row.last_used_route) : null,
    last_used_method: row.last_used_method ? String(row.last_used_method) : null,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  }
}

function normalizeAuditRow(row: Record<string, unknown>): PublicationAuditEntry {
  return {
    id: String(row.id),
    action: row.action as PublicationAuditEntry['action'],
    actor_label: String(row.actor_label),
    actor_type: String(row.actor_type),
    scopes: parseJsonArray(row.scopes_json),
    route: String(row.route),
    method: String(row.method),
    article_id: row.article_id ? String(row.article_id) : null,
    article_slug: row.article_slug ? String(row.article_slug) : null,
    status: String(row.status),
    metadata: row.metadata_json ? parseJsonObject(row.metadata_json) : null,
    created_at: normalizeTimestamp(row.created_at),
  }
}

function normalizeMediaRow(row: Record<string, unknown>): PublicationMediaAsset {
  return {
    bucket: String(row.bucket),
    path: String(row.path),
    publicUrl: String(row.public_url),
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    kind: (row.kind as PublicationMediaAsset['kind']) || 'other',
    articleSlug: String(row.article_slug),
    embedMarkdown: String(row.embed_markdown ?? ''),
    createdAt: row.created_at ? normalizeTimestamp(row.created_at) : undefined,
    updatedAt: row.updated_at ? normalizeTimestamp(row.updated_at) : undefined,
  }
}

function arraySql(value: string[]) {
  return value.length > 0 ? 'string_to_array($PARAM, \',\')::text[]' : 'ARRAY[]::text[]'
}

function uniqueTextArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))]
}

function clampOffset(offset: number | undefined) {
  if (!offset || Number.isNaN(offset)) {
    return 0
  }

  return Math.max(0, Math.floor(offset))
}

function normalizeNullableUuid(value: unknown) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return candidate && isUuid(candidate) ? candidate : null
}

function applyArticleWhere(options: PublicationArticleListOptions, params: unknown[]) {
  const where: string[] = []

  if (options.status && options.status !== 'all') {
    params.push(options.status)
    where.push(`status = $${params.length}`)
  }

  if (options.search?.trim()) {
    params.push(`%${options.search.trim()}%`)
    where.push(`(title ILIKE $${params.length} OR slug ILIKE $${params.length} OR category ILIKE $${params.length})`)
  }

  if (options.category?.trim()) {
    params.push(options.category.trim())
    where.push(`category = $${params.length}`)
  }

  const requestedTags = uniqueTextArray([
    ...(options.tag?.trim() ? [options.tag.trim()] : []),
    ...(options.tags ?? []),
  ])
  if (requestedTags.length > 0) {
    const tagsSql = replaceParam('$ARRAY', requestedTags, params)
    where.push(`tags @> ${tagsSql}`)
  }

  if (options.cursor?.trim()) {
    params.push(options.cursor.trim())
    where.push(`created_at < $${params.length}::timestamptz`)
  }

  return where
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function buildS3PublicUrl(input: {
  bucket: string
  key: string
  region: string
  endpoint?: string
  publicBaseUrl?: string
}) {
  if (input.publicBaseUrl) {
    return `${input.publicBaseUrl.replace(/\/+$/g, '')}/${trimSlashes(input.key)}`
  }

  if (input.endpoint) {
    throw new PublicationApiError(
      500,
      'publication_media_public_url_missing',
      'Set PUBLICATION_MEDIA_PUBLIC_BASE_URL when using a custom S3 endpoint for publication media.'
    )
  }

  return `https://${input.bucket}.s3.${input.region}.amazonaws.com/${trimSlashes(input.key)}`
}

function createS3Client(options: NonNullable<NeonPublicationPlatformOptions['mediaStorage']>) {
  if (!options.bucket || !options.region || !options.accessKeyId || !options.secretAccessKey) {
    throw new PublicationApiError(
      500,
      'publication_media_s3_config_missing',
      'PUBLICATION_MEDIA_S3_BUCKET, PUBLICATION_MEDIA_S3_REGION, PUBLICATION_MEDIA_S3_ACCESS_KEY_ID, and PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY are required for S3 media storage.'
    )
  }

  return new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
    },
  })
}

function replaceParam(sql: string, value: string[], params: unknown[]) {
  const expression = arraySql(value)
  if (expression.includes('$PARAM')) {
    params.push(value.join(','))
    return sql.replace('$ARRAY', expression.replace('$PARAM', `$${params.length}`))
  }

  return sql.replace('$ARRAY', expression)
}

export function createNeonPublicationPlatform(
  options: NeonPublicationPlatformOptions = {}
): PublicationPlatform {
  const sql = createNeonSql(options)
  const rootDir = options.rootDir ?? process.cwd()
  const localSupportPlatform = createLocalPublicationPlatform({
    rootDir,
    seedDemoContent: false,
    adminEmail: options.adminEmail,
    adminPassword: options.adminPassword,
  })
  const mediaStorageDriver = resolvePublicationMediaStorageDriver({
    PUBLICATION_MEDIA_DRIVER: options.mediaStorage?.driver,
    PUBLICATION_MEDIA_S3_BUCKET: options.mediaStorage?.bucket,
    PUBLICATION_MEDIA_S3_REGION: options.mediaStorage?.region,
    PUBLICATION_MEDIA_S3_ENDPOINT: options.mediaStorage?.endpoint,
    PUBLICATION_MEDIA_S3_ACCESS_KEY_ID: options.mediaStorage?.accessKeyId,
    PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY: options.mediaStorage?.secretAccessKey,
    PUBLICATION_MEDIA_S3_SESSION_TOKEN: options.mediaStorage?.sessionToken,
    PUBLICATION_MEDIA_PUBLIC_BASE_URL: options.mediaStorage?.publicBaseUrl,
    PUBLICATION_MEDIA_PREFIX: options.mediaStorage?.prefix,
    PUBLICATION_MEDIA_S3_FORCE_PATH_STYLE:
      typeof options.mediaStorage?.forcePathStyle === 'boolean'
        ? String(options.mediaStorage.forcePathStyle)
        : undefined,
  })
  const mediaStorageOptions = options.mediaStorage ?? {}
  const s3Client = mediaStorageDriver === 's3' ? createS3Client(mediaStorageOptions) : null
  const localPublicRoot = path.join(rootDir, 'public', '__publication-local')
  const localMediaRoot = path.join(localPublicRoot, 'media')

  async function getArticleById(id: string) {
    const rows = await queryRows(sql, `SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id = $1::uuid LIMIT 1`, [id])
    return rows[0] ? normalizeArticleRow(rows[0]) : null
  }

  const publicationStore: PublicationStore = {
    async listArticles(options: PublicationArticleListOptions = {}) {
      const limit = clampLimit(options.limit, 50, 100)
      const params: unknown[] = []
      const where = applyArticleWhere(options, params)

      params.push(limit)
      const limitParam = params.length
      params.push(clampOffset(options.offset))
      const offsetParam = params.length
      const rows = await queryRows(
        sql,
        `SELECT ${ARTICLE_COLUMNS}
         FROM articles
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC
         LIMIT $${limitParam}
         OFFSET $${offsetParam}`,
        params
      )

      return rows.map(normalizeArticleRow)
    },

    async countArticles(options: Omit<PublicationArticleListOptions, 'limit' | 'offset' | 'cursor'> = {}) {
      const params: unknown[] = []
      const where = applyArticleWhere(options, params)
      const rows = await queryRows(
        sql,
        `SELECT COUNT(*)::int AS total
         FROM articles
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`,
        params
      )

      return Number(rows[0]?.total ?? 0)
    },

    async getArticleByIdentifier(identifier: string) {
      const cleanIdentifier = identifier.trim()
      if (!cleanIdentifier) {
        return null
      }

      if (isUuid(cleanIdentifier)) {
        const article = await getArticleById(cleanIdentifier)
        if (article) {
          return article
        }
      }

      const rows = await queryRows(sql, `SELECT ${ARTICLE_COLUMNS} FROM articles WHERE slug = $1 LIMIT 1`, [cleanIdentifier])
      return rows[0] ? normalizeArticleRow(rows[0]) : null
    },

    async createArticle(input: PublicationArticleRecord) {
      const params: unknown[] = [
        input.id,
        input.title,
        input.slug,
        input.content_markdown,
        JSON.stringify(input.metadata ?? {}),
        input.category ?? null,
        input.status,
        input.created_at,
        input.updated_at,
      ]
      const tagsSql = replaceParam('$ARRAY', uniqueTextArray(input.tags), params)
      await queryRows(
        sql,
        `INSERT INTO articles (id, title, slug, content_markdown, metadata, category, tags, status, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, ${tagsSql}, $7, $8::timestamptz, $9::timestamptz)`,
        params
      )

      const article = await getArticleById(input.id)
      if (!article) {
        throw new PublicationApiError(500, 'article_create_failed', 'Neon did not return the created article.')
      }

      return article
    },

    async updateArticle(id: string, updates: Partial<PublicationArticleRecord>) {
      const existingArticle = await publicationStore.getArticleByIdentifier(id)
      if (!existingArticle) {
        throw new PublicationApiError(404, 'article_not_found', `Article ${id} was not found.`)
      }

      const nextArticle = { ...existingArticle, ...updates }
      const params: unknown[] = [
        existingArticle.id,
        nextArticle.title,
        nextArticle.slug,
        nextArticle.content_markdown,
        JSON.stringify(nextArticle.metadata ?? {}),
        nextArticle.category ?? null,
        nextArticle.status,
        nextArticle.created_at,
        nextArticle.updated_at,
      ]
      const tagsSql = replaceParam('$ARRAY', uniqueTextArray(nextArticle.tags), params)
      await queryRows(
        sql,
        `UPDATE articles
         SET title = $2,
             slug = $3,
             content_markdown = $4,
             metadata = $5::jsonb,
             category = $6,
             tags = ${tagsSql},
             status = $7,
             created_at = $8::timestamptz,
             updated_at = $9::timestamptz
         WHERE id = $1::uuid`,
        params
      )

      const article = await getArticleById(existingArticle.id)
      if (!article) {
        throw new PublicationApiError(500, 'article_update_failed', 'Neon did not return the updated article.')
      }

      return article
    },

    async deleteArticle(id: string) {
      await queryRows(sql, 'DELETE FROM articles WHERE id = $1::uuid', [id])
    },
  }

  const versionStore: PublicationVersionStore = {
    async createVersion(input) {
      const id = randomUUID()
      await queryRows(
        sql,
        `INSERT INTO publication_article_versions (
          id, article_id, version_number, source_action, title, slug, content_markdown,
          status, actor_label, actor_type, metadata, created_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())`,
        [
          id,
          input.article_id,
          input.version_number,
          input.source_action,
          input.title,
          input.slug,
          input.content_markdown,
          input.status,
          input.actor_label,
          input.actor_type,
          JSON.stringify(input.metadata ?? null),
        ]
      )

      const rows = await queryRows(sql, `SELECT ${VERSION_COLUMNS} FROM publication_article_versions WHERE id = $1::uuid`, [id])
      if (!rows[0]) {
        throw new PublicationApiError(500, 'article_version_create_failed', 'Neon did not return the created article version.')
      }

      return normalizeVersionRow(rows[0])
    },

    async listVersions(articleId: string) {
      const rows = await queryRows(
        sql,
        `SELECT ${VERSION_COLUMNS}
         FROM publication_article_versions
         WHERE article_id = $1::uuid
         ORDER BY version_number DESC`,
        [articleId]
      )

      return rows.map(normalizeVersionRow)
    },

    async getVersion(articleId: string, versionId: string) {
      const rows = await queryRows(
        sql,
        `SELECT ${VERSION_COLUMNS}
         FROM publication_article_versions
         WHERE article_id = $1::uuid AND id = $2::uuid
         LIMIT 1`,
        [articleId, versionId]
      )

      return rows[0] ? normalizeVersionRow(rows[0]) : null
    },
  }

  const tokenStore: TokenStore = {
    async createTokenRecord(input) {
      const id = randomUUID()
      const params: unknown[] = [
        id,
        input.label,
        input.profileId ?? null,
        input.profileLabel ?? null,
        input.allowProfileSkillOverrides ?? false,
        input.issuedAt,
        input.expiresAt,
      ]
      let scopesSql = replaceParam('$ARRAY', input.scopes, params)
      scopesSql = scopesSql.replace(`$${params.length}`, '$8')
      const scopesParam = params.pop()
      params.push(scopesParam)
      const profileSql = replaceParam('$ARRAY', input.profileEnabledSkillIds ?? [], params)
      let tokenSql = 'NULL'

      if (input.tokenEnabledSkillIds && input.tokenEnabledSkillIds.length > 0) {
        tokenSql = replaceParam('$ARRAY', input.tokenEnabledSkillIds, params)
      }

      await queryRows(
        sql,
        `INSERT INTO publication_api_tokens (
          id, label, token_type, profile_id, profile_label, allow_profile_skill_overrides,
          issued_at, expires_at, scopes, profile_enabled_skill_ids, token_enabled_skill_ids
        )
        VALUES (
          $1::uuid, $2, 'signed', $3, $4, $5, $6::timestamptz, $7::timestamptz,
          ${scopesSql}, ${profileSql}, ${tokenSql}
        )`,
        params
      )

      const token = await tokenStore.getTokenRecord(id)
      if (!token) {
        throw new PublicationApiError(500, 'token_inventory_create_failed', 'Neon did not return the created token.')
      }

      return token
    },

    async listTokenRecords(limit = 50) {
      const rows = await queryRows(
        sql,
        `SELECT ${TOKEN_COLUMNS}
         FROM publication_api_tokens
         ORDER BY created_at DESC
         LIMIT $1`,
        [clampLimit(limit, 50, 100)]
      )

      return rows.map(normalizeTokenRow)
    },

    async getTokenRecord(tokenId: string) {
      const rows = await queryRows(
        sql,
        `SELECT ${TOKEN_COLUMNS}
         FROM publication_api_tokens
         WHERE id = $1::uuid
         LIMIT 1`,
        [tokenId]
      )

      return rows[0] ? normalizeTokenRow(rows[0]) : null
    },

    async revokeTokenRecord(tokenId: string) {
      await queryRows(
        sql,
        `UPDATE publication_api_tokens
         SET revoked_at = NOW(), updated_at = NOW()
         WHERE id = $1::uuid`,
        [tokenId]
      )

      const token = await tokenStore.getTokenRecord(tokenId)
      if (!token) {
        throw new PublicationApiError(404, 'token_not_found', `Token ${tokenId} was not found.`)
      }

      return token
    },

    async touchTokenRecord(tokenId: string, route: string, method: string) {
      try {
        await queryRows(
          sql,
          `UPDATE publication_api_tokens
           SET last_used_at = NOW(), last_used_route = $2, last_used_method = $3, updated_at = NOW()
           WHERE id = $1::uuid`,
          [tokenId, route, method]
        )
      } catch (error) {
        console.error('Failed to update publication token last-used metadata:', error)
      }
    },
  }

  const auditStore: AuditStore = {
    async recordEvent(input) {
      const params: unknown[] = [
        input.action,
        input.actor_label,
        input.actor_type,
        input.route,
        input.method,
        normalizeNullableUuid(input.article_id),
        input.article_slug,
        input.status,
        JSON.stringify(input.metadata ?? null),
      ]
      const scopesSql = replaceParam('$ARRAY', input.scopes, params)

      await queryRows(
        sql,
        `INSERT INTO publication_api_audit_log (
          action, actor_label, actor_type, route, method, article_id, article_slug, status, metadata, scopes
        )
        VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9::jsonb, ${scopesSql})`,
        params
      )
    },

    async listEvents(limit = 30) {
      const rows = await queryRows(
        sql,
        `SELECT ${AUDIT_COLUMNS}
         FROM publication_api_audit_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [clampLimit(limit, 30, 100)]
      )

      return rows.map(normalizeAuditRow)
    },
  }

  const mediaStore: MediaStore = {
    async uploadMedia(input: PublicationMediaUploadPayload) {
      const fileName = `${Date.now()}-${input.fileName}`
      const baseKey = `publications/${input.articleSlug}/${fileName}`
      const objectKey = mediaStorageOptions.prefix
        ? `${trimSlashes(mediaStorageOptions.prefix)}/${baseKey}`
        : baseKey
      let bucket = LOCAL_NEON_MEDIA_BUCKET
      let publicUrl = `${NEON_MEDIA_PUBLIC_PREFIX}/${input.articleSlug}/${fileName}`
      let sizeBytes = input.data.byteLength

      if (mediaStorageDriver === 's3') {
        if (!hasPublicationS3MediaStorageConfig({
          PUBLICATION_MEDIA_S3_BUCKET: mediaStorageOptions.bucket,
          PUBLICATION_MEDIA_S3_REGION: mediaStorageOptions.region,
          PUBLICATION_MEDIA_S3_ENDPOINT: mediaStorageOptions.endpoint,
          PUBLICATION_MEDIA_S3_ACCESS_KEY_ID: mediaStorageOptions.accessKeyId,
          PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY: mediaStorageOptions.secretAccessKey,
          PUBLICATION_MEDIA_PUBLIC_BASE_URL: mediaStorageOptions.publicBaseUrl,
        })) {
          throw new PublicationApiError(
            500,
            'publication_media_s3_config_missing',
            'Publication media is configured for S3, but the required bucket, region, credentials, or public URL settings are incomplete.'
          )
        }

        bucket = mediaStorageOptions.bucket || 'publication-media'
        publicUrl = buildS3PublicUrl({
          bucket,
          key: objectKey,
          region: mediaStorageOptions.region || 'us-east-1',
          endpoint: mediaStorageOptions.endpoint,
          publicBaseUrl: mediaStorageOptions.publicBaseUrl,
        })

        await s3Client?.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: input.data,
            ContentType: input.contentType,
          })
        )
      } else {
        const diskDirectory = path.join(localMediaRoot, input.articleSlug)
        const diskPath = path.join(diskDirectory, fileName)
        await mkdir(diskDirectory, { recursive: true })
        await writeFile(diskPath, input.data)
        const fileStats = await stat(diskPath)
        sizeBytes = fileStats.size
      }

      await queryRows(
        sql,
        `INSERT INTO publication_media_assets (
          bucket, path, public_url, file_name, content_type, size_bytes, kind, article_slug, embed_markdown
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          bucket,
          objectKey,
          publicUrl,
          fileName,
          input.contentType,
          sizeBytes,
          input.kind,
          input.articleSlug,
          input.embedMarkdown.replaceAll(`/${input.articleSlug}/${input.fileName}`, publicUrl),
        ]
      )

      const rows = await queryRows(sql, `SELECT ${MEDIA_COLUMNS} FROM publication_media_assets WHERE path = $1`, [objectKey])
      if (!rows[0]) {
        throw new PublicationApiError(500, 'media_upload_failed', 'Neon did not return the uploaded media asset.')
      }

      return normalizeMediaRow(rows[0])
    },

    async listMedia(articleSlug: string, limit = 50) {
      const rows = await queryRows(
        sql,
        `SELECT ${MEDIA_COLUMNS}
         FROM publication_media_assets
         WHERE article_slug = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [articleSlug, clampLimit(limit, 50, 200)]
      )

      return rows.map(normalizeMediaRow)
    },

    async deleteMedia(pathToDelete: string) {
      const rows = await queryRows(sql, `SELECT ${MEDIA_COLUMNS} FROM publication_media_assets WHERE path = $1`, [pathToDelete])
      const asset = rows[0] ? normalizeMediaRow(rows[0]) : null
      if (!asset) {
        return
      }

      await queryRows(sql, 'DELETE FROM publication_media_assets WHERE path = $1', [pathToDelete])

      if (mediaStorageDriver === 's3') {
        await s3Client?.send(
          new DeleteObjectCommand({
            Bucket: asset.bucket,
            Key: asset.path,
          })
        ).catch((error) => {
          console.error('Failed to delete publication media object from S3:', error)
        })
        return
      }

      const diskPath = path.join(localPublicRoot, asset.publicUrl.replace('/__publication-local/', ''))
      await unlink(diskPath).catch(() => undefined)
    },
  }

  return {
    kind: 'neon',
    ensureSchema: () => migrateNeonPublicationPlatform(options).then(() => undefined),
    publicationStore,
    versionStore,
    tokenStore,
    auditStore,
    mediaStore,
    adminAuthStore: options.adminAuthStore ?? localSupportPlatform.adminAuthStore,
  }
}
