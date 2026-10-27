import { createPublicationRevision, preparePublication, publishPublicationRevision, type PublicationAuthContext } from '@publication-mcp-studio/platform'
import { getPublicationPlatform } from './publication-platform.js'
import { createPublicationArticleVersionSnapshot } from './publication-versioning.js'

export async function createRevision(identifier: string, actor: PublicationAuthContext) {
  const article = await createPublicationRevision(getPublicationPlatform().publicationStore, identifier, actor)
  await createPublicationArticleVersionSnapshot({ article, sourceAction: 'revision.create', actor })
  return { article }
}
export async function prepare(identifier: string, actor: PublicationAuthContext) {
  return preparePublication(getPublicationPlatform().publicationStore, identifier, actor)
}
export async function publishRevision(identifier: string, digest: string, actor: PublicationAuthContext) {
  const article = await publishPublicationRevision(getPublicationPlatform().publicationStore, identifier, digest, actor)
  await createPublicationArticleVersionSnapshot({ article, sourceAction: 'revision.publish', actor })
  return { article }
}
