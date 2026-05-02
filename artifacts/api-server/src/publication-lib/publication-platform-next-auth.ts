import { createServerClient } from '@supabase/ssr'

import type { AdminAuthStore, PublicationAdminUser } from '@publication-mcp-studio/platform/types'

const LOCAL_ADMIN_COOKIE = 'publication_admin_session'

export function createNextLocalPublicationAdminAuthStore(options: {
  adminEmail?: string
  adminPassword?: string
} = {}): AdminAuthStore {
  const configuredAdminEmail = options.adminEmail?.trim().toLowerCase() || ''
  const configuredAdminPassword = options.adminPassword ?? ''

  return {
    kind: 'local',

    async getCurrentUser() {
      const cookieStore = await cookies()
      const session = cookieStore.get(LOCAL_ADMIN_COOKIE)?.value?.trim()
      if (!session) {
        return null
      }

      return {
        id: 'local-admin',
        email: decodeURIComponent(session),
        mode: 'local',
      } satisfies PublicationAdminUser
    },

    async signOut() {
      const cookieStore = await cookies()
      cookieStore.delete(LOCAL_ADMIN_COOKIE)
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

      const cookieStore = await cookies()
      cookieStore.set(LOCAL_ADMIN_COOKIE, encodeURIComponent(email), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 30,
      })

      return {
        id: 'local-admin',
        email,
        mode: 'local',
      } satisfies PublicationAdminUser
    },
  }
}

export function createNextSupabasePublicationAdminAuthStore(): AdminAuthStore {
  return {
    kind: 'supabase',

    async getCurrentUser() {
      const supabase = await createNextSupabaseServerClient()
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
      const supabase = await createNextSupabaseServerClient()
      await supabase.auth.signOut()
    },
  }
}

async function createNextSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for the Next.js Supabase admin auth store.'
    )
  }

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
