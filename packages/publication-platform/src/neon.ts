import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { createLocalPublicationPlatform } from '@publication-platform/local'
import { PublicationApiError } from '@publication-platform/errors'
import {
  hasPublicationS3MediaStorageConfig,
  resolvePublicationMediaStorageDriver,
} from '@publication-platform/media-storage'
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
  PublicationTokenInventoryRecord,
  PublicationVersionStore,
  PublicationStore,
  TokenStore,
} from '@publication-platform/types'

const LOCAL_NEON_MEDIA_BUCKET = 'local-publication-assets'
const NEON_MEDIA_PUBLIC_PREFIX = '/__publication-local/media'

function getNeonDatabaseUrl(options: NeonPublicationPlatformOptions = {}, env: NodeJS.ProcessEnv = process.env) {
  const candidates = [
    options.databaseUrl,
    env.NEON_DATABASE_URL,
    env.DATABASE_URL,
    env.POSTGRES_URL,
    env.POSTGRES_PRISMA_URL,
  ]

  const databaseUrl = candidates.find((value) => value?.trim())?.trim()

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
  return neon(getNeonDatabaseUrl(options))
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

function normalizeArticleRow(row: Record<string, unknown>): PublicationArticleRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    content_markdown: String(row.content_markdown ?? ''),
    status: row.status === 'published' ? 'published' : 'draft',
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
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
    metadata:
      row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null,
    created_at: new Date(String(row.created_at)).toISOString(),
  }
}

function normalizeTokenRow(row: Record<string, unknown>): PublicationTokenInventoryRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    token_type: 'signed',
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((value): value is PublicationTokenInventoryRecord['scopes'][number] => typeof value === 'string') : [],
    profile_id: row.profile_id ? String(row.profile_id) : null,
    profile_label: row.profile_label ? String(row.profile_label) : null,
    profile_enabled_skill_ids: Array.isArray(row.profile_enabled_skill_ids)
      ? row.profile_enabled_skill_ids.filter((value): value is string => typeof value === 'string')
      : [],
    token_enabled_skill_ids: Array.isArray(row.token_enabled_skill_ids)
      ? row.token_enabled_skill_ids.filter((value): value is string => typeof value === 'string')
      : null,
    allow_profile_skill_overrides: row.allow_profile_skill_overrides === true,
    issued_at: new Date(String(row.issued_at)).toISOString(),
    expires_at: new Date(String(row.expires_at)).toISOString(),
    revoked_at: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    last_used_at: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
    last_used_route: row.last_used_route ? String(row.last_used_route) : null,
    last_used_method: row.last_used_method ? String(row.last_used_method) : null,
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  }
}

function normalizeAuditRow(row: Record<string, unknown>): PublicationAuditEntry {
  return {
    id: String(row.id),
    action: row.action as PublicationAuditEntry['action'],
    actor_label: String(row.actor_label),
    actor_type: String(row.actor_type),
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((value): value is string => typeof value === 'string') : [],
    route: String(row.route),
    method: String(row.method),
    article_id: row.article_id ? String(row.article_id) : null,
    article_slug: row.article_slug ? String(row.article_slug) : null,
    status: String(row.status),
    metadata:
      row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null,
    created_at: new Date(String(row.created_at)).toISOString(),
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
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined,
  }
}

function buildScopeArrayExpression(scopes: string[]) {
  const scopesCsv = scopes.join(',')
  return {
    scopesCsv,
    hasScopes: scopesCsv.length > 0,
  }
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

  const publicationStore: PublicationStore = {
    async listArticles(options: PublicationArticleListOptions = {}) {
      const limit = clampLimit(options.limit, 50, 100)
      const search = options.search?.trim()

      let rows: Record<string, unknown>[] = []

      if (options.status && options.status !== 'all' && search) {
        rows = await sql`
          SELECT *
          FROM articles
          WHERE status = ${options.status}
            AND (title ILIKE ${`%${search}%`} OR slug ILIKE ${`%${search}%`})
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      } else if (options.status && options.status !== 'all') {
        rows = await sql`
          SELECT *
          FROM articles
          WHERE status = ${options.status}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      } else if (search) {
        rows = await sql`
          SELECT *
          FROM articles
          WHERE title ILIKE ${`%${search}%`} OR slug ILIKE ${`%${search}%`}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      } else {
        rows = await sql`
          SELECT *
          FROM articles
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      }

      return rows.map(normalizeArticleRow)
    },

    async getArticleByIdentifier(identifier: string) {
      const cleanIdentifier = identifier.trim()
      if (!cleanIdentifier) {
        return null
      }

      let rows: Record<string, unknown>[] = []

      if (isUuid(cleanIdentifier)) {
        rows = await sql`
          SELECT *
          FROM articles
          WHERE id = ${cleanIdentifier}
          LIMIT 1
        `

        if (rows[0]) {
          return normalizeArticleRow(rows[0])
        }
      }

      rows = await sql`
        SELECT *
        FROM articles
        WHERE slug = ${cleanIdentifier}
        LIMIT 1
      `

      return rows[0] ? normalizeArticleRow(rows[0]) : null
    },

    async createArticle(input: PublicationArticleRecord) {
      const rows = await sql`
        INSERT INTO articles (
          id,
          title,
          slug,
          content_markdown,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ${input.id},
          ${input.title},
          ${input.slug},
          ${input.content_markdown},
          ${input.status},
          ${input.created_at},
          ${input.updated_at}
        )
        RETURNING *
      `

      if (!rows[0]) {
        throw new PublicationApiError(500, 'article_create_failed', 'Neon did not return the created article.')
      }

      return normalizeArticleRow(rows[0])
    },

    async updateArticle(id: string, updates: Partial<PublicationArticleRecord>) {
      const existingArticle = await publicationStore.getArticleByIdentifier(id)

      if (!existingArticle) {
        throw new PublicationApiError(404, 'article_not_found', `Article ${id} was not found.`)
      }

      const nextArticle = {
        ...existingArticle,
        ...updates,
      }

      const rows = await sql`
        UPDATE articles
        SET
          title = ${nextArticle.title},
          slug = ${nextArticle.slug},
          content_markdown = ${nextArticle.content_markdown},
          status = ${nextArticle.status},
          created_at = ${nextArticle.created_at},
          updated_at = ${nextArticle.updated_at}
        WHERE id = ${existingArticle.id}
        RETURNING *
      `

      if (!rows[0]) {
        throw new PublicationApiError(500, 'article_update_failed', 'Neon did not return the updated article.')
      }

      return normalizeArticleRow(rows[0])
    },

    async deleteArticle(id: string) {
      await sql`
        DELETE FROM articles
        WHERE id = ${id}
      `
    },
  }

  const versionStore: PublicationVersionStore = {
    async createVersion(input) {
      const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null
      const rows = await sql`
        INSERT INTO publication_article_versions (
          article_id,
          version_number,
          source_action,
          title,
          slug,
          content_markdown,
          status,
          actor_label,
          actor_type,
          metadata,
          created_at
        )
        VALUES (
          ${input.article_id},
          ${input.version_number},
          ${input.source_action},
          ${input.title},
          ${input.slug},
          ${input.content_markdown},
          ${input.status},
          ${input.actor_label},
          ${input.actor_type},
          ${metadataJson}::jsonb,
          NOW()
        )
        RETURNING *
      `

      if (!rows[0]) {
        throw new PublicationApiError(
          500,
          'article_version_create_failed',
          'Neon did not return the created article version.'
        )
      }

      return normalizeVersionRow(rows[0])
    },

    async listVersions(articleId: string) {
      const rows = await sql`
        SELECT *
        FROM publication_article_versions
        WHERE article_id = ${articleId}
        ORDER BY version_number DESC
      `

      return rows.map(normalizeVersionRow)
    },

    async getVersion(articleId: string, versionId: string) {
      const rows = await sql`
        SELECT *
        FROM publication_article_versions
        WHERE article_id = ${articleId} AND id = ${versionId}
        LIMIT 1
      `

      return rows[0] ? normalizeVersionRow(rows[0]) : null
    },
  }

  const tokenStore: TokenStore = {
    async createTokenRecord(input) {
      const rows = await sql`
        INSERT INTO publication_api_tokens (
          label,
          token_type,
          scopes,
          profile_id,
          profile_label,
          profile_enabled_skill_ids,
          token_enabled_skill_ids,
          allow_profile_skill_overrides,
          issued_at,
          expires_at
        )
        VALUES (
          ${input.label},
          'signed',
          ${input.scopes},
          ${input.profileId ?? null},
          ${input.profileLabel ?? null},
          ${input.profileEnabledSkillIds ?? []},
          ${input.tokenEnabledSkillIds ?? null},
          ${input.allowProfileSkillOverrides ?? false},
          ${input.issuedAt},
          ${input.expiresAt}
        )
        RETURNING *
      `

      if (!rows[0]) {
        throw new PublicationApiError(500, 'token_inventory_create_failed', 'Neon did not return the created token.')
      }

      return normalizeTokenRow(rows[0])
    },

    async listTokenRecords(limit = 50) {
      const rows = await sql`
        SELECT *
        FROM publication_api_tokens
        ORDER BY created_at DESC
        LIMIT ${clampLimit(limit, 50, 100)}
      `

      return rows.map(normalizeTokenRow)
    },

    async getTokenRecord(tokenId: string) {
      const rows = await sql`
        SELECT *
        FROM publication_api_tokens
        WHERE id = ${tokenId}
        LIMIT 1
      `

      return rows[0] ? normalizeTokenRow(rows[0]) : null
    },

    async revokeTokenRecord(tokenId: string) {
      const rows = await sql`
        UPDATE publication_api_tokens
        SET
          revoked_at = NOW(),
          updated_at = NOW()
        WHERE id = ${tokenId}
        RETURNING *
      `

      if (!rows[0]) {
        throw new PublicationApiError(404, 'token_not_found', `Token ${tokenId} was not found.`)
      }

      return normalizeTokenRow(rows[0])
    },

    async touchTokenRecord(tokenId: string, route: string, method: string) {
      try {
        await sql`
          UPDATE publication_api_tokens
          SET
            last_used_at = NOW(),
            last_used_route = ${route},
            last_used_method = ${method},
            updated_at = NOW()
          WHERE id = ${tokenId}
        `
      } catch (error) {
        console.error('Failed to update publication token last-used metadata:', error)
      }
    },
  }

  const auditStore: AuditStore = {
    async recordEvent(input) {
      const { scopesCsv, hasScopes } = buildScopeArrayExpression(input.scopes)
      const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null

      if (hasScopes) {
        await sql`
          INSERT INTO publication_api_audit_log (
            action,
            actor_label,
            actor_type,
            scopes,
            route,
            method,
            article_id,
            article_slug,
            status,
            metadata
          )
          VALUES (
            ${input.action},
            ${input.actor_label},
            ${input.actor_type},
            string_to_array(${scopesCsv}, ',')::text[],
            ${input.route},
            ${input.method},
            ${input.article_id},
            ${input.article_slug},
            ${input.status},
            ${metadataJson}::jsonb
          )
        `
        return
      }

      await sql`
        INSERT INTO publication_api_audit_log (
          action,
          actor_label,
          actor_type,
          scopes,
          route,
          method,
          article_id,
          article_slug,
          status,
          metadata
        )
        VALUES (
          ${input.action},
          ${input.actor_label},
          ${input.actor_type},
          ARRAY[]::text[],
          ${input.route},
          ${input.method},
          ${input.article_id},
          ${input.article_slug},
          ${input.status},
          ${metadataJson}::jsonb
        )
      `
    },

    async listEvents(limit = 30) {
      const rows = await sql`
        SELECT *
        FROM publication_api_audit_log
        ORDER BY created_at DESC
        LIMIT ${clampLimit(limit, 30, 100)}
      `

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

      const rows = await sql`
        INSERT INTO publication_media_assets (
          bucket,
          path,
          public_url,
          file_name,
          content_type,
          size_bytes,
          kind,
          article_slug,
          embed_markdown
        )
        VALUES (
          ${bucket},
          ${objectKey},
          ${publicUrl},
          ${fileName},
          ${input.contentType},
          ${sizeBytes},
          ${input.kind},
          ${input.articleSlug},
          ${input.embedMarkdown.replaceAll(`/${input.articleSlug}/${input.fileName}`, publicUrl)}
        )
        RETURNING *
      `

      if (!rows[0]) {
        throw new PublicationApiError(500, 'media_upload_failed', 'Neon did not return the uploaded media asset.')
      }

      return normalizeMediaRow(rows[0])
    },

    async listMedia(articleSlug: string, limit = 50) {
      const rows = await sql`
        SELECT *
        FROM publication_media_assets
        WHERE article_slug = ${articleSlug}
        ORDER BY updated_at DESC
        LIMIT ${clampLimit(limit, 50, 200)}
      `

      return rows.map(normalizeMediaRow)
    },

    async deleteMedia(pathToDelete: string) {
      const rows = await sql`
        DELETE FROM publication_media_assets
        WHERE path = ${pathToDelete}
        RETURNING *
      `

      const asset = rows[0] ? normalizeMediaRow(rows[0]) : null
      if (!asset) {
        return
      }

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
    publicationStore,
    versionStore,
    tokenStore,
    auditStore,
    mediaStore,
    adminAuthStore: localSupportPlatform.adminAuthStore,
  }
}
