import assert from 'node:assert/strict'
import test from 'node:test'
import { PublicationApiError } from './publication-errors'
import {
  getPublicationSkillWorkflow,
  listPublicationSkills,
  resolvePublicationAuthSkillAccess,
} from './publication-skills'
import type { PublicationTokenInventoryRecord } from '@publication-platform/types'

function createTokenRecord(
  overrides: Partial<PublicationTokenInventoryRecord> = {}
): PublicationTokenInventoryRecord {
  return {
    id: 'token-1',
    label: 'Test Token',
    token_type: 'signed',
    scopes: ['mcp:connect', 'articles:read'],
    profile_id: 'default-publication-agent',
    profile_label: 'Default Publication Agent',
    profile_enabled_skill_ids: [],
    token_enabled_skill_ids: null,
    allow_profile_skill_overrides: false,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    last_used_at: null,
    last_used_route: null,
    last_used_method: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

test('listPublicationSkills returns stable governed skills', () => {
  const skills = listPublicationSkills()
  assert.deepEqual(
    skills.map((skill) => skill.id),
    ['seo', 'scientific']
  )
})

test('resolvePublicationAuthSkillAccess narrows token skills by profile unless override is allowed', () => {
  const narrowed = resolvePublicationAuthSkillAccess({
    tokenType: 'signed',
    tokenRecord: createTokenRecord({
      profile_enabled_skill_ids: ['seo', 'scientific'],
      token_enabled_skill_ids: ['seo'],
      allow_profile_skill_overrides: false,
    }),
  })
  assert.deepEqual(narrowed.enabledSkillIds, ['seo'])

  const blockedElevation = resolvePublicationAuthSkillAccess({
    tokenType: 'signed',
    tokenRecord: createTokenRecord({
      profile_enabled_skill_ids: ['scientific'],
      token_enabled_skill_ids: ['seo'],
      allow_profile_skill_overrides: false,
    }),
  })
  assert.deepEqual(blockedElevation.enabledSkillIds, [])

  const overridden = resolvePublicationAuthSkillAccess({
    tokenType: 'signed',
    tokenRecord: createTokenRecord({
      profile_enabled_skill_ids: ['scientific'],
      token_enabled_skill_ids: ['seo'],
      allow_profile_skill_overrides: true,
    }),
  })
  assert.deepEqual(overridden.enabledSkillIds, ['seo'])
})

test('getPublicationSkillWorkflow enforces enabled-skill access', () => {
  assert.throws(
    () =>
      getPublicationSkillWorkflow('seo_review_workflow', {
        label: 'Token Without Skills',
        tokenId: 'token-1',
        profileId: 'default-publication-agent',
        enabledSkillIds: [],
      }),
    (error: unknown) =>
      error instanceof PublicationApiError &&
      error.code === 'skill_not_enabled' &&
      error.details &&
      typeof error.details === 'object'
  )

  const workflow = getPublicationSkillWorkflow('seo_review_workflow', {
    label: 'SEO Token',
    tokenId: 'token-2',
    profileId: 'default-publication-agent',
    enabledSkillIds: ['seo'],
  })
  assert.equal(workflow.workflowId, 'seo_review_workflow')
  assert.deepEqual(workflow.manifest.presetIds, ['seo_pass'])
})
