import {
  composePublicationMarkdown,
  createEmptyPublicationMetadata,
  extractPublicationDocument,
  getPublicationPresentation,
  normalizePublicationMetadata,
  type PublicationFrontmatter,
  type PublicationMetadata,
} from '@/lib/publications'
import { getPublicationPlatform } from '@publication-platform'
import type {
  PublicationArticleRecord,
  PublicationArticleStatus,
  PublicationAuthContext,
} from '@publication-platform/types'
import { PublicationApiError } from '@/lib/publication-errors'
import {
  hasPublicationTokenSecret,
  inspectPublicationAccessToken,
  type PublicationTokenScope,
  verifyPublicationAccessToken,
} from '@/lib/publication-tokens'
import {
  getPublicationTokenInventoryRecord,
  touchPublicationTokenInventoryRecord,
} from '@/lib/publication-token-registry'
import { resolvePublicationAuthSkillAccess } from '@/lib/publication-skills'
import {
  createPublicationArticleVersionSnapshot,
  listPublicationArticleVersions as listPublicationVersionsFromStore,
  restorePublicationArticleVersion as restorePublicationVersionFromStore,
} from '@/lib/publication-versioning'

export type {
  PublicationArticleRecord,
  PublicationArticleStatus,
  PublicationAuthContext,
} from '@publication-platform/types'

export type PublicationArticleResponse = {
  id: string
  title: string
  slug: string
  status: PublicationArticleStatus
  createdAt: string
  updatedAt: string
  contentMarkdown?: string
  document: ReturnType<typeof extractPublicationDocument>
  presentation: ReturnType<typeof getPublicationPresentation>
}

export type PublicationArticleMutationInput = {
  title?: string
  slug?: string
  status?: PublicationArticleStatus
  contentMarkdown?: string
  body?: string
  metadata?: Partial<PublicationMetadata>
  customFrontmatter?: PublicationFrontmatter
}

export function normalizePublicationArticleMutationInput(raw: unknown): PublicationArticleMutationInput {
  if (!raw || typeof raw !== 'object') {
    return {}
  }

  const input = raw as Record<string, unknown>
  const contentMarkdownValue =
    typeof input.contentMarkdown === 'string'
      ? input.contentMarkdown
      : typeof input.content_markdown === 'string'
        ? input.content_markdown
        : undefined
  const customFrontmatterValue =
    input.customFrontmatter && typeof input.customFrontmatter === 'object'
      ? (input.customFrontmatter as PublicationFrontmatter)
      : input.custom_frontmatter && typeof input.custom_frontmatter === 'object'
        ? (input.custom_frontmatter as PublicationFrontmatter)
        : undefined

  return {
    title: typeof input.title === 'string' ? input.title : undefined,
    slug: typeof input.slug === 'string' ? input.slug : undefined,
    status: input.status === 'draft' || input.status === 'published' ? input.status : undefined,
    contentMarkdown: contentMarkdownValue,
    body: typeof input.body === 'string' ? input.body : undefined,
    metadata: input.metadata && typeof input.metadata === 'object'
      ? (input.metadata as Partial<PublicationMetadata>)
      : undefined,
    customFrontmatter: customFrontmatterValue,
  }
}

export type PublicationListOptions = {
  status?: PublicationArticleStatus | 'all'
  search?: string
  limit?: number
  includeContent?: boolean
}

const PUBLICATION_API_HEADER = 'x-publication-token'
export function buildPublicationCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-publication-token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
}

export async function assertPublicationApiAuth(
  request: Request,
  requiredScopes: PublicationTokenScope[] = []
): Promise<PublicationAuthContext> {
  const configuredTokens = (process.env.PUBLICATION_API_TOKEN ?? process.env.PUBLICATION_API_TOKENS ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)

  const signedTokensEnabled = hasPublicationTokenSecret()

  if (configuredTokens.length === 0 && !signedTokensEnabled) {
    throw new PublicationApiError(
      500,
      'publication_api_auth_missing',
      'Configure PUBLICATION_API_TOKEN or PUBLICATION_API_SECRET before using the publication API or MCP server.'
    )
  }

  const authorizationHeader = request.headers.get('authorization') ?? ''
  const bearerToken = authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : ''
  const headerToken = request.headers.get(PUBLICATION_API_HEADER)?.trim() ?? ''
  const token = bearerToken || headerToken

  const isStaticTokenValid = Boolean(token) && configuredTokens.includes(token)
  const signedTokenInspection = token ? inspectPublicationAccessToken(token) : null
  const signedTokenPayload = signedTokenInspection?.ok ? signedTokenInspection.payload : verifyPublicationAccessToken(token)

  if (!isStaticTokenValid && !signedTokenPayload) {
    if (signedTokenInspection && !signedTokenInspection.ok) {
      switch (signedTokenInspection.reason) {
        case 'expired':
          throw new PublicationApiError(401, 'token_expired', 'This publication token has expired.')
        case 'bad_signature':
          throw new PublicationApiError(
            401,
            'token_signature_invalid',
            'This publication token is no longer valid for the current server secret. Reissue the token and update the MCP client.'
          )
        case 'malformed':
          throw new PublicationApiError(401, 'token_malformed', 'This publication token is malformed.')
        default:
          break
      }
    }

    throw new PublicationApiError(401, 'unauthorized', 'A valid publication API token is required.')
  }

  const authContext: PublicationAuthContext = isStaticTokenValid
    ? {
        tokenType: 'static',
        label: 'Static Publication API Token',
        scopes: ['*'],
        enabledSkillIds: [],
      }
    : {
        tokenType: 'signed',
        tokenId: signedTokenPayload?.jti,
        label: signedTokenPayload?.label || 'Signed Publication Token',
        scopes: signedTokenPayload?.scopes || [],
        enabledSkillIds: [],
      }

  if (authContext.tokenType === 'signed') {
    const tokenRecord = await getPublicationTokenInventoryRecord(authContext.tokenId || '')

    if (!tokenRecord) {
      throw new PublicationApiError(401, 'token_not_registered', 'This publication token is not registered.')
    }

    if (tokenRecord.revoked_at) {
      throw new PublicationApiError(401, 'token_revoked', 'This publication token has been revoked.')
    }

    if (new Date(tokenRecord.expires_at).getTime() <= Date.now()) {
      throw new PublicationApiError(401, 'token_expired', 'This publication token has expired.')
    }

    authContext.label = tokenRecord.label
    authContext.scopes = tokenRecord.scopes
    const skillAccess = resolvePublicationAuthSkillAccess({
      tokenType: 'signed',
      tokenRecord,
    })
    authContext.profileId = skillAccess.profileId
    authContext.profileLabel = skillAccess.profileLabel
    authContext.enabledSkillIds = skillAccess.enabledSkillIds
    authContext.adminVisibility = skillAccess.adminVisibility

    await touchPublicationTokenInventoryRecord(tokenRecord.id, new URL(request.url).pathname, request.method)
  } else {
    const skillAccess = resolvePublicationAuthSkillAccess({
      tokenType: 'static',
    })
    authContext.profileId = skillAccess.profileId
    authContext.profileLabel = skillAccess.profileLabel
    authContext.enabledSkillIds = skillAccess.enabledSkillIds
    authContext.adminVisibility = skillAccess.adminVisibility
  }

  if (!hasRequiredScopes(authContext, requiredScopes)) {
    throw new PublicationApiError(
      403,
      'insufficient_scope',
      `This token is missing the required scope${requiredScopes.length === 1 ? '' : 's'}: ${requiredScopes.join(', ')}.`
    )
  }

  return authContext
}

export function serializePublicationArticle(
  article: PublicationArticleRecord,
  options: { includeContent?: boolean } = {}
): PublicationArticleResponse {
  const document = extractPublicationDocument(article.content_markdown, article.title)
  const presentation = getPublicationPresentation(article.title, article.content_markdown, article.created_at)

  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    status: article.status,
    createdAt: article.created_at,
    updatedAt: article.updated_at,
    contentMarkdown: options.includeContent === false ? undefined : article.content_markdown,
    document,
    presentation,
  }
}

export async function listPublicationArticles(options: PublicationListOptions = {}) {
  const articles = await getPublicationPlatform().publicationStore.listArticles({
    status: options.status,
    search: options.search,
    limit: clampLimit(options.limit),
  })

  return articles.map((article) =>
    serializePublicationArticle(article as PublicationArticleRecord, {
      includeContent: options.includeContent,
    })
  )
}

export async function getPublicationArticle(identifier: string, includeContent = true) {
  const article = await findPublicationArticle(identifier)

  return serializePublicationArticle(article, { includeContent })
}

export async function createPublicationArticle(input: PublicationArticleMutationInput, actor?: PublicationAuthContext) {
  const articleTitle = deriveArticleTitle(undefined, input)
  const contentMarkdown = composeMarkdownForMutation(undefined, input, articleTitle)
  const slug = normalizeRequestedSlug(input.slug, articleTitle)
  const now = new Date().toISOString()
  const payload: PublicationArticleRecord = {
    id: crypto.randomUUID(),
    title: articleTitle,
    slug,
    content_markdown: contentMarkdown,
    status: input.status ?? 'draft',
    created_at: now,
    updated_at: now,
  }

  const createdArticle = await getPublicationPlatform().publicationStore.createArticle(payload)

  await createPublicationArticleVersionSnapshot({
    article: createdArticle,
    sourceAction: 'create',
    actor,
  })

  return serializePublicationArticle(createdArticle)
}

export async function updatePublicationArticle(
  identifier: string,
  input: PublicationArticleMutationInput,
  actor?: PublicationAuthContext
) {
  const existingArticle = await findPublicationArticle(identifier)
  const nextTitle = deriveArticleTitle(existingArticle, input)
  const contentMarkdown = composeMarkdownForMutation(existingArticle, input, nextTitle)

  const payload = {
    title: nextTitle,
    slug: normalizeRequestedSlug(input.slug, nextTitle, existingArticle.slug),
    content_markdown: contentMarkdown,
    status: input.status ?? existingArticle.status,
    updated_at: new Date().toISOString(),
  }

  const updatedArticle = await getPublicationPlatform().publicationStore.updateArticle(existingArticle.id, payload)

  await createPublicationArticleVersionSnapshot({
    article: updatedArticle,
    sourceAction: 'update',
    actor,
  })

  return serializePublicationArticle(updatedArticle)
}

export async function publishPublicationArticle(identifier: string, actor?: PublicationAuthContext) {
  const existingArticle = await findPublicationArticle(identifier)
  const existingDocument = extractPublicationDocument(existingArticle.content_markdown, existingArticle.title)
  const nextMetadata = {
    ...existingDocument.metadata,
    published: existingDocument.metadata.published || new Date().toISOString().slice(0, 10),
  }

  return updatePublicationArticle(identifier, {
    status: 'published',
    metadata: nextMetadata,
    body: existingDocument.body,
    customFrontmatter: existingDocument.customFrontmatter,
  }, actor)
}

export async function deletePublicationArticle(identifier: string, actor?: PublicationAuthContext) {
  const existingArticle = await findPublicationArticle(identifier)

  await createPublicationArticleVersionSnapshot({
    article: existingArticle,
    sourceAction: 'delete',
    actor,
  })

  await getPublicationPlatform().publicationStore.deleteArticle(existingArticle.id)

  return {
    deleted: true,
    article: serializePublicationArticle(existingArticle),
  }
}

export async function listPublicationArticleVersions(identifier: string) {
  return listPublicationVersionsFromStore(identifier)
}

export async function restorePublicationArticleVersion(
  articleIdentifier: string,
  versionId: string,
  actor?: PublicationAuthContext
) {
  const result = await restorePublicationVersionFromStore({
    articleIdentifier,
    versionId,
    actor,
  })

  return {
    article: serializePublicationArticle(result.article),
    restoredFromVersion: result.restoredFromVersion,
  }
}

function clampLimit(limit?: number) {
  if (!limit || Number.isNaN(limit)) {
    return 50
  }

  return Math.min(100, Math.max(1, Math.floor(limit)))
}

async function findPublicationArticle(identifier: string) {
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

function deriveArticleTitle(
  existingArticle: PublicationArticleRecord | undefined,
  input: PublicationArticleMutationInput
) {
  const inlineTitle = input.title?.trim()

  if (inlineTitle) {
    return inlineTitle
  }

  if (input.metadata?.title?.trim()) {
    return input.metadata.title.trim()
  }

  if (input.contentMarkdown?.trim()) {
    const document = extractPublicationDocument(input.contentMarkdown, existingArticle?.title ?? '')
    if (document.metadata.title.trim()) {
      return document.metadata.title.trim()
    }
  }

  if (existingArticle?.title?.trim()) {
    return existingArticle.title.trim()
  }

  throw new PublicationApiError(400, 'article_title_missing', 'A title is required to create or update an article.')
}

function composeMarkdownForMutation(
  existingArticle: PublicationArticleRecord | undefined,
  input: PublicationArticleMutationInput,
  title: string
) {
  if (input.contentMarkdown?.trim()) {
    return input.contentMarkdown.trim()
  }

  const existingDocument = existingArticle
    ? extractPublicationDocument(existingArticle.content_markdown, existingArticle.title)
    : {
        metadata: createEmptyPublicationMetadata(title),
        customFrontmatter: {} as PublicationFrontmatter,
        body: '',
      }

  const promotedFrontmatter = input.customFrontmatter
    ? promoteKnownMetadataFromFrontmatter(input.customFrontmatter)
    : { metadata: undefined, customFrontmatter: undefined }

  const mergedMetadata = normalizePublicationMetadata({
    ...existingDocument.metadata,
    ...(promotedFrontmatter.metadata ?? {}),
    ...(input.metadata ?? {}),
    title,
  })

  const mergedBody = input.body ?? existingDocument.body
  const mergedFrontmatter = {
    ...existingDocument.customFrontmatter,
    ...(promotedFrontmatter.customFrontmatter ?? input.customFrontmatter ?? {}),
  }

  return composePublicationMarkdown(mergedMetadata, mergedBody, mergedFrontmatter)
}

function promoteKnownMetadataFromFrontmatter(frontmatter: PublicationFrontmatter) {
  const metadataPatch: Partial<PublicationMetadata> = {}
  const remainingFrontmatter: PublicationFrontmatter = {}
  const extracted = extractPublicationDocument(`---\n${serializeFrontmatter(frontmatter)}\n---`, '')

  for (const [key, value] of Object.entries(extracted.metadata)) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        ;(metadataPatch as Record<string, string | string[]>)[key] = value
      }
    } else if (value.trim()) {
      ;(metadataPatch as Record<string, string | string[]>)[key] = value
    }
  }

  for (const [key, value] of Object.entries(extracted.customFrontmatter)) {
    remainingFrontmatter[key] = value
  }

  return {
    metadata: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
    customFrontmatter: Object.keys(remainingFrontmatter).length > 0 ? remainingFrontmatter : {},
  }
}

function serializeFrontmatter(frontmatter: PublicationFrontmatter) {
  return Object.entries(frontmatter)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((entry) => `  - ${JSON.stringify(entry)}`).join('\n')}`
      }

      return `${key}: ${JSON.stringify(value)}`
    })
    .join('\n')
}

function normalizeRequestedSlug(requestedSlug: string | undefined, title: string, fallbackSlug?: string) {
  const slugSource = requestedSlug?.trim() || fallbackSlug?.trim() || slugifyPublicationTitle(title)

  return slugifyPublicationTitle(slugSource)
}

export function slugifyPublicationTitle(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

  return slug || 'untitled-publication'
}

function hasRequiredScopes(authContext: PublicationAuthContext, requiredScopes: PublicationTokenScope[]) {
  if (requiredScopes.length === 0 || authContext.scopes.includes('*')) {
    return true
  }

  return requiredScopes.every((scope) => authContext.scopes.includes(scope))
}
