import type {
  PublicationAuthContext,
  PublicationConnectorDefinition,
  PublicationConnectorHealth,
  PublicationSkill,
  PublicationSkillCapability,
  PublicationSkillProfile,
  PublicationSkillWorkflow,
  PublicationTokenInventoryRecord,
} from '@publication-platform/types'
import { PublicationApiError } from './publication-errors'
import type { PublicationTokenScope } from './publication-tokens'

type PublicationSkillAccessResult = {
  profileId: string | null
  profileLabel: string | null
  enabledSkillIds: string[]
  adminVisibility: boolean
}

type PublicationSkillEnablementErrorInput = {
  auth: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>
  skillId: string
  capabilityId: string
}

const GOVERNED_SKILL_VERSION = '1.0.0'

export const PUBLICATION_CORE_CAPABILITIES = [
  'list_articles',
  'get_article',
  'get_document_ir',
  'list_media',
  'upload_media',
  'delete_media',
  'create_article',
  'update_article',
  'publish_article',
  'delete_article',
  'import_document',
  'export_document',
  'generate_publication_draft',
  'list_article_versions',
  'restore_article_version',
  'publication://authoring-guide',
  'publication://supported-blocks',
  'publication://workflow-guide',
  'publication://skills',
  'publication://skills/enabled',
  'list_skills',
  'get_skill',
  'list_enabled_skills',
  'run_skill_workflow',
] as const

const publicationConnectorRegistry: PublicationConnectorDefinition[] = [
  {
    id: 'google_analytics_context',
    label: 'Google Analytics Context',
    description: 'Read-only analytics/search context scaffold for SEO skill workflows.',
    status: 'experimental',
    authType: 'oauth',
    readOnly: true,
  },
  {
    id: 'literature_metadata_context',
    label: 'Literature Metadata Context',
    description: 'Read-only scientific metadata scaffold for literature and journal context.',
    status: 'experimental',
    authType: 'api-key',
    readOnly: true,
  },
]

const publicationSkillRegistry: PublicationSkill[] = [
  {
    id: 'seo',
    label: 'SEO',
    description: 'Search-oriented drafting, review, and metadata guidance for discoverability workflows.',
    owner: 'publication-mcp-studio',
    category: 'marketing',
    status: 'active',
    skillVersion: GOVERNED_SKILL_VERSION,
    requiredScopes: ['articles:read'],
    defaultEnablement: 'off',
    connectorRequirements: ['google_analytics_context'],
    capabilities: [
      {
        capabilityId: 'verifier:seo',
        skillId: 'seo',
        type: 'verifier',
        label: 'SEO Review',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
      {
        capabilityId: 'preset:seo_pass',
        skillId: 'seo',
        type: 'preset',
        label: 'SEO Pass',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
      {
        capabilityId: 'prompt:seo_pass',
        skillId: 'seo',
        type: 'prompt',
        label: 'SEO Prompt Pack',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: false,
      },
      {
        capabilityId: 'resource:publication://skills/seo',
        skillId: 'seo',
        type: 'resource',
        label: 'SEO Skill Resource',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: false,
      },
      {
        capabilityId: 'contextProvider:google_analytics_context',
        skillId: 'seo',
        type: 'contextProvider',
        label: 'Google Analytics Context',
        status: 'experimental',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: false,
      },
      {
        capabilityId: 'workflow:seo_review_workflow',
        skillId: 'seo',
        type: 'workflow',
        label: 'SEO Review Workflow',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
    ],
    workflows: [
      {
        workflowId: 'seo_review_workflow',
        skillId: 'seo',
        label: 'SEO Review Workflow',
        description: 'Thin wrapper around SEO prompts, metadata resources, and the SEO preset.',
        status: 'active',
        workflowVersion: GOVERNED_SKILL_VERSION,
        manifest: {
          promptIds: ['seo_pass'],
          resourceUris: ['publication://workflow-guide', 'publication://skills/seo'],
          verifierIds: ['seo'],
          presetIds: ['seo_pass'],
          contextProviderIds: ['google_analytics_context'],
        },
      },
    ],
  },
  {
    id: 'scientific',
    label: 'Scientific',
    description: 'Scholarly drafting, verification, and journal-oriented publication workflows.',
    owner: 'publication-mcp-studio',
    category: 'research',
    status: 'active',
    skillVersion: GOVERNED_SKILL_VERSION,
    requiredScopes: ['articles:read'],
    defaultEnablement: 'off',
    connectorRequirements: ['literature_metadata_context'],
    capabilities: [
      {
        capabilityId: 'verifier:journal_structure',
        skillId: 'scientific',
        type: 'verifier',
        label: 'Journal Structure',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
      {
        capabilityId: 'verifier:math_sanity',
        skillId: 'scientific',
        type: 'verifier',
        label: 'Math Sanity',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
      {
        capabilityId: 'verifier:lean',
        skillId: 'scientific',
        type: 'verifier',
        label: 'Lean Verification',
        status: 'experimental',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
      {
        capabilityId: 'preset:journal_submission_pass',
        skillId: 'scientific',
        type: 'preset',
        label: 'Journal Submission Pass',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
      {
        capabilityId: 'preset:formal_math_pass',
        skillId: 'scientific',
        type: 'preset',
        label: 'Formal Math Pass',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
      {
        capabilityId: 'prompt:journal_submission_pass',
        skillId: 'scientific',
        type: 'prompt',
        label: 'Journal Submission Prompt Pack',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: false,
      },
      {
        capabilityId: 'prompt:formal_math_pass',
        skillId: 'scientific',
        type: 'prompt',
        label: 'Formal Math Prompt Pack',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: false,
      },
      {
        capabilityId: 'resource:publication://skills/scientific',
        skillId: 'scientific',
        type: 'resource',
        label: 'Scientific Skill Resource',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: false,
      },
      {
        capabilityId: 'contextProvider:literature_metadata_context',
        skillId: 'scientific',
        type: 'contextProvider',
        label: 'Literature Metadata Context',
        status: 'experimental',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: false,
      },
      {
        capabilityId: 'workflow:scientific_review_workflow',
        skillId: 'scientific',
        type: 'workflow',
        label: 'Scientific Review Workflow',
        status: 'active',
        capabilityVersion: GOVERNED_SKILL_VERSION,
        scopes: ['articles:read'],
        isDiscoveryVisible: true,
        isDirectlyInvokable: true,
      },
    ],
    workflows: [
      {
        workflowId: 'scientific_review_workflow',
        skillId: 'scientific',
        label: 'Scientific Review Workflow',
        description: 'Thin wrapper around scientific prompts, verifiers, and journal-oriented presets.',
        status: 'active',
        workflowVersion: GOVERNED_SKILL_VERSION,
        manifest: {
          promptIds: ['journal_submission_pass', 'formal_math_pass'],
          resourceUris: ['publication://workflow-guide', 'publication://skills/scientific'],
          verifierIds: ['journal_structure', 'math_sanity', 'lean'],
          presetIds: ['journal_submission_pass', 'formal_math_pass'],
          contextProviderIds: ['literature_metadata_context'],
        },
      },
    ],
  },
]

const publicationSkillIndex = new Map(publicationSkillRegistry.map((skill) => [skill.id, skill]))
const publicationSkillWorkflowIndex = new Map<string, PublicationSkillWorkflow>()
const publicationCapabilityIndex = new Map<string, PublicationSkillCapability>()

for (const skill of publicationSkillRegistry) {
  for (const capability of skill.capabilities) {
    const existing = publicationCapabilityIndex.get(capability.capabilityId)
    if (existing) {
      throw new Error(
        `Publication skill capability "${capability.capabilityId}" is already owned by "${existing.skillId}".`
      )
    }

    publicationCapabilityIndex.set(capability.capabilityId, capability)
  }

  for (const workflow of skill.workflows) {
    const existing = publicationSkillWorkflowIndex.get(workflow.workflowId)
    if (existing) {
      throw new Error(
        `Publication skill workflow "${workflow.workflowId}" is already owned by "${existing.skillId}".`
      )
    }

    publicationSkillWorkflowIndex.set(workflow.workflowId, workflow)
  }
}

function getInstalledSkillIds() {
  return publicationSkillRegistry
    .filter((skill) => skill.status !== 'disabled')
    .map((skill) => skill.id)
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)]
}

function sanitizeSkillIds(skillIds: string[], options: { includeDisabled?: boolean } = {}) {
  return dedupeStrings(skillIds.filter((skillId) => {
    const skill = publicationSkillIndex.get(skillId)
    if (!skill) {
      return false
    }

    return options.includeDisabled ? true : skill.status !== 'disabled'
  }))
}

function shouldIncludeSkill(
  skill: PublicationSkill,
  options: {
    auth?: Pick<PublicationAuthContext, 'adminVisibility'>
    includeDisabled?: boolean
  } = {}
) {
  if (options.includeDisabled) {
    return true
  }

  if (skill.status !== 'disabled') {
    return true
  }

  return options.auth?.adminVisibility === true
}

function getCallerIdentity(auth: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId'>) {
  if (auth.tokenId) {
    return auth.tokenId
  }

  if (auth.profileId) {
    return auth.profileId
  }

  return auth.label
}

export function listPublicationCoreCapabilities() {
  return [...PUBLICATION_CORE_CAPABILITIES]
}

export function listPublicationConnectors() {
  return publicationConnectorRegistry.map((connector) => ({ ...connector }))
}

export function listPublicationConnectorHealth(): PublicationConnectorHealth[] {
  return publicationConnectorRegistry.map((connector) => {
    if (connector.id === 'google_analytics_context') {
      const configured = Boolean(
        process.env.PUBLICATION_SKILL_GOOGLE_ANALYTICS_PROPERTY_ID?.trim() &&
          process.env.PUBLICATION_SKILL_GOOGLE_ANALYTICS_CREDENTIALS_JSON?.trim()
      )

      return {
        connectorId: connector.id,
        status: configured ? 'configured' : 'unconfigured',
        summary: configured
          ? 'Analytics context credentials are configured.'
          : 'Analytics context is scaffolded but not configured yet.',
        configured,
      }
    }

    if (connector.id === 'literature_metadata_context') {
      const configured = Boolean(process.env.PUBLICATION_SKILL_CROSSREF_MAILTO?.trim())
      return {
        connectorId: connector.id,
        status: configured ? 'configured' : 'unconfigured',
        summary: configured
          ? 'Scientific metadata context is configured for literature lookups.'
          : 'Scientific metadata context is scaffolded but not configured yet.',
        configured,
      }
    }

    return {
      connectorId: connector.id,
      status: 'unconfigured',
      summary: 'Connector scaffold is present but not configured.',
      configured: false,
    }
  })
}

export function listPublicationSkills(options: {
  auth?: Pick<PublicationAuthContext, 'enabledSkillIds' | 'adminVisibility'>
  includeDisabled?: boolean
} = {}) {
  return publicationSkillRegistry
    .filter((skill) => shouldIncludeSkill(skill, options))
    .map((skill) => ({
      ...skill,
      capabilities: skill.capabilities.filter(
        (capability) => options.includeDisabled || capability.status !== 'disabled'
      ),
      enabled: options.auth ? options.auth.enabledSkillIds.includes(skill.id) : undefined,
      connectorHealth: listPublicationConnectorHealth().filter((entry) =>
        skill.connectorRequirements.includes(entry.connectorId)
      ),
    }))
}

export function listEnabledPublicationSkills(auth: Pick<PublicationAuthContext, 'enabledSkillIds' | 'adminVisibility'>) {
  return listPublicationSkills({ auth }).filter((skill) => auth.enabledSkillIds.includes(skill.id))
}

export function getPublicationSkill(
  skillId: string,
  options: {
    auth?: Pick<PublicationAuthContext, 'enabledSkillIds' | 'adminVisibility'>
    includeDisabled?: boolean
  } = {}
) {
  const skill = publicationSkillIndex.get(skillId)
  if (!skill || !shouldIncludeSkill(skill, options)) {
    throw new PublicationApiError(404, 'skill_not_found', `No publication skill found for "${skillId}".`)
  }

  return {
    ...skill,
    enabled: options.auth ? options.auth.enabledSkillIds.includes(skill.id) : undefined,
    connectorHealth: listPublicationConnectorHealth().filter((entry) =>
      skill.connectorRequirements.includes(entry.connectorId)
    ),
  }
}

export function getPublicationSkillWorkflow(
  workflowId: string,
  auth?: Pick<PublicationAuthContext, 'enabledSkillIds' | 'label' | 'tokenId' | 'profileId'>
) {
  const workflow = publicationSkillWorkflowIndex.get(workflowId)
  if (!workflow) {
    throw new PublicationApiError(404, 'skill_workflow_not_found', `No publication skill workflow found for "${workflowId}".`)
  }

  if (auth) {
    assertPublicationSkillCapabilityEnabled(auth, `workflow:${workflowId}`)
  }

  return workflow
}

export function getPublicationSkillCapability(capabilityId: string) {
  return publicationCapabilityIndex.get(capabilityId) ?? null
}

export function getPublicationSkillForCapability(capabilityId: string) {
  const capability = getPublicationSkillCapability(capabilityId)
  return capability ? publicationSkillIndex.get(capability.skillId) ?? null : null
}

export function resolvePublicationAuthSkillAccess(
  input:
    | {
        tokenType: 'static'
      }
    | {
        tokenType: 'signed'
        tokenRecord: PublicationTokenInventoryRecord
      }
): PublicationSkillAccessResult {
  if (input.tokenType === 'static') {
    return {
      profileId: null,
      profileLabel: 'Static Publication Profile',
      enabledSkillIds: getInstalledSkillIds(),
      adminVisibility: true,
    }
  }

  const tokenRecord = input.tokenRecord
  const profileEnabledSkillIds = sanitizeSkillIds(tokenRecord.profile_enabled_skill_ids ?? [])
  const requestedTokenSkillIds =
    tokenRecord.token_enabled_skill_ids === null
      ? null
      : sanitizeSkillIds(tokenRecord.token_enabled_skill_ids)
  const enabledSkillIds =
    requestedTokenSkillIds === null
      ? profileEnabledSkillIds
      : tokenRecord.allow_profile_skill_overrides
        ? requestedTokenSkillIds
        : requestedTokenSkillIds.filter((skillId) => profileEnabledSkillIds.includes(skillId))

  return {
    profileId: tokenRecord.profile_id,
    profileLabel: tokenRecord.profile_label,
    enabledSkillIds,
    adminVisibility: false,
  }
}

export function assertPublicationSkillCapabilityEnabled(
  auth: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>,
  capabilityId: string
) {
  const capability = getPublicationSkillCapability(capabilityId)
  if (!capability) {
    return
  }

  if (auth.enabledSkillIds.includes(capability.skillId)) {
    return
  }

  throw createPublicationSkillNotEnabledError({
    auth,
    skillId: capability.skillId,
    capabilityId,
  })
}

export function createPublicationSkillNotEnabledError(input: PublicationSkillEnablementErrorInput) {
  return new PublicationApiError(
    403,
    'skill_not_enabled',
    `The "${input.skillId}" skill is not enabled for capability "${input.capabilityId}".`,
    {
      error: {
        code: 'skill_not_enabled',
        skillId: input.skillId,
        capabilityId: input.capabilityId,
        callerProfileOrToken: getCallerIdentity(input.auth),
        allowedSkillIds: input.auth.enabledSkillIds,
        remediation: `Enable the "${input.skillId}" skill for this publication token or profile.`,
      },
    }
  )
}

export function createPublicationSkillProfile(input: {
  id?: string
  label: string
  enabledSkillIds: string[]
  allowTokenOverrides?: boolean
}): PublicationSkillProfile {
  return {
    id: input.id?.trim() || slugifyProfileId(input.label),
    label: input.label.trim() || 'Default Publication Profile',
    enabledSkillIds: sanitizeSkillIds(input.enabledSkillIds),
    allowTokenOverrides: input.allowTokenOverrides ?? false,
  }
}

export function getDefaultPublicationSkillProfile(input: {
  enabledSkillIds?: string[]
  label?: string
  allowTokenOverrides?: boolean
} = {}) {
  return createPublicationSkillProfile({
    id: 'default-publication-agent',
    label: input.label || 'Default Publication Agent',
    enabledSkillIds: input.enabledSkillIds ?? [],
    allowTokenOverrides: input.allowTokenOverrides ?? false,
  })
}

function slugifyProfileId(label: string) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'default-publication-agent'
}

export function getPublicationSkillToolScope(toolName: string): PublicationTokenScope | null {
  switch (toolName) {
    case 'list_skills':
    case 'get_skill':
    case 'list_enabled_skills':
    case 'run_skill_workflow':
      return 'articles:read'
    default:
      return null
  }
}
