import { getPublicationServiceClient } from '@/lib/publication-db'
import { PublicationApiError } from '@/lib/publication-errors'
import type { PublicationArticleRecord, PublicationAuthContext } from '@/lib/publication-service'

export type PublicationArticleVersionRecord = {
  id: string
  article_id: string
  version_number: number
  source_action: string
  title: string
  slug: string
  content_markdown: string
  status: 'draft' | 'published'
  actor_label: string | null
  actor_type: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function createPublicationArticleVersionSnapshot(input: {
  article: PublicationArticleRecord
  sourceAction: string
  actor?: PublicationAuthContext
  metadata?: Record<string, unknown>
}) {
  const supabase = getPublicationServiceClient()
  const { data: latestVersion, error: latestError } = await supabase
    .from('publication_article_versions')
    .select('version_number')
    .eq('article_id', input.article.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError) {
    throw new PublicationApiError(500, 'article_version_lookup_failed', latestError.message, latestError)
  }

  const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1
  const { data, error } = await supabase
    .from('publication_article_versions')
    .insert({
      article_id: input.article.id,
      version_number: nextVersionNumber,
      source_action: input.sourceAction,
      title: input.article.title,
      slug: input.article.slug,
      content_markdown: input.article.content_markdown,
      status: input.article.status,
      actor_label: input.actor?.label ?? null,
      actor_type: input.actor?.tokenType ?? null,
      metadata: input.metadata ?? null,
    })
    .select('*')
    .single()

  if (error) {
    throw new PublicationApiError(500, 'article_version_create_failed', error.message, error)
  }

  return data as PublicationArticleVersionRecord
}

export async function listPublicationArticleVersions(identifier: string) {
  const article = await findPublicationArticleByIdentifier(identifier)
  const supabase = getPublicationServiceClient()
  const { data, error } = await supabase
    .from('publication_article_versions')
    .select('*')
    .eq('article_id', article.id)
    .order('version_number', { ascending: false })

  if (error) {
    throw new PublicationApiError(500, 'article_versions_list_failed', error.message, error)
  }

  return {
    article,
    versions: (data ?? []) as PublicationArticleVersionRecord[],
  }
}

export async function restorePublicationArticleVersion(input: {
  articleIdentifier: string
  versionId: string
  actor?: PublicationAuthContext
}) {
  const article = await findPublicationArticleByIdentifier(input.articleIdentifier)
  const supabase = getPublicationServiceClient()
  const { data: version, error: versionError } = await supabase
    .from('publication_article_versions')
    .select('*')
    .eq('id', input.versionId)
    .eq('article_id', article.id)
    .maybeSingle()

  if (versionError) {
    throw new PublicationApiError(500, 'article_version_restore_lookup_failed', versionError.message, versionError)
  }

  if (!version) {
    throw new PublicationApiError(404, 'article_version_not_found', 'The requested article version could not be found.')
  }

  const restoredAt = new Date().toISOString()
  const { data: updatedArticle, error: updateError } = await supabase
    .from('articles')
    .update({
      title: version.title,
      slug: version.slug,
      content_markdown: version.content_markdown,
      status: version.status,
      updated_at: restoredAt,
    })
    .eq('id', article.id)
    .select('*')
    .single()

  if (updateError) {
    throw new PublicationApiError(500, 'article_version_restore_failed', updateError.message, updateError)
  }

  await createPublicationArticleVersionSnapshot({
    article: updatedArticle as PublicationArticleRecord,
    sourceAction: 'restore',
    actor: input.actor,
    metadata: {
      restoredFromVersionId: version.id,
      restoredFromVersionNumber: version.version_number,
    },
  })

  return {
    article: updatedArticle as PublicationArticleRecord,
    restoredFromVersion: version as PublicationArticleVersionRecord,
  }
}

async function findPublicationArticleByIdentifier(identifier: string) {
  const supabase = getPublicationServiceClient()
  const cleanIdentifier = identifier.trim()

  if (!cleanIdentifier) {
    throw new PublicationApiError(400, 'article_identifier_missing', 'An article identifier or slug is required.')
  }

  if (UUID_PATTERN.test(cleanIdentifier)) {
    const { data, error } = await supabase.from('articles').select('*').eq('id', cleanIdentifier).maybeSingle()

    if (error) {
      throw new PublicationApiError(500, 'article_lookup_failed', error.message, error)
    }

    if (data) {
      return data as PublicationArticleRecord
    }
  }

  const { data, error } = await supabase.from('articles').select('*').eq('slug', cleanIdentifier).maybeSingle()

  if (error) {
    throw new PublicationApiError(500, 'article_lookup_failed', error.message, error)
  }

  if (!data) {
    throw new PublicationApiError(404, 'article_not_found', `No article found for "${cleanIdentifier}".`)
  }

  return data as PublicationArticleRecord
}
