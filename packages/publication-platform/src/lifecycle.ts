import { createHash, randomUUID } from 'node:crypto'
import { PublicationApiError } from './errors'
import type { PublicationArticleRecord, PublicationAuthContext, PublicationStore } from './types'
import type { PublicationTokenScope } from './token-scopes'

export function assertPublicationPermission(actor: Pick<PublicationAuthContext, 'scopes'> | undefined, scopes: PublicationTokenScope[]) {
  if (!actor) throw new PublicationApiError(401, 'unauthorized', 'Authenticated engine authority is required.')
  if (!actor.scopes.includes('*') && scopes.some(scope => !actor.scopes.includes(scope))) throw new PublicationApiError(403, 'insufficient_scope', `Required scopes: ${scopes.join(', ')}.`)
}

export function assertPublicationMutation(actor: Pick<PublicationAuthContext, 'scopes'> | undefined, existing: PublicationArticleRecord | null, nextStatus: string) {
  assertPublicationPermission(actor, ['articles:write'])
  if (nextStatus === 'published' || existing?.status === 'published') assertPublicationPermission(actor, ['articles:publish'])
  if (existing?.status === 'published') throw new PublicationApiError(409, 'published_article_requires_revision', 'Create a private revision to edit a live article, or use the explicit unpublish operation.')
  if (nextStatus === 'published' && existing?.metadata.publicationRevision) throw new PublicationApiError(409, 'revision_requires_publish_revision', 'Use publish_revision with the reviewed digest.')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** Digest binds review to all publication content, not database timestamp precision. */
export function publicationContentDigest(article: PublicationArticleRecord) {
  const { id, title, slug, contentMarkdown, status, metadata, category, tags } = article
  return createHash('sha256').update(canonical({ id, title, slug, contentMarkdown, status, metadata, category, tags })).digest('hex')
}

export async function updatePublicationIfUnchanged(store: PublicationStore, expected: PublicationArticleRecord, updates: Partial<PublicationArticleRecord>) {
  if (!store.updateArticleIfMatches) throw new PublicationApiError(501, 'conditional_publication_unavailable', 'This adapter must implement atomic conditional mutation.')
  const article = await store.updateArticleIfMatches(expected, updates)
  if (!article) throw new PublicationApiError(409, 'article_changed', 'Article changed during this operation. Read it again before retrying.')
  return article
}

export async function createPublicationRevision(store: PublicationStore, identifier: string, actor: PublicationAuthContext) {
  assertPublicationPermission(actor, ['articles:read', 'articles:write'])
  const original = await store.getArticleByIdentifier(identifier)
  if (!original) throw new PublicationApiError(404, 'article_not_found', 'Article not found.')
  if (original.status !== 'published') throw new PublicationApiError(409, 'article_not_published', 'Edit an existing private draft directly.')
  const id = randomUUID(), now = new Date().toISOString()
  return store.createArticle({ ...original, id, slug: `${original.slug}-revision-${id.slice(0, 8)}`, status: 'draft', createdAt: now, updatedAt: now,
    metadata: { ...original.metadata, publicationRevision: { articleId: original.id, baseDigest: publicationContentDigest(original) } },
  })
}

export async function preparePublication(store: PublicationStore, identifier: string, actor: PublicationAuthContext) {
  assertPublicationPermission(actor, ['articles:read'])
  const article = await store.getArticleByIdentifier(identifier)
  if (!article) throw new PublicationApiError(404, 'article_not_found', 'Article not found.')
  return { article, digest: publicationContentDigest(article), ready: article.status === 'draft' && Boolean(article.title.trim() && article.contentMarkdown.trim()) }
}

export async function publishPublicationRevision(store: PublicationStore, identifier: string, expectedDigest: string, actor: PublicationAuthContext) {
  assertPublicationPermission(actor, ['articles:read', 'articles:publish'])
  const draft = await store.getArticleByIdentifier(identifier)
  if (!draft) throw new PublicationApiError(404, 'article_not_found', 'Revision not found.')
  if (!expectedDigest || publicationContentDigest(draft) !== expectedDigest) throw new PublicationApiError(409, 'revision_changed', 'Revision changed since review. Prepare and review it again.')
  const revision = draft.metadata.publicationRevision as { articleId?: string; baseDigest?: string } | undefined
  if (draft.status !== 'draft' || !revision?.articleId || !revision.baseDigest) throw new PublicationApiError(409, 'not_a_revision', 'A private revision is required.')
  if (!draft.title.trim() || !draft.contentMarkdown.trim()) throw new PublicationApiError(400, 'empty_publication', 'Title and content are required.')
  const original = await store.getArticleByIdentifier(revision.articleId)
  if (!original || original.status !== 'published' || publicationContentDigest(original) !== revision.baseDigest) throw new PublicationApiError(409, 'publication_changed', 'Live article changed or was withdrawn. Create a fresh revision.')
  if (!store.updateArticleIfMatches) throw new PublicationApiError(501, 'conditional_publication_unavailable', 'This adapter must implement atomic conditional publication.')
  const { publicationRevision: _revision, publicationEpoch: _epoch, ...metadata } = draft.metadata
  const published = await store.updateArticleIfMatches(original, {
    title: draft.title, contentMarkdown: draft.contentMarkdown, metadata: { ...metadata, publicationEpoch: randomUUID() }, category: draft.category, tags: draft.tags,
    status: 'published', updatedAt: new Date().toISOString(),
  })
  if (!published) throw new PublicationApiError(409, 'publication_changed', 'Live article changed during publication. Create a fresh revision.')
  // Retain the private revision for history. Its old base digest prevents replay.
  return published
}
