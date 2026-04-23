import { getPublicationPlatform, hasSupabasePublicationPlatformConfig } from '@publication-platform'
import type { PublicationAuthContext } from '@publication-platform/types'
import { PublicationApiError } from '@/lib/publication-errors'
import { listPublicationSkills } from '@/lib/publication-skills'

export async function assertPublicationAdminSession(purpose: string) {
  const user = await getPublicationPlatform().adminAuthStore.getCurrentUser()

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
    enabledSkillIds: listPublicationSkills({
      auth: { enabledSkillIds: [], adminVisibility: true },
      includeDisabled: true,
    }).map((skill) => skill.id),
    adminVisibility: true,
  }
}

export async function signOutPublicationAdminSession() {
  await getPublicationPlatform().adminAuthStore.signOut()
}

export function getPublicationAdminMode() {
  return hasSupabasePublicationPlatformConfig() ? 'supabase' : 'local'
}
