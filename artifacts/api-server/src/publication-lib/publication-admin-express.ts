import { createClient } from '@supabase/supabase-js'
import type { AdminAuthStore, PublicationAdminUser } from '@publication-mcp-studio/platform'
import type { Request, Response } from 'express'

const LOCAL_ADMIN_COOKIE = 'publication_admin_session'

// Thread-local style storage for request/response context
let _currentReq: Request | null = null
let _currentRes: Response | null = null

export function setPublicationAdminRequestContext(req: Request, res: Response) {
  _currentReq = req
  _currentRes = res
}

export function clearPublicationAdminRequestContext() {
  _currentReq = null
  _currentRes = null
}

export function createExpressLocalPublicationAdminAuthStore(options: {
  adminEmail?: string
  adminPassword?: string
} = {}): AdminAuthStore {
  const configuredAdminEmail = options.adminEmail?.trim().toLowerCase() || ''
  const configuredAdminPassword = options.adminPassword ?? ''

  return {
    kind: 'local',

    async getCurrentUser() {
      const req = _currentReq
      if (!req) return null
      const session = (req.cookies as Record<string, string>)[LOCAL_ADMIN_COOKIE]?.trim()
      if (!session) return null

      return {
        id: 'local-admin',
        email: decodeURIComponent(session),
        mode: 'local',
      } satisfies PublicationAdminUser
    },

    async signOut() {
      const res = _currentRes
      if (res) {
        res.clearCookie(LOCAL_ADMIN_COOKIE, { path: '/' })
      }
    },

    async signInWithPassword(input) {
      const email = input.email.trim().toLowerCase()
      const password = input.password.trim()

      if (!email || !password) {
        throw new Error('Email and password are required for a local admin session.')
      }

      if (configuredAdminEmail || configuredAdminPassword) {
        if (
          !configuredAdminEmail ||
          !configuredAdminPassword ||
          email !== configuredAdminEmail ||
          password !== configuredAdminPassword
        ) {
          throw new Error('Invalid admin credentials for this publication workspace.')
        }
      }

      const res = _currentRes
      if (res) {
        res.cookie(LOCAL_ADMIN_COOKIE, encodeURIComponent(email), {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 60 * 60 * 24 * 30 * 1000,
        })
      }

      return {
        id: 'local-admin',
        email,
        mode: 'local',
      } satisfies PublicationAdminUser
    },
  }
}

export function createExpressSupabasePublicationAdminAuthStore(): AdminAuthStore {
  return {
    kind: 'supabase',

    async getCurrentUser() {
      const req = _currentReq
      if (!req) return null

      // Extract auth token from cookie or header
      const token = (req.cookies as Record<string, string>)['sb-access-token'] ||
        req.headers.authorization?.replace('Bearer ', '')

      if (!token) return null

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
      if (!supabaseUrl || !supabaseAnonKey) return null

      const supabase = createClient(supabaseUrl, supabaseAnonKey)
      const { data: { user } } = await supabase.auth.getUser(token)
      if (!user) return null

      return {
        id: user.id,
        email: user.email ?? null,
        mode: 'supabase',
      } satisfies PublicationAdminUser
    },

    async signOut() {
      const res = _currentRes
      if (res) {
        res.clearCookie('sb-access-token', { path: '/' })
      }
    },
  }
}
