import { PublicationApiError } from '@/lib/publication-errors'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { PublicationAuthContext } from '@/lib/publication-service'

export async function assertPublicationAdminSession(purpose: string) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new PublicationApiError(401, 'unauthorized', `You must be signed in to ${purpose}.`)
  }

  return user
}

export function createPublicationAdminAuthContext(email?: string | null): PublicationAuthContext {
  return {
    tokenType: 'static',
    label: email || 'Admin Dashboard',
    scopes: ['*'],
  }
}
