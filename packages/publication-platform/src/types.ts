import type { PublicationTokenScope } from '@publication-platform/token-scopes'

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
  token_type: 'signed'
  scopes: PublicationTokenScope[]
  profile_id: string | null
  profile_label: string | null
  profile_enabled_skill_ids: string[]
  token_enabled_skill_ids: string[] | null
  allow_profile_skill_overrides: boolean
  issued_at: string
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  last_used_route: string | null
  last_used_method: string | null
  created_at: string
  updated_at: string
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
  actor_label: string
  actor_type: string
  scopes: string[]
  route: string
  method: string
  article_id: string | null
  article_slug: string | null
  status: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export type PublicationArticleVersionRecord = {
  id: string
  article_id: string
  version_number: number
  source_action: string
  title: string
  slug: string
  content_markdown: string
  status: PublicationArticleStatus
  actor_label: string | null
  actor_type: string | null
  metadata: Record<string, unknown> | null
  created_at: string
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
  limit?: number
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
  getArticleByIdentifier(identifier: string): Promise<PublicationArticleRecord | null>
  createArticle(input: PublicationArticleRecord): Promise<PublicationArticleRecord>
  updateArticle(id: string, updates: Partial<PublicationArticleRecord>): Promise<PublicationArticleRecord>
  deleteArticle(id: string): Promise<void>
}

export interface PublicationVersionStore {
  createVersion(input: Omit<PublicationArticleVersionRecord, 'id' | 'created_at'>): Promise<PublicationArticleVersionRecord>
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
  recordEvent(input: Omit<PublicationAuditEntry, 'id' | 'created_at'>): Promise<void>
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
}

export type NeonPublicationPlatformOptions = LocalPublicationPlatformOptions & {
  databaseUrl?: string
  mediaStorage?: import('@publication-platform/media-storage').PublicationMediaStorageOptions
}
