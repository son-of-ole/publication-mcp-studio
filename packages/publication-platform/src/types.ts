import type { PublicationTokenScope } from './token-scopes'

export type PublicationArticleStatus = 'draft' | 'published'

export type PublicationArticleRecord = {
  id: string
  title: string
  slug: string
  contentMarkdown: string
  metadata: Record<string, unknown>
  category: string | null
  tags: string[]
  status: PublicationArticleStatus
  createdAt: string
  updatedAt: string
}

export type PublicationAuthContext = {
  tokenType: 'static' | 'signed'
  tokenId?: string
  label: string
  scopes: Array<PublicationTokenScope | '*'>
  profileId?: string | null
  profileLabel?: string | null
  enabledSkillIds: string[]
  adminVisibility?: boolean
}

export type PublicationSkillStatus = 'experimental' | 'active' | 'deprecated' | 'disabled'

export type PublicationSkillCapabilityType =
  | 'prompt'
  | 'resource'
  | 'verifier'
  | 'preset'
  | 'contextProvider'
  | 'workflow'

export type PublicationConnectorHealthStatus = 'ready' | 'configured' | 'unconfigured' | 'degraded'

export type PublicationConnectorDefinition = {
  id: string
  label: string
  description: string
  status: PublicationSkillStatus
  authType: 'none' | 'api-key' | 'oauth' | 'custom'
  readOnly: boolean
}

export type PublicationConnectorHealth = {
  connectorId: string
  status: PublicationConnectorHealthStatus
  summary: string
  configured: boolean
}

export type PublicationSkillCapability = {
  capabilityId: string
  skillId: string
  type: PublicationSkillCapabilityType
  label: string
  status: PublicationSkillStatus
  capabilityVersion: string
  scopes: PublicationTokenScope[]
  isDiscoveryVisible: boolean
  isDirectlyInvokable: boolean
}

export type PublicationSkillWorkflowManifest = {
  promptIds: string[]
  resourceUris: string[]
  verifierIds: string[]
  presetIds: string[]
  contextProviderIds: string[]
}

export type PublicationSkillWorkflow = {
  workflowId: string
  skillId: string
  label: string
  description: string
  status: PublicationSkillStatus
  workflowVersion: string
  manifest: PublicationSkillWorkflowManifest
}

export type PublicationSkill = {
  id: string
  label: string
  description: string
  owner: string
  category: string
  status: PublicationSkillStatus
  skillVersion: string
  requiredScopes: PublicationTokenScope[]
  defaultEnablement: 'off' | 'read-only'
  connectorRequirements: string[]
  capabilities: PublicationSkillCapability[]
  workflows: PublicationSkillWorkflow[]
}

export type PublicationSkillProfile = {
  id: string
  label: string
  enabledSkillIds: string[]
  allowTokenOverrides: boolean
}

export type PublicationTokenInventoryRecord = {
  id: string
  label: string
  tokenType: 'signed'
  scopes: PublicationTokenScope[]
  profileId: string | null
  profileLabel: string | null
  profileEnabledSkillIds: string[]
  tokenEnabledSkillIds: string[] | null
  allowProfileSkillOverrides: boolean
  issuedAt: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  lastUsedRoute: string | null
  lastUsedMethod: string | null
  createdAt: string
  updatedAt: string
}

export type PublicationAuditAction =
  | 'tokens.issue'
  | 'tokens.revoke'
  | 'media.list'
  | 'media.upload'
  | 'media.delete'
  | 'articles.list'
  | 'articles.read'
  | 'articles.create'
  | 'articles.update'
  | 'articles.publish'
  | 'articles.delete'
  | 'versions.list'
  | 'versions.restore'
  | 'agent.generate'
  | 'mcp.connect'
  | 'audit.read'

export type PublicationAuditEntry = {
  id: string
  action: PublicationAuditAction
  actorLabel: string
  actorType: string
  scopes: string[]
  route: string
  method: string
  articleId: string | null
  articleSlug: string | null
  status: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type PublicationArticleVersionRecord = {
  id: string
  articleId: string
  versionNumber: number
  sourceAction: string
  title: string
  slug: string
  contentMarkdown: string
  status: PublicationArticleStatus
  actorLabel: string | null
  actorType: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type PublicationMediaAsset = {
  bucket: string
  path: string
  publicUrl: string
  fileName: string
  contentType: string
  sizeBytes: number | null
  kind: 'image' | 'video' | 'audio' | 'document' | 'other'
  articleSlug: string
  embedMarkdown: string
  createdAt?: string
  updatedAt?: string
}

export type PublicationAdminUser = {
  id: string
  email: string | null
  mode: 'supabase' | 'local'
}

export type PublicationArticleListOptions = {
  status?: PublicationArticleStatus | 'all'
  search?: string
  category?: string
  tag?: string
  tags?: string[]
  limit?: number
  offset?: number
  cursor?: string
}

export type PublicationMediaUploadPayload = {
  articleSlug: string
  fileName: string
  contentType: string
  data: Uint8Array
  kind: PublicationMediaAsset['kind']
  embedMarkdown: string
}

export interface PublicationStore {
  listArticles(options?: PublicationArticleListOptions): Promise<PublicationArticleRecord[]>
  countArticles?(options?: Omit<PublicationArticleListOptions, 'limit' | 'offset' | 'cursor'>): Promise<number>
  getArticleByIdentifier(identifier: string): Promise<PublicationArticleRecord | null>
  createArticle(input: PublicationArticleRecord): Promise<PublicationArticleRecord>
  updateArticle(id: string, updates: Partial<PublicationArticleRecord>): Promise<PublicationArticleRecord>
  deleteArticle(id: string): Promise<void>
}

export interface PublicationVersionStore {
  createVersion(input: Omit<PublicationArticleVersionRecord, 'id' | 'createdAt'>): Promise<PublicationArticleVersionRecord>
  listVersions(articleId: string): Promise<PublicationArticleVersionRecord[]>
  getVersion(articleId: string, versionId: string): Promise<PublicationArticleVersionRecord | null>
}

export interface TokenStore {
  createTokenRecord(input: {
    label: string
    scopes: PublicationTokenScope[]
    profileId?: string | null
    profileLabel?: string | null
    profileEnabledSkillIds?: string[]
    tokenEnabledSkillIds?: string[] | null
    allowProfileSkillOverrides?: boolean
    issuedAt: string
    expiresAt: string
  }): Promise<PublicationTokenInventoryRecord>
  listTokenRecords(limit?: number): Promise<PublicationTokenInventoryRecord[]>
  getTokenRecord(tokenId: string): Promise<PublicationTokenInventoryRecord | null>
  revokeTokenRecord(tokenId: string): Promise<PublicationTokenInventoryRecord>
  touchTokenRecord(tokenId: string, route: string, method: string): Promise<void>
}

export interface AuditStore {
  recordEvent(input: Omit<PublicationAuditEntry, 'id' | 'createdAt'>): Promise<void>
  listEvents(limit?: number): Promise<PublicationAuditEntry[]>
}

export interface MediaStore {
  uploadMedia(input: PublicationMediaUploadPayload): Promise<PublicationMediaAsset>
  listMedia(articleSlug: string, limit?: number): Promise<PublicationMediaAsset[]>
  deleteMedia(path: string): Promise<void>
}

export interface AdminAuthStore {
  kind: 'supabase' | 'local'
  getCurrentUser(): Promise<PublicationAdminUser | null>
  signOut(): Promise<void>
  signInWithPassword?(input: { email: string; password: string }): Promise<PublicationAdminUser>
}

export interface PublicationPlatform {
  kind: 'supabase' | 'local' | 'neon'
  ensureSchema(): Promise<void>
  publicationStore: PublicationStore
  versionStore: PublicationVersionStore
  tokenStore: TokenStore
  auditStore: AuditStore
  mediaStore: MediaStore
  adminAuthStore: AdminAuthStore
}

export type PublicationPlatformFactory = () => PublicationPlatform

export type PublicationPlatformFactoryRegistry = Record<string, PublicationPlatformFactory>

export type LocalPublicationPlatformOptions = {
  rootDir?: string
  seedDemoContent?: boolean
  adminEmail?: string
  adminPassword?: string
  adminAuthStore?: AdminAuthStore
}

export type SupabasePublicationPlatformOptions = {
  adminAuthStore?: AdminAuthStore
}

export type NeonPublicationPlatformOptions = LocalPublicationPlatformOptions & {
  databaseUrl?: string
  mediaStorage?: import('./media-storage').PublicationMediaStorageOptions
  /**
   * Optional pre-built Neon SQL client. When provided, the platform will use it
   * directly instead of constructing one from `databaseUrl`. Useful for tests
   * (inject a fake) and for consumers that want to share a connection.
   */
  sql?: unknown
}

export type PublicationTokenSecretProvider = {
  secrets: string[]
  staticTokens?: string[]
}

export type PublicationRequestAuthResult = PublicationAuthContext & {
  tokenRecord?: PublicationTokenInventoryRecord
}
