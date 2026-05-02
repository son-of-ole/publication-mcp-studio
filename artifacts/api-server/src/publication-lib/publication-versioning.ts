import { getPublicationPlatform } from './publication-platform.js'
import type { PublicationArticleRecord, PublicationAuthContext } from '@publication-mcp-studio/platform'
import { PublicationApiError } from './publication-errors.js'

export async function createPublicationArticleVersionSnapshot(input: {
  article: PublicationArticleRecord
  sourceAction: string
  actor?: PublicationAuthContext
  metadata?: Record<string, unknown>
}) {
  const platform = getPublicationPlatform()
  const latestVersion = (await platform.versionStore.listVersions(input.article.id))[0] ?? null

  const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1
  return platform.versionStore.createVersion({
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
}

export async function listPublicationArticleVersions(identifier: string) {
  const article = await findPublicationArticleByIdentifier(identifier)

  return {
    article,
    versions: await getPublicationPlatform().versionStore.listVersions(article.id),
  }
}

export async function restorePublicationArticleVersion(input: {
  articleIdentifier: string
  versionId: string
  actor?: PublicationAuthContext
}) {
  const article = await findPublicationArticleByIdentifier(input.articleIdentifier)
  const platform = getPublicationPlatform()
  const version = await platform.versionStore.getVersion(article.id, input.versionId)

  if (!version) {
    throw new PublicationApiError(404, 'article_version_not_found', 'The requested article version could not be found.')
  }

  const restoredAt = new Date().toISOString()
  const updatedArticle = await platform.publicationStore.updateArticle(article.id, {
      title: version.title,
      slug: version.slug,
      content_markdown: version.content_markdown,
      status: version.status,
      updated_at: restoredAt,
    })

  await createPublicationArticleVersionSnapshot({
    article: updatedArticle,
    sourceAction: 'restore',
    actor: input.actor,
    metadata: {
      restoredFromVersionId: version.id,
      restoredFromVersionNumber: version.version_number,
    },
  })

  return {
    article: updatedArticle,
    restoredFromVersion: version,
  }
}

async function findPublicationArticleByIdentifier(identifier: string) {
  const cleanIdentifier = identifier.trim()

  if (!cleanIdentifier) {
    throw new PublicationApiError(400, 'article_identifier_missing', 'An article identifier or slug is required.')
  }

  const article = await getPublicationPlatform().publicationStore.getArticleByIdentifier(cleanIdentifier)

  if (!article) {
    throw new PublicationApiError(404, 'article_not_found', `No article found for "${cleanIdentifier}".`)
  }

  return article
}
