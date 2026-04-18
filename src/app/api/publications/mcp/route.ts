import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { generatePublicationDraft } from '@/lib/publication-agent'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { deletePublicationMedia, listPublicationMedia, uploadPublicationMedia } from '@/lib/publication-media'
import type { PublicationFrontmatter, PublicationFrontmatterValue, PublicationMetadata } from '@/lib/publications'
import {
  type PublicationAuthContext,
  assertPublicationApiAuth,
  buildPublicationCorsHeaders,
  createPublicationArticle,
  deletePublicationArticle,
  getPublicationArticle,
  listPublicationArticles,
  listPublicationArticleVersions,
  publishPublicationArticle,
  restorePublicationArticleVersion,
  updatePublicationArticle,
} from '@/lib/publication-service'

export const runtime = 'nodejs'

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_NAME = 'ai-psychometrics-publications'

export const TOOL_DEFINITIONS = [
  {
    name: 'list_articles',
    description: 'List publication articles from the publication article store.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['draft', 'published', 'all'],
          description: 'Filter the list by article status.',
        },
        search: {
          type: 'string',
          description: 'Optional title or slug search query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of articles to return.',
        },
        includeContent: {
          type: 'boolean',
          description: 'Include raw markdown in the response.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_article',
    description: 'Fetch a single article by slug or UUID, including its markdown and parsed publication document.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: 'The article slug or UUID.',
        },
        includeContent: {
          type: 'boolean',
          description: 'Include raw markdown in the response.',
        },
      },
      required: ['identifier'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_media',
    description: 'List uploaded publication media for an article slug/UUID or a draft slug workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        articleIdentifier: { type: 'string' },
        articleSlug: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'upload_media',
    description: 'Upload image, video, audio, or document assets into publication storage and receive a ready embed snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        articleIdentifier: { type: 'string' },
        articleSlug: { type: 'string' },
        fileName: { type: 'string' },
        contentType: { type: 'string' },
        dataBase64: { type: 'string' },
        sourceUrl: { type: 'string' },
        altText: { type: 'string' },
        caption: { type: 'string' },
        posterUrl: { type: 'string' },
      },
      required: ['fileName'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_media',
    description: 'Delete a previously uploaded publication media asset by storage path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_article',
    description: 'Create a new publication article draft or published entry.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        slug: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'published'],
        },
        contentMarkdown: { type: 'string' },
        body: { type: 'string' },
        metadata: { type: 'object' },
        customFrontmatter: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_article',
    description: 'Update an existing publication article by slug or UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        title: { type: 'string' },
        slug: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'published'],
        },
        contentMarkdown: { type: 'string' },
        body: { type: 'string' },
        metadata: { type: 'object' },
        customFrontmatter: { type: 'object' },
      },
      required: ['identifier'],
      additionalProperties: false,
    },
  },
  {
    name: 'publish_article',
    description: 'Publish an article and ensure it has a publication date in frontmatter.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
      },
      required: ['identifier'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_article',
    description: 'Delete an article by slug or UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
      },
      required: ['identifier'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_publication_draft',
    description:
      'Use the publication agent to draft or revise markdown that matches the publication renderer and block system.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string' },
        currentMarkdown: { type: 'string' },
        articleTitle: { type: 'string' },
        model: { type: 'string' },
        temperature: { type: 'number' },
        metadata: { type: 'object' },
        body: { type: 'string' },
        customFrontmatter: { type: 'object' },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_article_versions',
    description: 'List stored article versions for a publication by slug or UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
      },
      required: ['identifier'],
      additionalProperties: false,
    },
  },
  {
    name: 'restore_article_version',
    description: 'Restore an article to a previously captured version snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        versionId: { type: 'string' },
      },
      required: ['identifier', 'versionId'],
      additionalProperties: false,
    },
  },
] as const

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET() {
  return NextResponse.json(
    {
      name: 'Publication MCP Studio',
      protocolVersion: MCP_PROTOCOL_VERSION,
      endpoint: '/api/publications/mcp',
      transport: 'streamable-http-compatible JSON-RPC over POST',
      tools: TOOL_DEFINITIONS,
      resources: [
        'publication://authoring-guide',
        'publication://supported-blocks',
      ],
    },
    { headers: buildPublicationCorsHeaders() }
  )
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as JsonRpcRequest
    const method = payload.method
    const auth =
      method === 'initialize' || method === 'ping'
        ? await assertPublicationApiAuth(request, ['mcp:connect'])
        : method === 'tools/list' || method === 'resources/list' || method === 'resources/read'
          ? await assertPublicationApiAuth(request, ['mcp:connect'])
          : method === 'tools/call'
            ? await assertPublicationApiAuth(request, ['mcp:connect'])
            : await assertPublicationApiAuth(request)

    if (!method) {
      return jsonRpcError(payload.id ?? null, -32600, 'Invalid JSON-RPC request.')
    }

    if (method === 'notifications/initialized') {
      return new NextResponse(null, {
        status: 202,
        headers: buildPublicationCorsHeaders(),
      })
    }

    if (method === 'initialize') {
      await recordPublicationAuditEvent({
        action: 'mcp.connect',
        auth,
        route: '/api/publications/mcp',
        method: 'POST',
        metadata: { jsonRpcMethod: 'initialize' },
      })

      return jsonRpcResult(payload.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: '1.0.0',
        },
      })
    }

    if (method === 'ping') {
      return jsonRpcResult(payload.id ?? null, {})
    }

    if (method === 'tools/list') {
      return jsonRpcResult(payload.id ?? null, {
        tools: TOOL_DEFINITIONS,
      })
    }

    if (method === 'tools/call') {
      const params = payload.params ?? {}
      const toolName = typeof params.name === 'string' ? params.name : ''
      const args = isRecord(params.arguments) ? params.arguments : {}
      assertToolScope(toolName, auth)
      const structuredContent = await callTool(toolName, args, auth)

      await recordPublicationAuditEvent({
        action: mapToolNameToAuditAction(toolName),
        auth,
        route: '/api/publications/mcp',
        method: 'POST',
        metadata: {
          jsonRpcMethod: 'tools/call',
          toolName,
        },
      })

      return jsonRpcResult(payload.id ?? null, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      })
    }

    if (method === 'resources/list') {
      return jsonRpcResult(payload.id ?? null, {
        resources: [
          {
            uri: 'publication://authoring-guide',
            name: 'Publication Authoring Guide',
            description: 'Markdown and directive guide for publication system authoring.',
            mimeType: 'text/markdown',
          },
          {
            uri: 'publication://supported-blocks',
            name: 'Supported Publication Blocks',
            description: 'Quick reference for block directives and metadata fields supported by the renderer.',
            mimeType: 'text/markdown',
          },
        ],
      })
    }

    if (method === 'resources/read') {
      const params = payload.params ?? {}
      const uri = typeof params.uri === 'string' ? params.uri : ''
      const resource = await readResource(uri)

      return jsonRpcResult(payload.id ?? null, {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: resource,
          },
        ],
      })
    }

    return jsonRpcError(payload.id ?? null, -32601, `Method "${method}" is not supported by this MCP server.`)
  } catch (error) {
    if (error instanceof PublicationApiError) {
      return jsonRpcError(null, -32000, error.message, {
        code: error.code,
        details: error.details,
        status: error.status,
      }, error.status)
    }

    const message = error instanceof Error ? error.message : 'Unknown MCP server error'
    return jsonRpcError(null, -32000, message, undefined, 500)
  }
}

async function callTool(toolName: string, args: Record<string, unknown>, auth: PublicationAuthContext) {
  switch (toolName) {
    case 'list_articles':
      return {
        articles: await listPublicationArticles({
          status:
            args.status === 'draft' || args.status === 'published' || args.status === 'all'
              ? args.status
              : 'all',
          search: typeof args.search === 'string' ? args.search : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          includeContent: args.includeContent === true,
        }),
      }
    case 'get_article':
      return {
        article: await getPublicationArticle(
          requiredString(args.identifier, 'identifier'),
          args.includeContent !== false
        ),
      }
    case 'create_article':
      return {
        article: await createPublicationArticle({
          title: optionalString(args.title),
          slug: optionalString(args.slug),
          status: optionalStatus(args.status),
          contentMarkdown: optionalString(args.contentMarkdown),
          body: optionalString(args.body),
          metadata: optionalMetadata(args.metadata),
          customFrontmatter: optionalFrontmatter(args.customFrontmatter),
        }, auth),
      }
    case 'list_media':
      return await listPublicationMedia({
        articleIdentifier: optionalString(args.articleIdentifier),
        articleSlug: optionalString(args.articleSlug),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      })
    case 'upload_media':
      return await uploadPublicationMedia({
        articleIdentifier: optionalString(args.articleIdentifier),
        articleSlug: optionalString(args.articleSlug),
        fileName: requiredString(args.fileName, 'fileName'),
        contentType: optionalString(args.contentType),
        dataBase64: optionalString(args.dataBase64),
        sourceUrl: optionalString(args.sourceUrl),
        altText: optionalString(args.altText),
        caption: optionalString(args.caption),
        posterUrl: optionalString(args.posterUrl),
      })
    case 'delete_media':
      return await deletePublicationMedia(requiredString(args.path, 'path'))
    case 'update_article':
      return {
        article: await updatePublicationArticle(requiredString(args.identifier, 'identifier'), {
          title: optionalString(args.title),
          slug: optionalString(args.slug),
          status: optionalStatus(args.status),
          contentMarkdown: optionalString(args.contentMarkdown),
          body: optionalString(args.body),
          metadata: optionalMetadata(args.metadata),
          customFrontmatter: optionalFrontmatter(args.customFrontmatter),
        }, auth),
      }
    case 'publish_article':
      return {
        article: await publishPublicationArticle(requiredString(args.identifier, 'identifier'), auth),
      }
    case 'delete_article':
      return await deletePublicationArticle(requiredString(args.identifier, 'identifier'), auth)
    case 'generate_publication_draft':
      return {
        draft: await generatePublicationDraft({
          instruction: requiredString(args.instruction, 'instruction'),
          currentMarkdown: optionalString(args.currentMarkdown),
          articleTitle: optionalString(args.articleTitle),
          model: optionalString(args.model),
          temperature: typeof args.temperature === 'number' ? args.temperature : undefined,
          metadata: optionalMetadata(args.metadata),
          body: optionalString(args.body),
          customFrontmatter: optionalFrontmatter(args.customFrontmatter),
        }),
      }
    case 'list_article_versions':
      return await listPublicationArticleVersions(requiredString(args.identifier, 'identifier'))
    case 'restore_article_version':
      return await restorePublicationArticleVersion(
        requiredString(args.identifier, 'identifier'),
        requiredString(args.versionId, 'versionId'),
        auth
      )
    default:
      throw new PublicationApiError(404, 'tool_not_found', `Tool "${toolName}" is not available.`)
  }
}

async function readResource(uri: string) {
  if (uri === 'publication://authoring-guide') {
    return readFile(path.join(process.cwd(), 'docs', 'publications-authoring.md'), 'utf8')
  }

  if (uri === 'publication://supported-blocks') {
    return [
      '# Supported Publication Blocks',
      '',
      '- Frontmatter fields: `title`, `publicationLabel`, `subtitle`, `abstract`, `authors`, `authorProfiles`, `affiliations`, `tags`, `doi`, `journal`, `repositoryUrl`, `repositoryLabel`, `published`, `revised`, `canonicalUrl`, `heroImage`, `heroVideo`, `heroPoster`, `heroCaption`.',
      '- Author profiles: use one `authorProfiles` entry per author, either as `Name | email=... | orcid=... | social=... | github=... | url=...` or in the same order as `authors` with the name omitted.',
      '- Core scientific blocks: `::figure`, `::video`, `::interactive`, `::download`, `:::note`, `:::result`, `::chart`, `::dataset`, `::notebook`, `::lean`, `::reference`, `::bibliography`.',
      '- Media storage: use `upload_media` to place assets in the publication storage bucket and receive ready-to-paste embed markdown.',
      '- Citations: use `[@citationKey]` inline and add `::reference{...}` entries in the document.',
      '- Math: use inline `$...$` and block `$$...$$` KaTeX syntax.',
      '- Tables: use normal GitHub-flavored markdown tables.',
    ].join('\n')
  }

  throw new PublicationApiError(404, 'resource_not_found', `Resource "${uri}" is not available.`)
}

function requiredString(value: unknown, fieldName: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  throw new PublicationApiError(400, 'invalid_arguments', `"${fieldName}" is required.`)
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function optionalStatus(value: unknown) {
  return value === 'draft' || value === 'published' ? value : undefined
}

function optionalMetadata(value: unknown): Partial<PublicationMetadata> | undefined {
  return isRecord(value) ? (value as Partial<PublicationMetadata>) : undefined
}

function optionalFrontmatter(value: unknown): PublicationFrontmatter | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const frontmatter: PublicationFrontmatter = {}

  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedValue = normalizeFrontmatterValue(entryValue)

    if (normalizedValue !== undefined) {
      frontmatter[key] = normalizedValue
    }
  }

  return frontmatter
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertToolScope(toolName: string, auth: { scopes: string[] }) {
  if (auth.scopes.includes('*')) {
    return
  }

  const requiredScope = getToolScope(toolName)

  if (!requiredScope || auth.scopes.includes(requiredScope)) {
    return
  }

  throw new PublicationApiError(
    403,
    'insufficient_scope',
    `The tool "${toolName}" requires the "${requiredScope}" scope.`
  )
}

function getToolScope(toolName: string) {
  switch (toolName) {
    case 'list_articles':
    case 'get_article':
      return 'articles:read'
    case 'create_article':
    case 'update_article':
    case 'upload_media':
      return 'articles:write'
    case 'publish_article':
      return 'articles:publish'
    case 'delete_article':
    case 'delete_media':
      return 'articles:delete'
    case 'list_media':
      return 'articles:read'
    case 'generate_publication_draft':
      return 'agent:generate'
    case 'list_article_versions':
      return 'articles:read'
    case 'restore_article_version':
      return 'articles:write'
    default:
      return null
  }
}

function mapToolNameToAuditAction(toolName: string) {
  switch (toolName) {
    case 'list_articles':
      return 'articles.list'
    case 'get_article':
      return 'articles.read'
    case 'create_article':
      return 'articles.create'
    case 'update_article':
      return 'articles.update'
    case 'list_media':
      return 'media.list'
    case 'upload_media':
      return 'media.upload'
    case 'delete_media':
      return 'media.delete'
    case 'publish_article':
      return 'articles.publish'
    case 'delete_article':
      return 'articles.delete'
    case 'generate_publication_draft':
      return 'agent.generate'
    case 'list_article_versions':
      return 'versions.list'
    case 'restore_article_version':
      return 'versions.restore'
    default:
      return 'mcp.connect'
  }
}

function normalizeFrontmatterValue(value: unknown): PublicationFrontmatterValue | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    const normalizedList = value.filter((entry): entry is string => typeof entry === 'string')
    return normalizedList.length > 0 ? normalizedList : undefined
  }

  return undefined
}

function jsonRpcResult(id: string | number | null, result: unknown) {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id,
      result,
    },
    {
      headers: buildPublicationCorsHeaders(),
    }
  )
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
  httpStatus?: number
) {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    },
    {
      status: httpStatus ?? (code === -32601 || code === -32600 ? 400 : 500),
      headers: buildPublicationCorsHeaders(),
    }
  )
}
