import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { generatePublicationDraft } from '../../../publication-lib/publication-agent.js'
import { recordPublicationAuditEvent } from '../../../publication-lib/publication-audit.js'
import { buildPublicationDocumentIR } from '../../../publication-lib/publication-document-ir.js'
import { PublicationApiError } from '../../../publication-lib/publication-errors.js'
import {
  exportPublicationDocument,
  importPublicationDocument,
} from '../../../publication-lib/publication-import-export.js'
import { deletePublicationMedia, listPublicationMedia, uploadPublicationMedia } from '../../../publication-lib/publication-media.js'
import type { PublicationFrontmatter, PublicationFrontmatterValue, PublicationMetadata } from '../../../publication-lib/publications.js'
import {
  getPublicationPrompt,
  listPublicationPresets,
  listPublicationPrompts,
  listPublicationVerifiers,
  runPublicationPreset,
  verifyPublicationMarkdown,
} from '../../../publication-lib/publication-verifiers.js'
import {
  assertPublicationSkillCapabilityEnabled,
  getPublicationSkill,
  getPublicationSkillToolScope,
  getPublicationSkillWorkflow,
  listEnabledPublicationSkills,
  listPublicationSkills,
} from '../../../publication-lib/publication-skills.js'
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
} from '../../../publication-lib/publication-service.js'
import type { Request, Response } from 'express'

const PUBLICATION_MCP_TOOL_SCOPES: Record<string, string> = {
  list_articles: 'articles:read',
  get_article: 'articles:read',
  get_document_ir: 'articles:read',
  create_article: 'articles:write',
  update_article: 'articles:write',
  publish_article: 'articles:publish',
  delete_article: 'articles:delete',
  import_document: 'articles:write',
  export_document: 'articles:read',
  list_media: 'articles:read',
  upload_media: 'articles:write',
  delete_media: 'articles:write',
  list_skills: 'mcp:connect',
  get_skill: 'mcp:connect',
  list_enabled_skills: 'mcp:connect',
  list_verifiers: 'articles:read',
  verify_document: 'articles:read',
  run_publication_preset: 'articles:read',
  run_skill_workflow: 'articles:read',
  generate_publication_draft: 'agent:generate',
  list_article_versions: 'articles:read',
  restore_article_version: 'articles:write',
}

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_NAME = 'publication-mcp-studio'

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
        offset: {
          type: 'number',
          description: 'Zero-based offset for page-style pagination.',
        },
        cursor: {
          type: 'string',
          description: 'Return articles created before this ISO timestamp cursor.',
        },
        category: {
          type: 'string',
          description: 'Filter by first-class article category.',
        },
        tag: {
          type: 'string',
          description: 'Filter by one first-class article tag.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to articles containing all requested first-class tags.',
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
    name: 'get_document_ir',
    description: 'Build the canonical document IR for an article or raw markdown input.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        markdown: { type: 'string' },
        fallbackTitle: { type: 'string' },
      },
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
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
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
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
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
    name: 'import_document',
    description: 'Import markdown, text, docx, pdf, or latex into the canonical publication markdown model.',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        dataBase64: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['fileName'],
      additionalProperties: false,
    },
  },
  {
    name: 'export_document',
    description: 'Export publication markdown or an existing article into markdown, json, latex, docx, or pdf.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        markdown: { type: 'string' },
        format: {
          type: 'string',
          enum: ['markdown', 'json', 'latex', 'docx', 'pdf'],
        },
        fileName: { type: 'string' },
        fallbackTitle: { type: 'string' },
      },
      required: ['format'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_skills',
    description: 'List installed governed publication skills and their metadata.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_skill',
    description: 'Fetch metadata for a single governed publication skill.',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string' },
      },
      required: ['skillId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_enabled_skills',
    description: 'List the publication skills enabled for the current token or profile.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_verifiers',
    description: 'List built-in publication verifiers and presets for agent workflows.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'verify_document',
    description: 'Run a single verifier such as math sanity, Lean, journal structure, or SEO.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        markdown: { type: 'string' },
        verifierId: { type: 'string' },
        fallbackTitle: { type: 'string' },
      },
      required: ['verifierId'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_publication_preset',
    description: 'Run a preset workflow like journal submission, SEO, or formal math review.',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string' },
        markdown: { type: 'string' },
        presetId: { type: 'string' },
        fallbackTitle: { type: 'string' },
      },
      required: ['presetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_skill_workflow',
    description: 'Run a declared skill workflow and return its static manifest plus transparent results.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        identifier: { type: 'string' },
        markdown: { type: 'string' },
        fallbackTitle: { type: 'string' },
      },
      required: ['workflowId'],
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

const CORS_HEADERS = buildPublicationCorsHeaders()

export async function handleMcpGet(req: Request, res: Response) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v))
  res.json({
    name: 'Publication MCP Studio',
    protocolVersion: MCP_PROTOCOL_VERSION,
    endpoint: '/api/publications/mcp',
    transport: 'streamable-http-compatible JSON-RPC over POST',
    tools: TOOL_DEFINITIONS,
    resources: [
      'publication://authoring-guide',
      'publication://supported-blocks',
      'publication://workflow-guide',
      'publication://verifier-presets',
      'publication://agent-prompts',
      'publication://skills',
      'publication://skills/enabled',
      'publication://skills/{skillId}',
    ],
    prompts: listPublicationPrompts().map((prompt) => prompt.name),
  })
}

export async function handleMcpPost(req: Request, res: Response) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v))
  try {
    const payload = req.body as JsonRpcRequest
    const method = payload.method
    const auth =
      method === 'initialize' || method === 'ping' ||
      method === 'tools/list' || method === 'resources/list' || method === 'resources/read' ||
      method === 'prompts/list' || method === 'prompts/get' || method === 'tools/call'
        ? await assertPublicationApiAuth(req, ['mcp:connect'])
        : await assertPublicationApiAuth(req)

    if (!method) {
      return jsonRpcError(res, payload.id ?? null, -32600, 'Invalid JSON-RPC request.')
    }

    if (method === 'notifications/initialized') {
      return res.status(202).json(null)
    }

    if (method === 'initialize') {
      await recordPublicationAuditEvent({
        action: 'mcp.connect',
        auth,
        route: '/api/publications/mcp',
        method: 'POST',
        metadata: { jsonRpcMethod: 'initialize' },
      })

      return jsonRpcResult(res, payload.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: '1.0.0',
        },
      })
    }

    if (method === 'ping') {
      return jsonRpcResult(res, payload.id ?? null, {})
    }

    if (method === 'tools/list') {
      return jsonRpcResult(res, payload.id ?? null, {
        tools: getVisibleToolDefinitions(auth),
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

      return jsonRpcResult(res, payload.id ?? null, {
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
      return jsonRpcResult(res, payload.id ?? null, {
        resources: getVisibleResources(auth),
      })
    }

    if (method === 'resources/read') {
      const params = payload.params ?? {}
      const uri = typeof params.uri === 'string' ? params.uri : ''
      const resource = await readResource(uri, auth)

      return jsonRpcResult(res, payload.id ?? null, {
        contents: [
          {
            uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        ],
      })
    }

    if (method === 'prompts/list') {
      return jsonRpcResult(res, payload.id ?? null, {
        prompts: listPublicationPrompts(auth),
      })
    }

    if (method === 'prompts/get') {
      const params = payload.params ?? {}
      const name = typeof params.name === 'string' ? params.name : ''
      const args = isRecord(params.arguments) ? params.arguments : {}

      return jsonRpcResult(res, payload.id ?? null, getPublicationPrompt(name, args, auth))
    }

    return jsonRpcError(res, payload.id ?? null, -32601, `Method "${method}" is not supported by this MCP server.`)
  } catch (error) {
    if (error instanceof PublicationApiError) {
      return jsonRpcError(res, null, -32000, error.message, {
        code: error.code,
        details: error.details,
        status: error.status,
      }, error.status)
    }

    const message = error instanceof Error ? error.message : 'Unknown MCP server error'
    return jsonRpcError(res, null, -32000, message, undefined, 500)
  }
}

async function callTool(toolName: string, args: Record<string, unknown>, auth: PublicationAuthContext) {
  switch (toolName) {
    case 'list_articles':
      return listPublicationArticles({
        status:
          args.status === 'draft' || args.status === 'published' || args.status === 'all'
            ? args.status
            : 'all',
        search: typeof args.search === 'string' ? args.search : undefined,
        category: typeof args.category === 'string' ? args.category : undefined,
        tag: typeof args.tag === 'string' ? args.tag : undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        offset: typeof args.offset === 'number' ? args.offset : undefined,
        cursor: typeof args.cursor === 'string' ? args.cursor : undefined,
        includeContent: args.includeContent === true,
      })
    case 'get_article':
      return {
        article: await getPublicationArticle(
          requiredString(args.identifier, 'identifier'),
          args.includeContent !== false
        ),
      }
    case 'get_document_ir': {
      const markdown = await resolveToolMarkdown(args)
      return {
        ir: buildPublicationDocumentIR(markdown, optionalString(args.fallbackTitle) || ''),
      }
    }
    case 'create_article':
      return {
        article: await createPublicationArticle({
          title: optionalString(args.title),
          slug: optionalString(args.slug),
          status: optionalStatus(args.status),
          contentMarkdown: optionalString(args.contentMarkdown),
          body: optionalString(args.body),
          category: optionalNullableString(args.category),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
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
    case 'import_document':
      return {
        importResult: await importPublicationDocument({
          fileName: requiredString(args.fileName, 'fileName'),
          mimeType: optionalString(args.mimeType),
          data: resolveImportData(args),
        }),
      }
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
    case 'export_document': {
      const markdown = await resolveToolMarkdown(args)
      return {
        exportResult: await exportPublicationDocument({
          markdown,
          format: requiredExportFormat(args.format),
          fileName: optionalString(args.fileName),
          fallbackTitle: optionalString(args.fallbackTitle),
        }),
      }
    }
    case 'list_skills':
      return {
        skills: listPublicationSkills({ auth }),
      }
    case 'get_skill':
      return {
        skill: getPublicationSkill(requiredString(args.skillId, 'skillId'), { auth }),
      }
    case 'list_enabled_skills':
      return {
        skills: listEnabledPublicationSkills(auth),
      }
    case 'list_verifiers':
      return {
        verifiers: listPublicationVerifiers(auth),
        presets: listPublicationPresets(auth),
      }
    case 'verify_document': {
      const markdown = await resolveToolMarkdown(args)
      return {
        result: await verifyPublicationMarkdown(
          markdown,
          requiredString(args.verifierId, 'verifierId'),
          optionalString(args.fallbackTitle) || '',
          auth
        ),
        ir: buildPublicationDocumentIR(markdown, optionalString(args.fallbackTitle) || ''),
      }
    }
    case 'run_publication_preset': {
      const markdown = await resolveToolMarkdown(args)
      return {
        preset: await runPublicationPreset(
          markdown,
          requiredString(args.presetId, 'presetId'),
          optionalString(args.fallbackTitle) || '',
          auth
        ),
        ir: buildPublicationDocumentIR(markdown, optionalString(args.fallbackTitle) || ''),
      }
    }
    case 'run_skill_workflow': {
      const workflow = getPublicationSkillWorkflow(requiredString(args.workflowId, 'workflowId'), auth)
      const markdown = await resolveToolMarkdown(args)
      const fallbackTitle = optionalString(args.fallbackTitle) || ''

      return {
        workflow,
        manifest: workflow.manifest,
        prompts: workflow.manifest.promptIds.map((promptId) => ({
          promptId,
          prompt: getPublicationPrompt(promptId, args, auth),
        })),
        resources: workflow.manifest.resourceUris.map((uri: string) => ({ uri })),
        verifierResults: await Promise.all(
          workflow.manifest.verifierIds.map(async (verifierId: string) => ({
            verifierId,
            result: await verifyPublicationMarkdown(markdown, verifierId, fallbackTitle, auth),
          }))
        ),
        presetResults: await Promise.all(
          workflow.manifest.presetIds.map(async (presetId: string) => ({
            presetId,
            result: await runPublicationPreset(markdown, presetId, fallbackTitle, auth),
          }))
        ),
        ir: buildPublicationDocumentIR(markdown, fallbackTitle),
      }
    }
    case 'update_article':
      return {
        article: await updatePublicationArticle(requiredString(args.identifier, 'identifier'), {
          title: optionalString(args.title),
          slug: optionalString(args.slug),
          status: optionalStatus(args.status),
          contentMarkdown: optionalString(args.contentMarkdown),
          body: optionalString(args.body),
          category: optionalNullableString(args.category),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
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

async function readResource(uri: string, auth: PublicationAuthContext) {
  if (uri === 'publication://authoring-guide') {
    return {
      mimeType: 'text/markdown',
      text: await readFile(path.join(process.cwd(), 'docs', 'publications-authoring.md'), 'utf8').catch(() => '# Publication Authoring Guide\n\nSee documentation for more details.'),
    }
  }

  if (uri === 'publication://supported-blocks') {
    return {
      mimeType: 'text/markdown',
      text: [
        '# Supported Publication Blocks',
        '',
        '- Frontmatter fields: `title`, `publicationLabel`, `subtitle`, `abstract`, `authors`, `authorProfiles`, `affiliations`, `tags`, `doi`, `journal`, `repositoryUrl`, `repositoryLabel`, `published`, `revised`, `canonicalUrl`, `heroImage`, `heroVideo`, `heroPoster`, `heroCaption`.',
        '- Author profiles: use one `authorProfiles` entry per author, either as `Name | email=... | orcid=... | social=... | github=... | url=...` or in the same order as `authors` with the name omitted.',
        '- Core scientific blocks: `::figure`, `::video`, `::interactive`, `::download`, `:::note`, `:::result`, `::chart`, `::dataset`, `::notebook`, `::lean`, `::reference`, `::bibliography`.',
        '- Media storage: use `upload_media` to place assets in the publication storage bucket and receive ready-to-paste embed markdown.',
        '- Citations: use `[@citationKey]` inline and add `::reference{...}` entries in the document.',
        '- Math: use inline `$...$` and block `$$...$$` KaTeX syntax.',
        '- Tables: use normal GitHub-flavored markdown tables.',
      ].join('\n'),
    }
  }

  if (uri === 'publication://workflow-guide') {
    return {
      mimeType: 'text/markdown',
      text: await readFile(path.join(process.cwd(), 'docs', 'publications-agent-workflows.md'), 'utf8').catch(() => '# Publication Workflow Guide\n\nSee documentation for more details.'),
    }
  }

  if (uri === 'publication://verifier-presets') {
    return {
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          verifiers: listPublicationVerifiers(auth),
          presets: listPublicationPresets(auth),
        },
        null,
        2
      ),
    }
  }

  if (uri === 'publication://agent-prompts') {
    return {
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          prompts: listPublicationPrompts(auth),
        },
        null,
        2
      ),
    }
  }

  if (uri === 'publication://skills') {
    return {
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          skills: listPublicationSkills({ auth }),
        },
        null,
        2
      ),
    }
  }

  if (uri === 'publication://skills/enabled') {
    return {
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          skills: listEnabledPublicationSkills(auth),
        },
        null,
        2
      ),
    }
  }

  if (uri.startsWith('publication://skills/')) {
    const skillId = decodeURIComponent(uri.slice('publication://skills/'.length))
    assertPublicationSkillCapabilityEnabled(auth, `resource:${uri}`)
    return {
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          skill: getPublicationSkill(skillId, { auth }),
        },
        null,
        2
      ),
    }
  }

  if (uri.startsWith('publication://article/') && uri.endsWith('/document-ir')) {
    const identifier = decodeURIComponent(uri.slice('publication://article/'.length, -'/document-ir'.length))
    const article = await getPublicationArticle(identifier, true)

    return {
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          identifier,
          ir: buildPublicationDocumentIR(article.contentMarkdown || '', article.title),
        },
        null,
        2
      ),
    }
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

function optionalNullableString(value: unknown) {
  if (value === null) {
    return null
  }

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

async function resolveToolMarkdown(args: Record<string, unknown>) {
  const markdown = optionalString(args.markdown)
  if (markdown?.trim()) {
    return markdown
  }

  const identifier = optionalString(args.identifier)
  if (!identifier?.trim()) {
    throw new PublicationApiError(400, 'invalid_arguments', '"markdown" or "identifier" is required.')
  }

  const article = await getPublicationArticle(identifier, true)
  if (!article.contentMarkdown) {
    throw new PublicationApiError(404, 'article_markdown_missing', `No markdown content was found for "${identifier}".`)
  }

  return article.contentMarkdown
}

function resolveImportData(args: Record<string, unknown>) {
  const dataBase64 = optionalString(args.dataBase64)
  const text = optionalString(args.text)

  if (dataBase64?.trim()) {
    const normalizedBase64 = dataBase64.includes(',')
      ? dataBase64.slice(dataBase64.indexOf(',') + 1)
      : dataBase64
    return Buffer.from(normalizedBase64, 'base64')
  }

  if (text !== undefined) {
    return Buffer.from(text, 'utf8')
  }

  throw new PublicationApiError(400, 'invalid_arguments', '"dataBase64" or "text" is required.')
}

function requiredExportFormat(value: unknown) {
  if (value === 'markdown' || value === 'json' || value === 'latex' || value === 'docx' || value === 'pdf') {
    return value
  }

  throw new PublicationApiError(
    400,
    'invalid_arguments',
    '"format" must be one of: markdown, json, latex, docx, pdf.'
  )
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
  const skillToolScope = getPublicationSkillToolScope(toolName)
  if (skillToolScope) {
    return skillToolScope
  }

  return PUBLICATION_MCP_TOOL_SCOPES[toolName as keyof typeof PUBLICATION_MCP_TOOL_SCOPES] ?? null
}

function mapToolNameToAuditAction(toolName: string) {
  switch (toolName) {
    case 'list_skills':
    case 'get_skill':
    case 'list_enabled_skills':
    case 'run_skill_workflow':
      return 'articles.read'
    case 'list_articles':
      return 'articles.list'
    case 'get_article':
      return 'articles.read'
    case 'get_document_ir':
      return 'articles.read'
    case 'import_document':
      return 'articles.create'
    case 'export_document':
      return 'articles.read'
    case 'list_verifiers':
      return 'articles.read'
    case 'verify_document':
      return 'articles.read'
    case 'run_publication_preset':
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

function getVisibleToolDefinitions(auth: PublicationAuthContext) {
  return TOOL_DEFINITIONS.filter((tool) => {
    if (
      tool.name === 'list_verifiers' ||
      tool.name === 'verify_document' ||
      tool.name === 'run_publication_preset' ||
      tool.name === 'run_skill_workflow'
    ) {
      return auth.enabledSkillIds.length > 0
    }

    return true
  })
}

function getVisibleResources(auth: PublicationAuthContext) {
  return [
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
    {
      uri: 'publication://workflow-guide',
      name: 'Publication Workflow Guide',
      description: 'Agent-first workflow guidance for document IR, verifiers, presets, and exports.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'publication://verifier-presets',
      name: 'Publication Verifiers and Presets',
      description: 'JSON reference for verifiers and preset workflow bundles.',
      mimeType: 'application/json',
    },
    {
      uri: 'publication://agent-prompts',
      name: 'Publication Agent Prompts',
      description: 'JSON reference for prompt templates exposed through MCP.',
      mimeType: 'application/json',
    },
    {
      uri: 'publication://skills',
      name: 'Publication Skills',
      description: 'Installed governed publication skills and connector metadata.',
      mimeType: 'application/json',
    },
    {
      uri: 'publication://skills/enabled',
      name: 'Enabled Publication Skills',
      description: 'The governed publication skills enabled for the current token/profile.',
      mimeType: 'application/json',
    },
    ...listEnabledPublicationSkills(auth).map((skill) => ({
      uri: `publication://skills/${skill.id}`,
      name: `${skill.label} Skill`,
      description: skill.description,
      mimeType: 'application/json',
    })),
  ]
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

function jsonRpcResult(res: Response, id: string | number | null, result: unknown) {
  return res.json({
    jsonrpc: '2.0',
    id,
    result,
  })
}

function jsonRpcError(
  res: Response,
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
  httpStatus?: number
) {
  return res.status(httpStatus ?? (code === -32601 || code === -32600 ? 400 : 500)).json({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  })
}
