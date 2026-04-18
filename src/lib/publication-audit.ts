import { getPublicationServiceClient } from '@/lib/publication-db'
import type { PublicationAuthContext, PublicationArticleRecord } from '@/lib/publication-service'

export type PublicationAuditAction =
  | 'tokens.issue'
  | 'tokens.revoke'
  | 'media.list'
  | 'media.upload'
  | 'media.delete'
  | 'articles.list'
  | 'articles.read'
  | 'articles.create'
  | 'articles.update'
  | 'articles.publish'
  | 'articles.delete'
  | 'versions.list'
  | 'versions.restore'
  | 'agent.generate'
  | 'mcp.connect'
  | 'audit.read'

export type PublicationAuditEntry = {
  id: string
  action: PublicationAuditAction
  actor_label: string
  actor_type: string
  scopes: string[]
  route: string
  method: string
  article_id: string | null
  article_slug: string | null
  status: string
  metadata: Record<string, unknown> | null
  created_at: string
}

let auditLoggingDisabled = false

export async function recordPublicationAuditEvent(input: {
  action: PublicationAuditAction
  auth: PublicationAuthContext
  route: string
  method: string
  article?: Pick<PublicationArticleRecord, 'id' | 'slug'> | null
  metadata?: Record<string, unknown>
  status?: 'success' | 'error'
}) {
  if (auditLoggingDisabled) {
    return
  }

  try {
    const supabase = getPublicationServiceClient()
    const payload = {
      action: input.action,
      actor_label: input.auth.label,
      actor_type: input.auth.tokenType,
      scopes: input.auth.scopes.includes('*') ? ['*'] : input.auth.scopes,
      route: input.route,
      method: input.method,
      article_id: input.article?.id ?? null,
      article_slug: input.article?.slug ?? null,
      status: input.status ?? 'success',
      metadata: input.metadata ?? null,
    }

    const { error } = await supabase.from('publication_api_audit_log').insert(payload)

    if (error) {
      if (error.message.toLowerCase().includes('publication_api_audit_log')) {
        auditLoggingDisabled = true
        return
      }

      console.error('Publication audit logging failed:', error)
    }
  } catch (error) {
    console.error('Publication audit logging failed:', error)
  }
}

export async function listPublicationAuditEvents(limit = 30) {
  const supabase = getPublicationServiceClient()
  const { data, error } = await supabase
    .from('publication_api_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, Math.floor(limit))))

  if (error) {
    if (error.message.toLowerCase().includes('publication_api_audit_log')) {
      return [] as PublicationAuditEntry[]
    }

    throw error
  }

  return (data ?? []) as PublicationAuditEntry[]
}
