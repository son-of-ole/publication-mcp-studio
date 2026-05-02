export type PublicationClientOptions = {
  /**
   * Backward-compatible request base. May be either an origin
   * (`https://example.com`) or a full publication API base path
   * (`https://example.com/api/publications`).
   */
  baseUrl?: string
  /**
   * Preferred v0.3 name for same-origin style integrations. When set, the
   * client appends `pathPrefix`.
   */
  origin?: string
  pathPrefix?: string
  token?: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

export type PublicationListArticlesOptions = {
  status?: 'draft' | 'published' | 'all'
  search?: string
  category?: string
  tag?: string
  tags?: string[]
  limit?: number
  offset?: number
  cursor?: string
  includeContent?: boolean
  signal?: AbortSignal
}

export type PublicationArticleStatus = 'draft' | 'published'

export type PublicationDefaultArticleMetadata = {
  category?: string
  excerpt?: string
  imageUrl?: string
  date?: string
  tags?: string[]
  [key: string]: unknown
}

export type PublicationArticleResponse<TMetadata extends Record<string, unknown> = PublicationDefaultArticleMetadata> = {
  id: string
  title: string
  slug: string
  status: PublicationArticleStatus
  createdAt: string
  updatedAt: string
  category: string | null
  tags: string[]
  metadata: TMetadata
  contentMarkdown?: string
  document?: unknown
  presentation?: unknown
}

export type PublicationArticleMutationInput<TMetadata extends Record<string, unknown> = PublicationDefaultArticleMetadata> = {
  title?: string
  slug?: string
  status?: PublicationArticleStatus
  contentMarkdown?: string
  body?: string
  category?: string | null
  tags?: string[]
  metadata?: Partial<TMetadata>
  customFrontmatter?: Record<string, unknown>
}

export type PublicationVerifyInput = {
  identifier?: string
  markdown?: string
  verifierId?: string
  presetId?: string
  fallbackTitle?: string
}

export type PublicationMcpRequest = {
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type PublicationTokenScope =
  | 'mcp:connect'
  | 'articles:read'
  | 'articles:write'
  | 'articles:publish'
  | 'articles:delete'
  | 'agent:generate'
  | 'audit:read'
  | 'tokens:read'
  | 'tokens:write'

export const PUBLICATION_SCOPES = [
  'mcp:connect',
  'articles:read',
  'articles:write',
  'articles:publish',
  'articles:delete',
  'agent:generate',
  'audit:read',
  'tokens:read',
  'tokens:write',
] as const

export type PublicationTokenRecord = {
  id: string
  label: string
  scopes: PublicationTokenScope[]
  revokedAt: string | null
  expiresAt: string
  issuedAt?: string
  createdAt: string
  lastUsedAt?: string | null
  raw?: unknown
}

export class PublicationClientError extends Error {
  status: number
  code?: string
  details?: unknown

  constructor(input: { status: number; message: string; code?: string; details?: unknown }) {
    super(input.message)
    this.name = 'PublicationClientError'
    this.status = input.status
    this.code = input.code
    this.details = input.details
  }
}

export function defineArticleMetadataSchema<TSchema>(schema: TSchema) {
  return schema
}

export type PublicationClient<TMetadata extends Record<string, unknown> = PublicationDefaultArticleMetadata> = ReturnType<typeof createPublicationClient<TMetadata>>

export function createPublicationClient<TMetadata extends Record<string, unknown> = PublicationDefaultArticleMetadata>(
  options: PublicationClientOptions
) {
  const fetchImpl = options.fetch ?? globalThis.fetch

  if (!fetchImpl) {
    throw new Error('A fetch implementation is required to use @publication-mcp-studio/client.')
  }

  const endpoint = resolveEndpoint(options)

  async function request<T>(
    pathname: string,
    init: RequestInit & { query?: Record<string, string | number | boolean | string[] | undefined> } = {}
  ) {
    const url = buildRequestUrl(endpoint, pathname)

    if (init.query) {
      const query = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '')
      for (const [key, value] of Object.entries(init.query)) {
        if (value === undefined || value === null || value === '') {
          continue
        }
        if (Array.isArray(value)) {
          for (const entry of value) {
            query.append(key, entry)
          }
        } else {
          query.set(key, String(value))
        }
      }
      const [pathOnly] = url.split('?')
      const serialized = query.toString()
      return request<T>(serialized ? `${pathOnly}?${serialized}` : pathOnly, {
        ...init,
        query: undefined,
      })
    }

    const headers = new Headers(options.headers)
    if (options.token) {
      headers.set('Authorization', `Bearer ${options.token}`)
    }

    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    if (init.headers) {
      const incoming = new Headers(init.headers)
      incoming.forEach((value, key) => headers.set(key, value))
    }

    const response = await fetchImpl(url, {
      ...init,
      headers,
    })
    const data = await parseJsonSafely(response)

    if (!response.ok) {
      const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      throw new PublicationClientError({
        status: response.status,
        message: typeof record.error === 'string'
          ? record.error
          : `Publication request failed with status ${response.status}.`,
        code: typeof record.code === 'string' ? record.code : undefined,
        details: record.details,
      })
    }

    return data as T
  }

  return {
    baseUrl: endpoint.baseUrl,
    origin: endpoint.origin,
    pathPrefix: endpoint.pathPrefix,

    health(init: { signal?: AbortSignal } = {}) {
      return request<{ ok: boolean; protocolVersion?: string; server?: string; tools?: number; toolNames?: string[] }>(
        '/mcp/health',
        { signal: init.signal }
      )
    },

    getAccessInfo(init: { signal?: AbortSignal } = {}) {
      return request<{
        mcpEndpoint: string
        restBaseUrl: string
        availableScopes: PublicationTokenScope[]
        tokens: PublicationTokenRecord[]
      }>('/tokens', { signal: init.signal }).then(normalizeTokenListResponse)
    },

    adminLogin(input: { email: string; password: string; signal?: AbortSignal }) {
      return request<{ token: { token: string; tokenId: string; expiresAt: string }; tokenRecord?: PublicationTokenRecord }>(
        '/admin/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: input.email, password: input.password }),
          signal: input.signal,
        }
      ).then((response) => ({
        ...response,
        tokenRecord: response.tokenRecord ? normalizeTokenRecord(response.tokenRecord) : undefined,
      }))
    },

    listTokens(init: { signal?: AbortSignal } = {}) {
      return this.getAccessInfo(init)
    },

    revokeToken(tokenId: string, init: { signal?: AbortSignal } = {}) {
      return request<{ token: PublicationTokenRecord }>(
        `/tokens/${encodeURIComponent(tokenId)}/revoke`,
        { method: 'POST', signal: init.signal }
      ).then((response) => ({ token: normalizeTokenRecord(response.token) }))
    },

    listArticles(options: PublicationListArticlesOptions = {}) {
      const { signal, ...query } = options
      return request<{
        articles: PublicationArticleResponse<TMetadata>[]
        count: number
        total?: number
        pageSize?: number
        nextCursor?: string
      }>('/articles', {
        method: 'GET',
        query,
        signal,
      })
    },

    getArticle(identifier: string, includeContent = true, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse<TMetadata> }>(
        `/articles/${encodeURIComponent(identifier)}`,
        {
          method: 'GET',
          query: { includeContent },
          signal: init.signal,
        }
      )
    },

    createArticle(input: PublicationArticleMutationInput<TMetadata>, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse<TMetadata> }>('/articles', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: init.signal,
      })
    },

    updateArticle(identifier: string, input: PublicationArticleMutationInput<TMetadata>, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse<TMetadata> }>(
        `/articles/${encodeURIComponent(identifier)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
          signal: init.signal,
        }
      )
    },

    publishArticle(identifier: string, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse<TMetadata> }>(
        `/articles/${encodeURIComponent(identifier)}/publish`,
        {
          method: 'POST',
          signal: init.signal,
        }
      )
    },

    unpublishArticle(identifier: string, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse<TMetadata> }>(
        `/articles/${encodeURIComponent(identifier)}/unpublish`,
        {
          method: 'POST',
          signal: init.signal,
        }
      )
    },

    deleteArticle(identifier: string, init: { signal?: AbortSignal } = {}) {
      return request<{ deleted: true; article: PublicationArticleResponse<TMetadata> }>(
        `/articles/${encodeURIComponent(identifier)}`,
        {
          method: 'DELETE',
          signal: init.signal,
        }
      )
    },

    verifyDocument(input: PublicationVerifyInput, init: { signal?: AbortSignal } = {}) {
      return request<{ result: unknown; ir?: unknown }>('/verify', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: init.signal,
      })
    },

    mcpRequest<T = unknown>(input: PublicationMcpRequest, init: { signal?: AbortSignal } = {}) {
      return request<T>('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: input.id ?? 'publication-client',
          method: input.method,
          params: input.params,
        }),
        signal: init.signal,
      })
    },

    listTools(init: { signal?: AbortSignal } = {}) {
      return this.mcpRequest<{ result: { tools: Array<{ name: string; inputSchema?: unknown }> } }>({
        id: 'tools-list',
        method: 'tools/list',
      }, init)
    },

    callTool<T = unknown>(name: string, args: Record<string, unknown> = {}, init: { signal?: AbortSignal } = {}) {
      return this.mcpRequest<T>({
        id: `call-${name}`,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      }, init)
    },

    listSkills(init: { signal?: AbortSignal } = {}) {
      return this.callTool('list_skills', {}, init)
    },

    runSkillWorkflow(workflowId: string, input: Omit<PublicationVerifyInput, 'verifierId' | 'presetId'> = {}, init: { signal?: AbortSignal } = {}) {
      return this.callTool('run_skill_workflow', { workflowId, ...input }, init)
    },
  }
}

type PublicationResolvedEndpoint = {
  baseUrl: string
  origin: string
  pathPrefix: string
}

function resolveEndpoint(options: PublicationClientOptions): PublicationResolvedEndpoint {
  const rawBase = options.baseUrl?.trim()
  const rawOrigin = options.origin?.trim()
  const pathPrefix = normalizePathPrefix(options.pathPrefix ?? '/api/publications')
  const base = rawBase || rawOrigin

  if (!base) {
    throw new Error('Publication client requires a non-empty baseUrl or origin.')
  }

  const trimmed = base.replace(/\/+$/g, '')
  const baseIncludesPrefix = trimmed.endsWith(pathPrefix)
  const origin = baseIncludesPrefix ? trimmed.slice(0, -pathPrefix.length) || '/' : trimmed
  return {
    baseUrl: baseIncludesPrefix ? trimmed : `${trimmed}${pathPrefix}`,
    origin,
    pathPrefix,
  }
}

function normalizePathPrefix(pathPrefix: string) {
  const normalized = `/${pathPrefix.replace(/^\/+|\/+$/g, '')}`
  return normalized === '/' ? '' : normalized
}

function buildRequestUrl(endpoint: PublicationResolvedEndpoint, pathname: string) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  const base = endpoint.baseUrl.replace(/\/+$/g, '')
  if (/^https?:\/\//i.test(base)) {
    return `${base}${path}`
  }

  return `${base}${path}`
}

function normalizeTokenListResponse<T extends { tokens: PublicationTokenRecord[] }>(response: T) {
  return {
    ...response,
    tokens: response.tokens.map(normalizeTokenRecord),
  }
}

function normalizeTokenRecord(record: PublicationTokenRecord | Record<string, unknown>): PublicationTokenRecord {
  const raw = record as Record<string, unknown>
  return {
    id: String(raw.id),
    label: String(raw.label),
    scopes: Array.isArray(raw.scopes)
      ? raw.scopes.filter((scope): scope is PublicationTokenScope => (PUBLICATION_SCOPES as readonly string[]).includes(String(scope)))
      : [],
    revokedAt: readStringOrNull(raw.revokedAt ?? raw.revoked_at),
    expiresAt: readString(raw.expiresAt ?? raw.expires_at),
    issuedAt: readOptionalString(raw.issuedAt ?? raw.issued_at),
    createdAt: readString(raw.createdAt ?? raw.created_at),
    lastUsedAt: readStringOrNull(raw.lastUsedAt ?? raw.last_used_at),
    raw: record,
  }
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readStringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null
}

async function parseJsonSafely(response: Response) {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: text }
  }
}
