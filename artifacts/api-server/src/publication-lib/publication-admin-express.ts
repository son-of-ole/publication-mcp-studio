import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { AdminAuthStore, PublicationAdminUser } from '@publication-mcp-studio/platform'
import type { Request, Response } from 'express'
import { PublicationApiError } from './publication-errors.js'

const LOCAL_ADMIN_COOKIE = 'publication_admin_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const MAX_SESSIONS = 1000

// Factories are recreated per request; sessions belong to the server process.
// Restarting the server revokes all sessions. Never persist bearer session IDs.
const sessions = new Map<string, { credentials: string; email: string; expiresAt: number }>()

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

function sessionId(req: Request | null) {
  const value: unknown = req?.cookies?.[LOCAL_ADMIN_COOKIE]
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
}

function assertSameOrigin(req: Request) {
  const origin = req.get('origin')
  if (origin) {
    try {
      const url = new URL(origin)
      // Explicit public origin supports TLS-terminating proxies without trusting
      // client-supplied Forwarded/X-Forwarded-* headers.
      const configuredOrigin = process.env.PUBLICATION_ADMIN_ORIGIN
      const expected = configuredOrigin
        ? new URL(configuredOrigin).origin
        : `${process.env.NODE_ENV === 'production' ? 'https' : req.protocol}://${req.get('host')}`
      if (['http:', 'https:'].includes(url.protocol) && url.origin === expected) return
    } catch { /* Invalid origins fail closed. */ }
    throw new PublicationApiError(403, 'admin_origin_invalid', 'Admin sessions require same-origin requests.')
  }
  if (req.get('sec-fetch-site') === 'cross-site') {
    throw new PublicationApiError(403, 'admin_origin_invalid', 'Admin sessions require same-origin requests.')
  }
}

interface PublicationAdminRequestContext {
  req: Request
  res: Response
}

const requestContextStorage = new AsyncLocalStorage<PublicationAdminRequestContext>()

export function runWithPublicationAdminRequestContext<T>(
  req: Request,
  res: Response,
  fn: () => T,
): T {
  return requestContextStorage.run({ req, res }, fn)
}

// Backwards-compatible API used by Express middleware. Prefer
// `runWithPublicationAdminRequestContext` for request-scoped isolation; this
// helper enters a new AsyncLocalStorage scope and chains it onto `next()` so
// downstream async handlers resolve the correct request/response.
export function setPublicationAdminRequestContext(
  req: Request,
  res: Response,
  next?: () => void,
) {
  if (next) {
    requestContextStorage.run({ req, res }, next)
    return
  }
  requestContextStorage.enterWith({ req, res })
}

export function clearPublicationAdminRequestContext() {
  // No-op retained for backwards compatibility; AsyncLocalStorage scopes exit
  // automatically when the request handler completes.
}

function getCurrentRequest(): Request | null {
  return requestContextStorage.getStore()?.req ?? null
}

function getCurrentResponse(): Response | null {
  return requestContextStorage.getStore()?.res ?? null
}

export function createExpressLocalPublicationAdminAuthStore(options: {
  adminEmail?: string
  adminPassword?: string
} = {}): AdminAuthStore {
  const configuredAdminEmail = options.adminEmail?.trim().toLowerCase() || ''
  const configuredAdminPassword = options.adminPassword ?? ''
  const credentials = digest(JSON.stringify([configuredAdminEmail, configuredAdminPassword])).toString('hex')

  return {
    kind: 'local',

    async getCurrentUser() {
      const req = getCurrentRequest()
      if (!req) return null
      if (!configuredAdminEmail || !configuredAdminPassword) return null
      const id = sessionId(req)
      if (!id) return null
      const session = sessions.get(id)
      if (!session) return null
      if (session.expiresAt <= Date.now() || session.credentials !== credentials) {
        sessions.delete(id)
        return null
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertSameOrigin(req)

      return {
        id: 'local-admin',
        email: session.email,
        mode: 'local',
      } satisfies PublicationAdminUser
    },

    async signOut() {
      const req = getCurrentRequest()
      if (req) assertSameOrigin(req)
      const id = sessionId(req)
      if (id) sessions.delete(id)
      const res = getCurrentResponse()
      if (res) {
        res.clearCookie(LOCAL_ADMIN_COOKIE, { path: '/' })
      }
    },

    async signInWithPassword(input) {
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
      const password = typeof input.password === 'string' ? input.password : ''

      if (!email || !password) {
        throw new PublicationApiError(400, 'admin_credentials_missing', 'Email and password are required for a local admin session.')
      }

      if (!configuredAdminEmail || !configuredAdminPassword) {
        throw new PublicationApiError(503, 'admin_login_disabled',
          'Local admin sign-in is disabled until PUBLICATION_ADMIN_EMAIL and PUBLICATION_ADMIN_PASSWORD are configured.',
        )
      }

      if (email !== configuredAdminEmail || !timingSafeEqual(digest(password), digest(configuredAdminPassword))) {
        throw new PublicationApiError(401, 'admin_credentials_invalid', 'Invalid admin credentials for this publication workspace.')
      }

      const req = getCurrentRequest()
      const res = getCurrentResponse()
      if (!req || !res) throw new PublicationApiError(500, 'admin_context_missing', 'Admin login requires an HTTP request context.')
      assertSameOrigin(req)
      const previousId = sessionId(req)
      if (previousId) sessions.delete(previousId)
      const now = Date.now()
      for (const [id, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(id)
      }
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
      const id = randomBytes(32).toString('base64url')
      sessions.set(id, { credentials, email, expiresAt: now + SESSION_TTL_MS })
      res.cookie(LOCAL_ADMIN_COOKIE, id, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_TTL_MS,
      })

      return {
        id: 'local-admin',
        email,
        mode: 'local',
      } satisfies PublicationAdminUser
    },
  }
}

export function createExpressSupabasePublicationAdminAuthStore(options: {
  verifyUser?: (token: string) => Promise<{ id: string; email?: string } | null>
  adminUserIds?: string[]
} = {}): AdminAuthStore {
  return {
    kind: 'supabase',

    async getCurrentUser() {
      const req = getCurrentRequest()
      if (!req) return null

      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
      const cookie = req.cookies?.['sb-access-token']
      const token = bearer || (typeof cookie === 'string' ? cookie : '')

      if (!token) return null
      const allowedIds = options.adminUserIds ?? (process.env.PUBLICATION_ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
      if (!allowedIds.length) return null
      if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertSameOrigin(req)

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
      if (!options.verifyUser && (!supabaseUrl || !supabaseAnonKey)) return null

      const user = options.verifyUser ? await options.verifyUser(token) : (await createClient(supabaseUrl!, supabaseAnonKey!).auth.getUser(token)).data.user
      if (!user || !allowedIds.includes(user.id)) return null

      return {
        id: user.id,
        email: user.email ?? null,
        mode: 'supabase',
      } satisfies PublicationAdminUser
    },

    async signOut() {
      const req = getCurrentRequest()
      if (req) assertSameOrigin(req)
      const res = getCurrentResponse()
      if (res) {
        res.clearCookie('sb-access-token', { path: '/' })
      }
    },
  }
}
