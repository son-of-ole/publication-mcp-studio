import { getPublicationPlatform } from './publication-platform.js'
import type { PublicationAuditAction, PublicationAuthContext, PublicationArticleRecord } from '@publication-mcp-studio/platform'

export async function recordPublicationAuditEvent(input: {
  action: PublicationAuditAction
  auth: PublicationAuthContext
  route: string
  method: string
  article?: Pick<PublicationArticleRecord, 'id' | 'slug'> | null
  metadata?: Record<string, unknown>
  status?: 'success' | 'error'
}) {
  try {
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

    await getPublicationPlatform().auditStore.recordEvent(payload)
  } catch (error) {
    console.error('Publication audit logging failed:', error)
  }
}

export async function listPublicationAuditEvents(limit = 30) {
  return getPublicationPlatform().auditStore.listEvents(limit)
}
