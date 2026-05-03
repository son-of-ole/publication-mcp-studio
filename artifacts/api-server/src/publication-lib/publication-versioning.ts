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

  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1
  return platform.versionStore.createVersion({
    articleId: input.article.id,
    versionNumber: nextVersionNumber,
    sourceAction: input.sourceAction,
    title: input.article.title,
    slug: input.article.slug,
    contentMarkdown: input.article.contentMarkdown,
    status: input.article.status,
    actorLabel: input.actor?.label ?? null,
    actorType: input.actor?.tokenType ?? null,
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
    contentMarkdown: version.contentMarkdown,
    status: version.status,
    updatedAt: restoredAt,
  })

  await createPublicationArticleVersionSnapshot({
    article: updatedArticle,
    sourceAction: 'restore',
    actor: input.actor,
    metadata: {
      restoredFromVersionId: version.id,
      restoredFromVersionNumber: version.versionNumber,
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
