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
}

export type PublicationArticleMutationInput = {
  title?: string
  slug?: string
  status?: 'draft' | 'published'
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
    const url = new URL(pathname, baseUrl)

    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value === undefined || value === null || value === '') {
          continue
        }

        url.searchParams.set(key, String(value))
      }
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

    const response = await fetchImpl(url.toString(), {
      ...init,
      headers,
    })
    const data = await parseJsonSafely(response)

    if (!response.ok) {
      throw new Error(
        typeof data?.error === 'string'
          ? data.error
          : `Publication request failed with status ${response.status}.`
      )
    }

    return data as T
  }

  return {
    baseUrl,

    health() {
      return request('/api/publications/mcp/health')
    },

    getAccessInfo() {
      return request('/api/publications/tokens')
    },

    listArticles(options: PublicationListArticlesOptions = {}) {
      return request('/api/publications/articles', {
        method: 'GET',
        query: options,
      })
    },

    getArticle(identifier: string, includeContent = true) {
      return request(`/api/publications/articles/${encodeURIComponent(identifier)}`, {
        method: 'GET',
        query: { includeContent },
      })
    },

    createArticle(input: PublicationArticleMutationInput) {
      return request('/api/publications/articles', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    updateArticle(identifier: string, input: PublicationArticleMutationInput) {
      return request(`/api/publications/articles/${encodeURIComponent(identifier)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
    },

    publishArticle(identifier: string) {
      return request(`/api/publications/articles/${encodeURIComponent(identifier)}/publish`, {
        method: 'POST',
      })
    },

    deleteArticle(identifier: string) {
      return request(`/api/publications/articles/${encodeURIComponent(identifier)}`, {
        method: 'DELETE',
      })
    },

    verifyDocument(input: PublicationVerifyInput) {
      return request('/api/publications/verify', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    mcpRequest(input: PublicationMcpRequest) {
      return request('/api/publications/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: input.id ?? 'publication-client',
          method: input.method,
          params: input.params,
        }),
      })
    },

    listSkills() {
      return request('/api/publications/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-skills',
          method: 'tools/call',
          params: {
            name: 'list_skills',
            arguments: {},
          },
        }),
      })
    },

    runSkillWorkflow(workflowId: string, input: Omit<PublicationVerifyInput, 'verifierId' | 'presetId'> = {}) {
      return request('/api/publications/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'run-skill-workflow',
          method: 'tools/call',
          params: {
            name: 'run_skill_workflow',
            arguments: {
              workflowId,
              ...input,
            },
          },
        }),
      })
    },
  }
}

function normalizeBaseUrl(baseUrl: string) {
  if (!baseUrl.trim()) {
    throw new Error('Publication client requires a non-empty baseUrl.')
  }

  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

async function parseJsonSafely(response: Response) {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { error: text }
  }
}
