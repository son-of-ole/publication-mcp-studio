export type PublicationClientOptions = {
  baseUrl: string
  token?: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

export type PublicationListArticlesOptions = {
  status?: 'draft' | 'published' | 'all'
  search?: string
  limit?: number
  includeContent?: boolean
  signal?: AbortSignal
}

export type PublicationArticleStatus = 'draft' | 'published'

export type PublicationArticleResponse = {
  id: string
  title: string
  slug: string
  status: PublicationArticleStatus
  createdAt: string
  updatedAt: string
  metadata: Record<string, unknown>
  contentMarkdown?: string
  document?: unknown
  presentation?: unknown
}

export type PublicationArticleMutationInput = {
  title?: string
  slug?: string
  status?: PublicationArticleStatus
  contentMarkdown?: string
  body?: string
  metadata?: Record<string, unknown>
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

export type PublicationTokenRecord = {
  id: string
  label: string
  scopes: PublicationTokenScope[]
  revoked_at: string | null
  expires_at: string
  created_at: string
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

export type PublicationClient = ReturnType<typeof createPublicationClient>

export function createPublicationClient(options: PublicationClientOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch

  if (!fetchImpl) {
    throw new Error('A fetch implementation is required to use @publication-mcp-studio/client.')
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl)

  async function request<T>(
    pathname: string,
    init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {}
  ) {
    const url = buildRequestUrl(baseUrl, pathname)

    if (init.query) {
      const query = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '')
      for (const [key, value] of Object.entries(init.query)) {
        if (value === undefined || value === null || value === '') {
          continue
        }
        query.set(key, String(value))
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
    baseUrl,

    health(init: { signal?: AbortSignal } = {}) {
      return request<{ ok: boolean; protocolVersion?: string; server?: string; tools?: number; toolNames?: string[] }>(
        '/api/publications/mcp/health',
        { signal: init.signal }
      )
    },

    getAccessInfo(init: { signal?: AbortSignal } = {}) {
      return request<{
        mcpEndpoint: string
        restBaseUrl: string
        availableScopes: PublicationTokenScope[]
        tokens: PublicationTokenRecord[]
      }>('/api/publications/tokens', { signal: init.signal })
    },

    adminLogin(input: { email: string; password: string; signal?: AbortSignal }) {
      return request<{ token: { token: string; tokenId: string; expiresAt: string }; tokenRecord?: PublicationTokenRecord }>(
        '/api/publications/admin/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: input.email, password: input.password }),
          signal: input.signal,
        }
      )
    },

    listTokens(init: { signal?: AbortSignal } = {}) {
      return this.getAccessInfo(init)
    },

    revokeToken(tokenId: string, init: { signal?: AbortSignal } = {}) {
      return request<{ token: PublicationTokenRecord }>(
        `/api/publications/tokens/${encodeURIComponent(tokenId)}/revoke`,
        { method: 'POST', signal: init.signal }
      )
    },

    listArticles(options: PublicationListArticlesOptions = {}) {
      const { signal, ...query } = options
      return request<{ articles: PublicationArticleResponse[]; count: number }>('/api/publications/articles', {
        method: 'GET',
        query,
        signal,
      })
    },

    getArticle(identifier: string, includeContent = true, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse }>(
        `/api/publications/articles/${encodeURIComponent(identifier)}`,
        {
          method: 'GET',
          query: { includeContent },
          signal: init.signal,
        }
      )
    },

    createArticle(input: PublicationArticleMutationInput, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse }>('/api/publications/articles', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: init.signal,
      })
    },

    updateArticle(identifier: string, input: PublicationArticleMutationInput, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse }>(
        `/api/publications/articles/${encodeURIComponent(identifier)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
          signal: init.signal,
        }
      )
    },

    publishArticle(identifier: string, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse }>(
        `/api/publications/articles/${encodeURIComponent(identifier)}/publish`,
        {
          method: 'POST',
          signal: init.signal,
        }
      )
    },

    unpublishArticle(identifier: string, init: { signal?: AbortSignal } = {}) {
      return request<{ article: PublicationArticleResponse }>(
        `/api/publications/articles/${encodeURIComponent(identifier)}/unpublish`,
        {
          method: 'POST',
          signal: init.signal,
        }
      )
    },

    deleteArticle(identifier: string, init: { signal?: AbortSignal } = {}) {
      return request<{ deleted: true; article: PublicationArticleResponse }>(
        `/api/publications/articles/${encodeURIComponent(identifier)}`,
        {
          method: 'DELETE',
          signal: init.signal,
        }
      )
    },

    verifyDocument(input: PublicationVerifyInput, init: { signal?: AbortSignal } = {}) {
      return request<{ result: unknown; ir?: unknown }>('/api/publications/verify', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: init.signal,
      })
    },

    mcpRequest<T = unknown>(input: PublicationMcpRequest, init: { signal?: AbortSignal } = {}) {
      return request<T>('/api/publications/mcp', {
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

function normalizeBaseUrl(baseUrl: string) {
  if (!baseUrl.trim()) {
    throw new Error('Publication client requires a non-empty baseUrl.')
  }

  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function buildRequestUrl(baseUrl: string, pathname: string) {
  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL(pathname, baseUrl).toString()
  }

  const base = baseUrl.replace(/\/+$/g, '')
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${base}${path}`
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
