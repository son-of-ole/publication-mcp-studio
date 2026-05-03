export const PUBLICATION_TOKEN_SCOPES = [
  'mcp:connect',
  'articles:read',
  'articles:write',
  'articles:publish',
  'articles:delete',
  'agent:generate',
  'audit:read',
  'tokens:read',
  'tokens:write',
] as const

export type PublicationTokenScope = (typeof PUBLICATION_TOKEN_SCOPES)[number]
export const PUBLICATION_SCOPES = PUBLICATION_TOKEN_SCOPES
export type PublicationScope = PublicationTokenScope

export const PUBLICATION_MCP_TOOL_SCOPES = {
  list_articles: 'articles:read',
  get_article: 'articles:read',
  get_document_ir: 'articles:read',
  export_document: 'articles:read',
  list_media: 'articles:read',
  list_verifiers: 'articles:read',
  verify_document: 'articles:read',
  run_publication_preset: 'articles:read',
  list_article_versions: 'articles:read',
  list_skills: 'articles:read',
  get_skill: 'articles:read',
  list_enabled_skills: 'articles:read',
  run_skill_workflow: 'articles:read',
  import_document: 'articles:write',
  create_article: 'articles:write',
  update_article: 'articles:write',
  upload_media: 'articles:write',
  restore_article_version: 'articles:write',
  publish_article: 'articles:publish',
  delete_article: 'articles:delete',
  delete_media: 'articles:delete',
  generate_publication_draft: 'agent:generate',
} as const satisfies Record<string, PublicationTokenScope>

export type PublicationMcpToolName = keyof typeof PUBLICATION_MCP_TOOL_SCOPES
