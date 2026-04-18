import { getPublicationServiceClient } from '@/lib/publication-db'
import { PublicationApiError } from '@/lib/publication-errors'
import type { PublicationTokenScope } from '@/lib/publication-tokens'

export type PublicationTokenInventoryRecord = {
  id: string
  label: string
  token_type: 'signed'
  scopes: PublicationTokenScope[]
  issued_at: string
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  last_used_route: string | null
  last_used_method: string | null
  created_at: string
  updated_at: string
}

export async function createPublicationTokenInventoryRecord(input: {
  label: string
  scopes: PublicationTokenScope[]
  issuedAt: string
  expiresAt: string
}) {
  const supabase = getPublicationServiceClient()
  const { data, error } = await supabase
    .from('publication_api_tokens')
    .insert({
      label: input.label,
      token_type: 'signed',
      scopes: input.scopes,
      issued_at: input.issuedAt,
      expires_at: input.expiresAt,
    })
    .select('*')
    .single()

  if (error) {
    throw new PublicationApiError(500, 'token_inventory_create_failed', error.message, error)
  }

  return data as PublicationTokenInventoryRecord
}

export async function listPublicationTokenInventory(limit = 50) {
  const supabase = getPublicationServiceClient()
  const { data, error } = await supabase
    .from('publication_api_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, Math.floor(limit))))

  if (error) {
    throw new PublicationApiError(500, 'token_inventory_list_failed', error.message, error)
  }

  return (data ?? []) as PublicationTokenInventoryRecord[]
}

export async function getPublicationTokenInventoryRecord(tokenId: string) {
  const supabase = getPublicationServiceClient()
  const { data, error } = await supabase
    .from('publication_api_tokens')
    .select('*')
    .eq('id', tokenId)
    .maybeSingle()

  if (error) {
    throw new PublicationApiError(500, 'token_inventory_lookup_failed', error.message, error)
  }

  return (data ?? null) as PublicationTokenInventoryRecord | null
}

export async function revokePublicationTokenInventoryRecord(tokenId: string) {
  const supabase = getPublicationServiceClient()
  const revokedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('publication_api_tokens')
    .update({
      revoked_at: revokedAt,
      updated_at: revokedAt,
    })
    .eq('id', tokenId)
    .select('*')
    .single()

  if (error) {
    throw new PublicationApiError(500, 'token_inventory_revoke_failed', error.message, error)
  }

  return data as PublicationTokenInventoryRecord
}

export async function touchPublicationTokenInventoryRecord(tokenId: string, route: string, method: string) {
  const supabase = getPublicationServiceClient()
  const touchedAt = new Date().toISOString()
  const { error } = await supabase
    .from('publication_api_tokens')
    .update({
      last_used_at: touchedAt,
      last_used_route: route,
      last_used_method: method,
      updated_at: touchedAt,
    })
    .eq('id', tokenId)

  if (error) {
    console.error('Failed to update publication token last-used metadata:', error)
  }
}
