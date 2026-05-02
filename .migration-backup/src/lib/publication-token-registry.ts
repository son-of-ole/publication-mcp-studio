import { getPublicationPlatform } from '@/lib/publication-platform'
import { PublicationApiError } from '@/lib/publication-errors'
import type { PublicationTokenScope } from '@/lib/publication-tokens'

export async function createPublicationTokenInventoryRecord(input: {
  label: string
  scopes: PublicationTokenScope[]
  profileId?: string | null
  profileLabel?: string | null
  profileEnabledSkillIds?: string[]
  tokenEnabledSkillIds?: string[] | null
  allowProfileSkillOverrides?: boolean
  issuedAt: string
  expiresAt: string
}) {
  try {
    return await getPublicationPlatform().tokenStore.createTokenRecord({
      label: input.label,
      scopes: input.scopes,
      profileId: input.profileId,
      profileLabel: input.profileLabel,
      profileEnabledSkillIds: input.profileEnabledSkillIds,
      tokenEnabledSkillIds: input.tokenEnabledSkillIds,
      allowProfileSkillOverrides: input.allowProfileSkillOverrides,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    })
  } catch (error) {
    throw new PublicationApiError(500, 'token_inventory_create_failed', error instanceof Error ? error.message : 'Token creation failed', error)
  }
}

export async function listPublicationTokenInventory(limit = 50) {
  try {
    return await getPublicationPlatform().tokenStore.listTokenRecords(limit)
  } catch (error) {
    throw new PublicationApiError(500, 'token_inventory_list_failed', error instanceof Error ? error.message : 'Token listing failed', error)
  }
}

export async function getPublicationTokenInventoryRecord(tokenId: string) {
  try {
    return await getPublicationPlatform().tokenStore.getTokenRecord(tokenId)
  } catch (error) {
    throw new PublicationApiError(500, 'token_inventory_lookup_failed', error instanceof Error ? error.message : 'Token lookup failed', error)
  }
}

export async function revokePublicationTokenInventoryRecord(tokenId: string) {
  try {
    return await getPublicationPlatform().tokenStore.revokeTokenRecord(tokenId)
  } catch (error) {
    throw new PublicationApiError(500, 'token_inventory_revoke_failed', error instanceof Error ? error.message : 'Token revoke failed', error)
  }
}

export async function touchPublicationTokenInventoryRecord(tokenId: string, route: string, method: string) {
  try {
    await getPublicationPlatform().tokenStore.touchTokenRecord(tokenId, route, method)
  } catch (error) {
    console.error('Failed to update publication token last-used metadata:', error)
  }
}
