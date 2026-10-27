import { PublicationApiError } from './errors'
import { createPublicationRevision, preparePublication, publishPublicationRevision } from './lifecycle'
import type { PublicationPlatform, PublicationAuthContext } from './types'
import type { PublicationTokenScope } from './token-scopes'
import { PUBLICATION_ASSET_TOOLS, publicationAssetToolScope } from './assets'

const tools: Record<string, { scope: PublicationTokenScope; description: string; properties: Record<string, unknown>; required?: string[] }> = {
  list_articles: { scope: 'articles:read', description: 'List engine articles, including private drafts.', properties: { status: { type: 'string', enum: ['draft', 'published', 'all'] }, limit: { type: 'integer' }, offset: { type: 'integer' } } },
  get_article: { scope: 'articles:read', description: 'Read an engine article.', properties: { identifier: { type: 'string' } }, required: ['identifier'] },
  create_article: { scope: 'articles:write', description: 'Create a private Markdown draft.', properties: { title: { type: 'string' }, slug: { type: 'string' }, contentMarkdown: { type: 'string' }, body: { type: 'string' }, metadata: { type: 'object' }, category: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['draft', 'published'] } }, required: ['title', 'slug'] },
  update_article: { scope: 'articles:write', description: 'Edit a private draft. Create a revision before editing live content.', properties: { identifier: { type: 'string' }, title: { type: 'string' }, contentMarkdown: { type: 'string' }, body: { type: 'string' }, metadata: { type: 'object' }, category: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['draft', 'published'] } }, required: ['identifier'] },
  publish_article: { scope: 'articles:publish', description: 'Publish an initial draft.', properties: { identifier: { type: 'string' } }, required: ['identifier'] },
  unpublish_article: { scope: 'articles:publish', description: 'Withdraw an article from public delivery.', properties: { identifier: { type: 'string' } }, required: ['identifier'] },
  delete_article: { scope: 'articles:delete', description: 'Delete an article.', properties: { identifier: { type: 'string' } }, required: ['identifier'] },
  create_revision: { scope: 'articles:write', description: 'Fork a live article into a private revision.', properties: { identifier: { type: 'string' } }, required: ['identifier'] },
  prepare_publication: { scope: 'articles:read', description: 'Read the exact draft and review digest.', properties: { identifier: { type: 'string' } }, required: ['identifier'] },
  publish_revision: { scope: 'articles:publish', description: 'Publish the reviewed digest if the live base is unchanged.', properties: { identifier: { type: 'string' }, expectedDigest: { type: 'string' } }, required: ['identifier', 'expectedDigest'] },
}

export async function executePublicationMcp(payload: Record<string, unknown>, options: {
  platform: PublicationPlatform
  authenticate: (scopes: PublicationTokenScope[]) => Promise<PublicationAuthContext>
  rest: (path: string, method: string, body?: unknown) => Promise<Response>
  assets: (name: string, args: Record<string, unknown>, actor: PublicationAuthContext) => Promise<unknown>
}) {
  const auth = await options.authenticate(['mcp:connect'])
  if (payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') throw new PublicationApiError(400, 'invalid_rpc', 'A JSON-RPC 2.0 request is required.')
  const id = payload.id ?? null
  const result = (data: unknown) => Response.json({ jsonrpc: '2.0', id, result: data }, { headers: { 'Cache-Control': 'no-store' } })
  if (payload.method === 'notifications/initialized') return new Response(null, { status: 204 })
  if (payload.method === 'initialize') return result({ protocolVersion: '2025-03-26', serverInfo: { name: 'publication-mcp-studio', version: '0.4.0' }, capabilities: { tools: {} } })
  if (payload.method === 'ping') return result({})
  if (payload.method === 'tools/list') return result({ tools: [...Object.entries(tools).filter(([, tool]) => auth.scopes.includes('*') || auth.scopes.includes(tool.scope)).map(([name, tool]) => ({ name, description: tool.description, inputSchema: { type: 'object', properties: tool.properties, required: tool.required ?? [], additionalProperties: false } })), ...PUBLICATION_ASSET_TOOLS.filter(tool => auth.scopes.includes('*') || auth.scopes.includes(publicationAssetToolScope(tool.name)))] })
  if (payload.method !== 'tools/call') return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, { status: 400 })
  const params = payload.params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const name = params?.name || '', tool = tools[name]
  if (PUBLICATION_ASSET_TOOLS.some(tool => tool.name === name)) {
    const actor = await options.authenticate([publicationAssetToolScope(name)])
    const args = params?.arguments ?? {}
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new PublicationApiError(400, 'invalid_arguments', 'Tool arguments must be an object.')
    const data = await options.assets(name, args, actor)
    return result({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] })
  }
  if (!tool) throw new PublicationApiError(400, 'unknown_tool', 'Unknown publication tool.')
  await options.authenticate([tool.scope])
  const args = params?.arguments ?? {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new PublicationApiError(400, 'invalid_arguments', 'Tool arguments must be an object.')
  for (const key of tool.required ?? []) if (typeof args[key] !== 'string' || !(args[key] as string).trim()) throw new PublicationApiError(400, 'invalid_arguments', `${key} is required.`)
  const identifier = typeof args.identifier === 'string' ? args.identifier : ''
  let data: unknown
  if (name === 'create_revision') data = { article: await createPublicationRevision(options.platform.publicationStore, identifier, auth) }
  else if (name === 'prepare_publication') data = await preparePublication(options.platform.publicationStore, identifier, auth)
  else if (name === 'publish_revision') data = { article: await publishPublicationRevision(options.platform.publicationStore, identifier, String(args.expectedDigest || ''), auth) }
  else {
    let route = '/articles', method = 'GET', body: unknown
    if (name === 'list_articles') { const query = new URLSearchParams(); for (const key of ['status', 'limit', 'offset']) if (args[key] !== undefined) query.set(key, String(args[key])); route += '?' + query }
    else if (name === 'create_article') { method = 'POST'; body = args }
    else {
      route += '/' + encodeURIComponent(identifier)
      if (name === 'update_article') { method = 'PATCH'; body = args }
      if (name === 'delete_article') method = 'DELETE'
      if (name === 'publish_article' || name === 'unpublish_article') { method = 'POST'; route += name === 'publish_article' ? '/publish' : '/unpublish' }
    }
    const response = await options.rest(route, method, body)
    data = await response.json()
    if (!response.ok) return result({ isError: true, content: [{ type: 'text', text: JSON.stringify(data) }] })
  }
  return result({ structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] })
}
