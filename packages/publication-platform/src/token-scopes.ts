export const PUBLICATION_TOKEN_SCOPES = [
  'mcp:connect',
  'articles:read',
  'articles:write',
  'articles:publish',
  'articles:delete',
  'agent:generate',
  'audit:read',
] as const

export type PublicationTokenScope = (typeof PUBLICATION_TOKEN_SCOPES)[number]
