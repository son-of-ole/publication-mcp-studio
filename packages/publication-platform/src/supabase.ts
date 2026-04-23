import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type {
  AdminAuthStore,
  AuditStore,
  MediaStore,
  PublicationAdminUser,
  PublicationArticleListOptions,
  PublicationArticleRecord,
  PublicationArticleVersionRecord,
  PublicationMediaAsset,
  PublicationMediaUploadPayload,
  PublicationPlatform,
  PublicationStore,
  PublicationTokenInventoryRecord,
  PublicationVersionStore,
  TokenStore,
} from '@publication-platform/types'
import { PublicationApiError } from '@publication-platform/errors'

const SUPABASE_MEDIA_BUCKET = 'article-assets'

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

async function createSupabaseServerClient() {
  const { supabaseUrl, supabaseAnonKey } = getRequiredSupabaseConfig()
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Ignore cookie mutation errors from read-only server contexts.
        }
      },
    },
  })
}

const publicationStore: PublicationStore = {
  async listArticles(options: PublicationArticleListOptions = {}) {
    const supabase = createSupabaseServiceClient()
    const limit = options.limit && !Number.isNaN(options.limit) ? Math.min(100, Math.max(1, Math.floor(options.limit))) : 50

    let query = supabase.from('articles').select('*').order('created_at', { ascending: false }).limit(limit)

    if (options.status && options.status !== 'all') {
      query = query.eq('status', options.status)
    }

    if (options.search?.trim()) {
      const search = options.search.trim()
      query = query.or(`title.ilike.%${search}%,slug.ilike.%${search}%`)
    }

    const { data, error } = await query
    if (error) {
      throw new PublicationApiError(500, 'articles_list_failed', error.message, error)
    }

    return (data ?? []) as PublicationArticleRecord[]
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
        return data as PublicationArticleRecord
      }
    }

    const { data, error } = await supabase.from('articles').select('*').eq('slug', cleanIdentifier).maybeSingle()
    if (error) {
      throw new PublicationApiError(500, 'article_lookup_failed', error.message, error)
    }

    return (data ?? null) as PublicationArticleRecord | null
  },

  async createArticle(input: PublicationArticleRecord) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.from('articles').insert(input).select('*').single()
    if (error) {
      throw new PublicationApiError(500, 'article_create_failed', error.message, error)
    }
    return data as PublicationArticleRecord
  },

  async updateArticle(id: string, updates: Partial<PublicationArticleRecord>) {
    const supabase = createSupabaseServiceClient()
    const { data, error } = await supabase.from('articles').update(updates).eq('id', id).select('*').single()
    if (error) {
      throw new PublicationApiError(500, 'article_update_failed', error.message, error)
    }
    return data as PublicationArticleRecord
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
    const { data, error } = await supabase.from('publication_article_versions').insert(input).select('*').single()
    if (error) {
      throw new PublicationApiError(500, 'article_version_create_failed', error.message, error)
    }
    return data as PublicationArticleVersionRecord
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

    return (data ?? []) as PublicationArticleVersionRecord[]
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

    return (data ?? null) as PublicationArticleVersionRecord | null
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
        token_enabled_skill_ids: input.tokenEnabledSkillIds ?? null,
        allow_profile_skill_overrides: input.allowProfileSkillOverrides ?? false,
        issued_at: input.issuedAt,
        expires_at: input.expiresAt,
      })
      .select('*')
      .single()

    if (error) {
      throw new PublicationApiError(500, 'token_inventory_create_failed', error.message, error)
    }

    return data as PublicationTokenInventoryRecord
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

    return (data ?? []) as PublicationTokenInventoryRecord[]
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

    return (data ?? null) as PublicationTokenInventoryRecord | null
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

    return data as PublicationTokenInventoryRecord
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
    const { error } = await supabase.from('publication_api_audit_log').insert(input)

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

    return (data ?? []) as typeof data
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

const adminAuthStore: AdminAuthStore = {
  kind: 'supabase',

  async getCurrentUser() {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return null
    }

    return {
      id: user.id,
      email: user.email ?? null,
      mode: 'supabase',
    } satisfies PublicationAdminUser
  },

  async signOut() {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  },
}

export function createSupabasePublicationPlatform(): PublicationPlatform {
  return {
    kind: 'supabase',
    publicationStore,
    versionStore,
    tokenStore,
    auditStore,
    mediaStore,
    adminAuthStore,
  }
}
