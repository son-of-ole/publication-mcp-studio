import {
  composePublicationMarkdown,
  createEmptyPublicationMetadata,
  extractPublicationDocument,
  getPublicationPresentation,
  normalizePublicationMetadata,
  type PublicationFrontmatter,
  type PublicationMetadata,
} from '@/lib/publications'
import { getPublicationServiceClient } from '@/lib/publication-db'
import { PublicationApiError } from '@/lib/publication-errors'
import {
  inspectPublicationAccessToken,
  type PublicationTokenScope,
  verifyPublicationAccessToken,
} from '@/lib/publication-tokens'
import {
  getPublicationTokenInventoryRecord,
  touchPublicationTokenInventoryRecord,
} from '@/lib/publication-token-registry'
import {
  createPublicationArticleVersionSnapshot,
  listPublicationArticleVersions as listPublicationVersionsFromStore,
  restorePublicationArticleVersion as restorePublicationVersionFromStore,
} from '@/lib/publication-versioning'

export type PublicationArticleStatus = 'draft' | 'published'

export type PublicationArticleRecord = {
  id: string
  title: string
  slug: string
  content_markdown: string
  status: PublicationArticleStatus
  created_at: string
  updated_at: string
}

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

export type PublicationListOptions = {
  status?: PublicationArticleStatus | 'all'
  search?: string
  limit?: number
  includeContent?: boolean
}

export type PublicationAuthContext = {
  tokenType: 'static' | 'signed'
  tokenId?: string
  label: string
  scopes: Array<PublicationTokenScope | '*'>
}

const PUBLICATION_API_HEADER = 'x-publication-token'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  const signedTokensEnabled = Boolean(process.env.PUBLICATION_API_SECRET?.trim())

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
      }
    : {
        tokenType: 'signed',
        tokenId: signedTokenPayload?.jti,
        label: signedTokenPayload?.label || 'Signed Publication Token',
        scopes: signedTokenPayload?.scopes || [],
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

    await touchPublicationTokenInventoryRecord(tokenRecord.id, new URL(request.url).pathname, request.method)
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
  const supabase = getPublicationServiceClient()
  const limit = clampLimit(options.limit)

  let query = supabase
    .from('articles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status)
  }

  if (options.search?.trim()) {
    const search = options.search.trim()
    query = query.or(`title.ilike.%${search}%,slug.ilike.%${search}%`)
  }

  const { data, error } = await query

  if (error) {
    throw new PublicationApiError(500, 'articles_list_failed', error.message, error)
  }

  return (data ?? []).map((article) =>
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
  const supabase = getPublicationServiceClient()
  const articleTitle = deriveArticleTitle(undefined, input)
  const contentMarkdown = composeMarkdownForMutation(undefined, input, articleTitle)
  const slug = normalizeRequestedSlug(input.slug, articleTitle)
  const now = new Date().toISOString()

  const payload = {
    title: articleTitle,
    slug,
    content_markdown: contentMarkdown,
    status: input.status ?? 'draft',
    created_at: now,
    updated_at: now,
  }

  const { data, error } = await supabase.from('articles').insert(payload).select('*').single()

  if (error) {
    throw new PublicationApiError(500, 'article_create_failed', error.message, error)
  }

  await createPublicationArticleVersionSnapshot({
    article: data as PublicationArticleRecord,
    sourceAction: 'create',
    actor,
  })

  return serializePublicationArticle(data as PublicationArticleRecord)
}

export async function updatePublicationArticle(
  identifier: string,
  input: PublicationArticleMutationInput,
  actor?: PublicationAuthContext
) {
  const supabase = getPublicationServiceClient()
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

  const { data, error } = await supabase
    .from('articles')
    .update(payload)
    .eq('id', existingArticle.id)
    .select('*')
    .single()

  if (error) {
    throw new PublicationApiError(500, 'article_update_failed', error.message, error)
  }

  await createPublicationArticleVersionSnapshot({
    article: data as PublicationArticleRecord,
    sourceAction: 'update',
    actor,
  })

  return serializePublicationArticle(data as PublicationArticleRecord)
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
  const supabase = getPublicationServiceClient()
  const existingArticle = await findPublicationArticle(identifier)

  await createPublicationArticleVersionSnapshot({
    article: existingArticle,
    sourceAction: 'delete',
    actor,
  })

  const { error } = await supabase.from('articles').delete().eq('id', existingArticle.id)

  if (error) {
    throw new PublicationApiError(500, 'article_delete_failed', error.message, error)
  }

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
