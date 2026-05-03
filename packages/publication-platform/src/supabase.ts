import { createClient } from '@supabase/supabase-js'
import type {
  AdminAuthStore,
  AuditStore,
  MediaStore,
  PublicationArticleListOptions,
  PublicationArticleRecord,
  PublicationArticleVersionRecord,
  PublicationAuditEntry,
  PublicationMediaAsset,
  PublicationMediaUploadPayload,
  PublicationPlatform,
  PublicationStore,
  SupabasePublicationPlatformOptions,
  PublicationTokenInventoryRecord,
  PublicationVersionStore,
  TokenStore,
} from './types'
import { PublicationApiError } from './errors'

const SUPABASE_MEDIA_BUCKET = 'article-assets'

function asString(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function asStringOrNull(value: unknown) {
  return value === null || value === undefined ? null : String(value)
}

function asTimestamp(value: unknown) {
  return value ? new Date(String(value)).toISOString() : new Date(0).toISOString()
}

function asNullableTimestamp(value: unknown) {
  return value ? new Date(String(value)).toISOString() : null
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function normalizeArticleRow(row: Record<string, unknown>): PublicationArticleRecord {
  return {
    id: asString(row.id),
    title: asString(row.title),
    slug: asString(row.slug),
    contentMarkdown: asString(row.content_markdown),
    metadata: asObject(row.metadata),
    category: row.category ? asString(row.category) : null,
    tags: asArray<string>(row.tags).filter((tag): tag is string => typeof tag === 'string'),
    status: row.status === 'published' ? 'published' : 'draft',
    createdAt: asTimestamp(row.created_at),
    updatedAt: asTimestamp(row.updated_at),
  }
}

function normalizeVersionRow(row: Record<string, unknown>): PublicationArticleVersionRecord {
  return {
    id: asString(row.id),
    articleId: asString(row.article_id),
    versionNumber: Number(row.version_number),
    sourceAction: asString(row.source_action),
    title: asString(row.title),
    slug: asString(row.slug),
    contentMarkdown: asString(row.content_markdown),
    status: row.status === 'published' ? 'published' : 'draft',
    actorLabel: asStringOrNull(row.actor_label),
    actorType: asStringOrNull(row.actor_type),
    metadata: row.metadata ? asObject(row.metadata) : null,
    createdAt: asTimestamp(row.created_at),
  }
}

function normalizeTokenRow(row: Record<string, unknown>): PublicationTokenInventoryRecord {
  return {
    id: asString(row.id),
    label: asString(row.label),
    tokenType: 'signed',
    scopes: asArray<PublicationTokenInventoryRecord['scopes'][number]>(row.scopes),
    profileId: asStringOrNull(row.profile_id),
    profileLabel: asStringOrNull(row.profile_label),
    profileEnabledSkillIds: asArray<string>(row.profile_enabled_skill_ids),
    tokenEnabledSkillIds: row.token_enabled_skill_ids ? asArray<string>(row.token_enabled_skill_ids) : null,
    allowProfileSkillOverrides: row.allow_profile_skill_overrides === true,
    issuedAt: asTimestamp(row.issued_at),
    expiresAt: asTimestamp(row.expires_at),
    revokedAt: asNullableTimestamp(row.revoked_at),
    lastUsedAt: asNullableTimestamp(row.last_used_at),
    lastUsedRoute: asStringOrNull(row.last_used_route),
    lastUsedMethod: asStringOrNull(row.last_used_method),
    createdAt: asTimestamp(row.created_at),
    updatedAt: asTimestamp(row.updated_at),
  }
}

function normalizeAuditRow(row: Record<string, unknown>): PublicationAuditEntry {
  return {
    id: asString(row.id),
    action: row.action as PublicationAuditEntry['action'],
    actorLabel: asString(row.actor_label),
    actorType: asString(row.actor_type),
    scopes: asArray<string>(row.scopes),
    route: asString(row.route),
    method: asString(row.method),
    articleId: asStringOrNull(row.article_id),
    articleSlug: asStringOrNull(row.article_slug),
    status: asString(row.status),
    metadata: row.metadata ? asObject(row.metadata) : null,
    createdAt: asTimestamp(row.created_at),
  }
}

function articleRecordToColumns(input: PublicationArticleRecord) {
  return {
    id: input.id,
    title: input.title,
    slug: input.slug,
    content_markdown: input.contentMarkdown,
    metadata: input.metadata ?? {},
    category: input.category ?? null,
    tags: input.tags ?? [],
    status: input.status,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  }
}

function articleUpdatesToColumns(updates: Partial<PublicationArticleRecord>) {
  const out: Record<string, unknown> = {}
  if (updates.title !== undefined) out.title = updates.title
  if (updates.slug !== undefined) out.slug = updates.slug
  if (updates.contentMarkdown !== undefined) out.content_markdown = updates.contentMarkdown
  if (updates.metadata !== undefined) out.metadata = updates.metadata
  if (updates.category !== undefined) out.category = updates.category
  if (updates.tags !== undefined) out.tags = updates.tags
  if (updates.status !== undefined) out.status = updates.status
  if (updates.createdAt !== undefined) out.created_at = updates.createdAt
  if (updates.updatedAt !== undefined) out.updated_at = updates.updatedAt
  return out
}

type SupabaseArticleQuery = {
  eq(column: string, value: string): SupabaseArticleQuery
  or(filters: string): SupabaseArticleQuery
  contains(column: string, value: string[]): SupabaseArticleQuery
  range(from: number, to: number): SupabaseArticleQuery
  lt(column: string, value: string): SupabaseArticleQuery
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data?: unknown[] | null; count?: number | null; error?: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>
}

function escapeSupabaseOrValue(value: string) {
  return value.replace(/[%(),]/g, (match) => `\\${match}`)
}

function applyArticleFilters<TQuery extends SupabaseArticleQuery>(
  query: TQuery,
  options: PublicationArticleListOptions | Omit<PublicationArticleListOptions, 'limit' | 'offset' | 'cursor'>
) {
  let nextQuery = query

  if (options.status && options.status !== 'all') {
    nextQuery = nextQuery.eq('status', options.status) as TQuery
  }

  if (options.category?.trim()) {
    nextQuery = nextQuery.eq('category', options.category.trim()) as TQuery
  }

  const requestedTags = [
    ...(options.tag?.trim() ? [options.tag.trim()] : []),
    ...(Array.isArray(options.tags) ? options.tags.map((tag) => tag.trim()).filter(Boolean) : []),
  ]
  if (requestedTags.length > 0) {
    nextQuery = nextQuery.contains('tags', [...new Set(requestedTags)]) as TQuery
  }

  if (options.search?.trim()) {
    const search = escapeSupabaseOrValue(options.search.trim())
    nextQuery = nextQuery.or(`title.ilike.%${search}%,slug.ilike.%${search}%,category.ilike.%${search}%`) as TQuery
  }

  return nextQuery
}

function getRequiredSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    throw new PublicationApiError(
      500,
      'supabase_service_role_missing',
      'NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must be configured.'
    )
  }

  return { supabaseUrl, supabaseAnonKey, serviceRoleKey }
}

function createSupabaseServiceClient() {
  const { supabaseUrl, serviceRoleKey } = getRequiredSupabaseConfig()

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

const publicationStore: PublicationStore = {
  async listArticles(options: PublicationArticleListOptions = {}) {
    const supabase = createSupabaseServiceClient()
    const limit = options.limit && !Number.isNaN(options.limit) ? Math.min(100, Math.max(1, Math.floor(options.limit))) : 50
    const offset = options.offset && !Number.isNaN(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0

    let query = applyArticleFilters(
      supabase.from('articles').select('*').order('created_at', { ascending: false }) as unknown as SupabaseArticleQuery,
      options
    ).range(offset, offset + limit - 1)

    if (options.cursor?.trim()) {
      query = query.lt('created_at', options.cursor.trim())
    }

    const { data, error } = await query
    if (error) {
      throw new PublicationApiError(500, 'articles_list_failed', error.message, error)
    }

    return ((data ?? []) as Record<string, unknown>[]).map(normalizeArticleRow)
  },

  async countArticles(options: Omit<PublicationArticleListOptions, 'limit' | 'offset' | 'cursor'> = {}) {
    const supabase = createSupabaseServiceClient()
    const { count, error } = await applyArticleFilters(
      supabase.from('articles').select('id', { count: 'exact', head: true }) as unknown as SupabaseArticleQuery,
      options
    )

    if (error) {
      throw new PublicationApiError(500, 'articles_count_failed', error.message, error)
    }

    return count ?? 0
  },

  async getArticleByIdentifier(identifier: string) {
    const supabase = createSupabaseServiceClient()
    const cleanIdentifier = identifier.trim()
    if (!cleanIdentifier) {
      return null
    }

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanIdentifier)) {
      const { data, error } = await supabase.from('articles').select('*').eq('id', cleanIdentifier).maybeSingle()
      if (error) {
        throw new PublicationApiError(500, 'article_lookup_failed', error.message, error)
      }
      if (data) {
        return normalizeArticleRow(data as Record<string, unknown>)
      }
    }

    const { data, error } = await supabase.from('articles').select('*').eq('slug', cleanIdentifier).maybeSingle()
    if (error) {
      throw new PublicationApiError(500, 'article_lookup_failed', error.message, error)
    }

    return data ? normalizeArticleRow(data as Record<string, unknown>) : null
  },

  async createArticle(input: PublicationArticleRecord) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.from('articles').insert(articleRecordToColumns(input)).select('*').single()
    if (error) {
      throw new PublicationApiError(500, 'article_create_failed', error.message, error)
    }
    return normalizeArticleRow(data as Record<string, unknown>)
  },

  async updateArticle(id: string, updates: Partial<PublicationArticleRecord>) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('articles')
      .update(articleUpdatesToColumns(updates))
      .eq('id', id)
      .select('*')
      .single()
    if (error) {
      throw new PublicationApiError(500, 'article_update_failed', error.message, error)
    }
    return normalizeArticleRow(data as Record<string, unknown>)
  },

  async deleteArticle(id: string) {
    const supabase = createSupabaseServiceClient()
    const { error } = await supabase.from('articles').delete().eq('id', id)
    if (error) {
      throw new PublicationApiError(500, 'article_delete_failed', error.message, error)
    }
  },
}

const versionStore: PublicationVersionStore = {
  async createVersion(input) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('publication_article_versions')
      .insert({
        article_id: input.articleId,
        version_number: input.versionNumber,
        source_action: input.sourceAction,
        title: input.title,
        slug: input.slug,
        content_markdown: input.contentMarkdown,
        status: input.status,
        actor_label: input.actorLabel,
        actor_type: input.actorType,
        metadata: input.metadata ?? null,
      })
      .select('*')
      .single()
    if (error) {
      throw new PublicationApiError(500, 'article_version_create_failed', error.message, error)
    }
    return normalizeVersionRow(data as Record<string, unknown>)
  },

  async listVersions(articleId: string) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('publication_article_versions')
      .select('*')
      .eq('article_id', articleId)
      .order('version_number', { ascending: false })

    if (error) {
      throw new PublicationApiError(500, 'article_versions_list_failed', error.message, error)
    }

    return ((data ?? []) as Record<string, unknown>[]).map(normalizeVersionRow)
  },

  async getVersion(articleId: string, versionId: string) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('publication_article_versions')
      .select('*')
      .eq('id', versionId)
      .eq('article_id', articleId)
      .maybeSingle()

    if (error) {
      throw new PublicationApiError(500, 'article_version_restore_lookup_failed', error.message, error)
    }

    return data ? normalizeVersionRow(data as Record<string, unknown>) : null
  },
}

const tokenStore: TokenStore = {
  async createTokenRecord(input) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('publication_api_tokens')
      .insert({
        label: input.label,
        token_type: 'signed',
        scopes: input.scopes,
        profile_id: input.profileId ?? null,
        profile_label: input.profileLabel ?? null,
        profile_enabled_skill_ids: input.profileEnabledSkillIds ?? [],
        ...(input.tokenEnabledSkillIds ? { token_enabled_skill_ids: input.tokenEnabledSkillIds } : {}),
        allow_profile_skill_overrides: input.allowProfileSkillOverrides ?? false,
        issued_at: input.issuedAt,
        expires_at: input.expiresAt,
      })
      .select('*')
      .single()

    if (error) {
      throw new PublicationApiError(500, 'token_inventory_create_failed', error.message, error)
    }

    return normalizeTokenRow(data as Record<string, unknown>)
  },

  async listTokenRecords(limit = 50) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('publication_api_tokens')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(100, Math.max(1, Math.floor(limit))))

    if (error) {
      throw new PublicationApiError(500, 'token_inventory_list_failed', error.message, error)
    }

    return ((data ?? []) as Record<string, unknown>[]).map(normalizeTokenRow)
  },

  async getTokenRecord(tokenId: string) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('publication_api_tokens')
      .select('*')
      .eq('id', tokenId)
      .maybeSingle()

    if (error) {
      throw new PublicationApiError(500, 'token_inventory_lookup_failed', error.message, error)
    }

    return data ? normalizeTokenRow(data as Record<string, unknown>) : null
  },

  async revokeTokenRecord(tokenId: string) {
    const supabase = createSupabaseServiceClient()
    const revokedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('publication_api_tokens')
      .update({
        revoked_at: revokedAt,
        updated_at: revokedAt,
      })
      .eq('id', tokenId)
      .select('*')
      .single()

    if (error) {
      throw new PublicationApiError(500, 'token_inventory_revoke_failed', error.message, error)
    }

    return normalizeTokenRow(data as Record<string, unknown>)
  },

  async touchTokenRecord(tokenId: string, route: string, method: string) {
    const supabase = createSupabaseServiceClient()
    const touchedAt = new Date().toISOString()
    const { error } = await supabase
      .from('publication_api_tokens')
      .update({
        last_used_at: touchedAt,
        last_used_route: route,
        last_used_method: method,
        updated_at: touchedAt,
      })
      .eq('id', tokenId)

    if (error) {
      console.error('Failed to update publication token last-used metadata:', error)
    }
  },
}

const auditStore: AuditStore = {
  async recordEvent(input) {
    const supabase = createSupabaseServiceClient()
    const { error } = await supabase.from('publication_api_audit_log').insert({
      action: input.action,
      actor_label: input.actorLabel,
      actor_type: input.actorType,
      scopes: input.scopes,
      route: input.route,
      method: input.method,
      article_id: input.articleId,
      article_slug: input.articleSlug,
      status: input.status,
      metadata: input.metadata ?? null,
    })

    if (error) {
      if (error.message.toLowerCase().includes('publication_api_audit_log')) {
        return
      }
      console.error('Publication audit logging failed:', error)
    }
  },

  async listEvents(limit = 30) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase
      .from('publication_api_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(100, Math.max(1, Math.floor(limit))))

    if (error) {
      if (error.message.toLowerCase().includes('publication_api_audit_log')) {
        return []
      }
      throw error
    }

    return ((data ?? []) as Record<string, unknown>[]).map(normalizeAuditRow)
  },
}

const mediaStore: MediaStore = {
  async uploadMedia(input: PublicationMediaUploadPayload) {
    const supabase = createSupabaseServiceClient()
    const storagePath = `publications/${input.articleSlug}/${Date.now()}-${input.fileName}`

    const { error } = await supabase.storage.from(SUPABASE_MEDIA_BUCKET).upload(storagePath, input.data, {
      cacheControl: '3600',
      contentType: input.contentType,
      upsert: false,
    })

    if (error) {
      throw new PublicationApiError(500, 'media_upload_failed', error.message, error)
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(SUPABASE_MEDIA_BUCKET).getPublicUrl(storagePath)

    return {
      bucket: SUPABASE_MEDIA_BUCKET,
      path: storagePath,
      publicUrl,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.data.byteLength,
      kind: input.kind,
      articleSlug: input.articleSlug,
      embedMarkdown: input.embedMarkdown,
    } satisfies PublicationMediaAsset
  },

  async listMedia(articleSlug: string, limit?: number) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.storage.from(SUPABASE_MEDIA_BUCKET).list(`publications/${articleSlug}`, {
      limit: limit && !Number.isNaN(limit) ? Math.min(200, Math.max(1, Math.floor(limit))) : 50,
      sortBy: { column: 'updated_at', order: 'desc' },
    })

    if (error) {
      throw new PublicationApiError(500, 'media_list_failed', error.message, error)
    }

    return (data ?? [])
      .filter((entry) => entry.name && entry.id)
      .map((entry) => {
        const assetPath = `publications/${articleSlug}/${entry.name}`
        const {
          data: { publicUrl },
        } = supabase.storage.from(SUPABASE_MEDIA_BUCKET).getPublicUrl(assetPath)

        return {
          bucket: SUPABASE_MEDIA_BUCKET,
          path: assetPath,
          publicUrl,
          fileName: entry.name,
          contentType: typeof entry.metadata?.mimetype === 'string' ? entry.metadata.mimetype : 'application/octet-stream',
          sizeBytes:
            typeof entry.metadata?.size === 'number'
              ? entry.metadata.size
              : typeof entry.metadata?.size === 'string'
                ? Number(entry.metadata.size)
                : null,
          kind: 'other',
          articleSlug,
          embedMarkdown: '',
          createdAt: entry.created_at ?? undefined,
          updatedAt: entry.updated_at ?? undefined,
        } satisfies PublicationMediaAsset
      })
  },

  async deleteMedia(pathToDelete: string) {
    const supabase = createSupabaseServiceClient()
    const { error } = await supabase.storage.from(SUPABASE_MEDIA_BUCKET).remove([pathToDelete])
    if (error) {
      throw new PublicationApiError(500, 'media_delete_failed', error.message, error)
    }
  },
}

export function createSupabasePublicationPlatform(
  options: SupabasePublicationPlatformOptions = {}
): PublicationPlatform {
  const adminAuthStore: AdminAuthStore = {
    ...(options.adminAuthStore ?? {}),
    kind: 'supabase',

    async getCurrentUser() {
      return options.adminAuthStore?.getCurrentUser?.() ?? null
    },

    async signOut() {
      await options.adminAuthStore?.signOut?.()
    },
  }

  return {
    kind: 'supabase',
    async ensureSchema() {},
    publicationStore,
    versionStore,
    tokenStore,
    auditStore,
    mediaStore,
    adminAuthStore,
  }
}
