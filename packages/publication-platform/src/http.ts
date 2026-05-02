import { randomUUID } from 'node:crypto'
import { PublicationApiError } from './errors'
import {
  authenticatePublicationRequest,
  issuePublicationToken,
} from './auth'
import {
  PUBLICATION_MCP_TOOL_SCOPES,
  PUBLICATION_TOKEN_SCOPES,
  type PublicationTokenScope,
} from './token-scopes'
import type {
  PublicationArticleRecord,
  PublicationPlatform,
} from './types'

export type PublicationFetchHandlerOptions = {
  platform: PublicationPlatform
  basePath?: string
  tokenSecrets?: string[]
  staticTokens?: string[]
}

export function createPublicationFetchHandler(options: PublicationFetchHandlerOptions) {
  const basePath = normalizeBasePath(options.basePath ?? '/publications')

  return async function publicationFetchHandler(request: Request) {
    const url = new URL(request.url)
    const routePath = stripBasePath(url.pathname, basePath)

    try {
      if (request.method === 'OPTIONS') {
        return json({}, 200)
      }

      if (routePath === '/health' && request.method === 'GET') {
        return json({ ok: true, adapter: options.platform.kind })
      }

      if (routePath === '/admin' && request.method === 'GET') {
        return new Response(STATIC_ADMIN_HTML.replaceAll('__BASE_PATH__', basePath), {
          headers: { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() },
        })
      }

      if (routePath === '/admin/login' && request.method === 'POST') {
        const body = await readJson(request)
        const email = typeof body.email === 'string' ? body.email : ''
        const password = typeof body.password === 'string' ? body.password : ''

        if (!options.platform.adminAuthStore.signInWithPassword) {
          throw new PublicationApiError(501, 'password_auth_unavailable', 'This platform does not implement password admin auth.')
        }

        const user = await options.platform.adminAuthStore.signInWithPassword({ email, password })
        const tokenRecord = await options.platform.tokenStore.createTokenRecord({
          label: `Admin token for ${user.email ?? 'admin'}`,
          scopes: [...PUBLICATION_TOKEN_SCOPES],
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        const [secret] = options.tokenSecrets ?? []
        if (!secret) {
          throw new PublicationApiError(500, 'publication_api_secret_missing', 'A token secret is required to issue admin tokens.')
        }

        return json({
          user,
          token: issuePublicationToken({
            tokenId: tokenRecord.id,
            label: tokenRecord.label,
            scopes: tokenRecord.scopes,
            secret,
            issuedAt: tokenRecord.issued_at,
            expiresAt: tokenRecord.expires_at,
          }),
        }, 201)
      }

      if (routePath === '/tokens' && request.method === 'GET') {
        await authenticate(request, ['audit:read'])
        return json({ tokens: await options.platform.tokenStore.listTokenRecords() })
      }

      if (routePath === '/articles' && request.method === 'GET') {
        await authenticate(request, ['articles:read'])
        const articles = await options.platform.publicationStore.listArticles({
          status: parseStatus(url.searchParams.get('status')),
          search: url.searchParams.get('search') ?? undefined,
          limit: parseLimit(url.searchParams.get('limit')),
        })
        return json({ articles, count: articles.length })
      }

      if (routePath === '/articles' && request.method === 'POST') {
        await authenticate(request, ['articles:write'])
        const body = await readJson(request)
        const now = new Date().toISOString()
        const article: PublicationArticleRecord = {
          id: typeof body.id === 'string' ? body.id : randomUUID(),
          title: requireString(body.title, 'title'),
          slug: requireString(body.slug, 'slug'),
          content_markdown: typeof body.content_markdown === 'string'
            ? body.content_markdown
            : typeof body.contentMarkdown === 'string'
              ? body.contentMarkdown
              : '',
          metadata: isRecord(body.metadata) ? body.metadata : {},
          status: body.status === 'published' ? 'published' : 'draft',
          created_at: typeof body.created_at === 'string' ? body.created_at : now,
          updated_at: typeof body.updated_at === 'string' ? body.updated_at : now,
        }
        return json({ article: await options.platform.publicationStore.createArticle(article) }, 201)
      }

      const articleMatch = /^\/articles\/([^/]+)$/.exec(routePath)
      if (articleMatch && request.method === 'GET') {
        await authenticate(request, ['articles:read'])
        const article = await options.platform.publicationStore.getArticleByIdentifier(decodeURIComponent(articleMatch[1]))
        if (!article) {
          throw new PublicationApiError(404, 'article_not_found', 'Article not found.')
        }
        return json({ article })
      }

      if (articleMatch && request.method === 'PATCH') {
        await authenticate(request, ['articles:write'])
        const identifier = decodeURIComponent(articleMatch[1])
        const existing = await options.platform.publicationStore.getArticleByIdentifier(identifier)
        if (!existing) {
          throw new PublicationApiError(404, 'article_not_found', 'Article not found.')
        }
        const body = await readJson(request)
        const updates: Partial<PublicationArticleRecord> = {
          title: typeof body.title === 'string' ? body.title : existing.title,
          slug: typeof body.slug === 'string' ? body.slug : existing.slug,
          content_markdown: typeof body.content_markdown === 'string'
            ? body.content_markdown
            : typeof body.contentMarkdown === 'string'
              ? body.contentMarkdown
              : existing.content_markdown,
          metadata: isRecord(body.metadata) ? body.metadata : existing.metadata,
          status: body.status === 'published' || body.status === 'draft' ? body.status : existing.status,
          updated_at: new Date().toISOString(),
        }
        return json({ article: await options.platform.publicationStore.updateArticle(existing.id, updates) })
      }

      if (articleMatch && request.method === 'DELETE') {
        await authenticate(request, ['articles:delete'])
        const existing = await options.platform.publicationStore.getArticleByIdentifier(decodeURIComponent(articleMatch[1]))
        if (!existing) {
          throw new PublicationApiError(404, 'article_not_found', 'Article not found.')
        }
        await options.platform.publicationStore.deleteArticle(existing.id)
        return json({ deleted: true, article: existing })
      }

      if (routePath === '/mcp' && request.method === 'POST') {
        await authenticate(request, ['mcp:connect'])
        const payload = await readJson(request)
        if (payload.method === 'tools/list') {
          return json({
            jsonrpc: '2.0',
            id: payload.id ?? null,
            result: {
              tools: Object.entries(PUBLICATION_MCP_TOOL_SCOPES).map(([name, scope]) => ({
                name,
                requiredScope: scope,
              })),
            },
          })
        }
        return json({
          jsonrpc: '2.0',
          id: payload.id ?? null,
          error: {
            code: -32601,
            message: 'This reference handler exposes MCP discovery only. Mount the full Studio service for tool execution.',
          },
        }, 400)
      }

      throw new PublicationApiError(404, 'route_not_found', `No publication route matched ${request.method} ${routePath}.`)
    } catch (error) {
      return errorResponse(error)
    }
  }

  function authenticate(request: Request, requiredScopes: PublicationTokenScope[]) {
    return authenticatePublicationRequest({
      headers: request.headers,
      requiredScopes,
      platform: options.platform,
      secrets: options.tokenSecrets,
      staticTokens: options.staticTokens,
      route: new URL(request.url).pathname,
      method: request.method,
    })
  }
}

function normalizeBasePath(basePath: string) {
  const normalized = `/${basePath.replace(/^\/+|\/+$/g, '')}`
  return normalized === '/' ? '' : normalized
}

function stripBasePath(pathname: string, basePath: string) {
  if (!basePath) {
    return pathname || '/'
  }

  return pathname.startsWith(basePath) ? pathname.slice(basePath.length) || '/' : pathname
}

function parseStatus(status: string | null) {
  return status === 'draft' || status === 'published' || status === 'all' ? status : 'all'
}

function parseLimit(limit: string | null) {
  if (!limit) {
    return undefined
  }

  const parsed = Number(limit)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function readJson(request: Request) {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PublicationApiError(400, 'invalid_request', `${field} is required.`)
  }

  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...corsHeaders(),
    },
  })
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Authorization, Content-Type, x-publication-token',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PublicationApiError) {
    return json({ error: error.message, code: error.code, details: error.details }, error.status)
  }

  return json({
    error: error instanceof Error ? error.message : 'Unknown publication server error',
    code: 'internal_error',
  }, 500)
}

const STATIC_ADMIN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Publication MCP Studio Admin</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 760px; }
      label { display: block; margin-top: 1rem; font-weight: 700; }
      input, button, textarea { box-sizing: border-box; font: inherit; padding: .7rem; width: 100%; }
      button { margin-top: 1rem; cursor: pointer; }
      textarea { min-height: 8rem; }
      pre { background: #111; color: #f8f8f2; overflow: auto; padding: 1rem; }
    </style>
  </head>
  <body>
    <h1>Publication MCP Studio Admin</h1>
    <p>Sign in to mint a short-lived publication API token for this host.</p>
    <form id="login">
      <label>Email <input name="email" type="email" autocomplete="username" /></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" /></label>
      <button>Issue Token</button>
    </form>
    <h2>Result</h2>
    <textarea id="token" readonly></textarea>
    <pre id="raw">{}</pre>
    <script>
      document.getElementById('login').addEventListener('submit', async (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const response = await fetch('__BASE_PATH__/admin/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
        })
        const data = await response.json()
        document.getElementById('token').value = data.token?.token || ''
        document.getElementById('raw').textContent = JSON.stringify(data, null, 2)
      })
    </script>
  </body>
</html>`
