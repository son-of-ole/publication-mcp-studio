import { NextRequest, NextResponse } from 'next/server'
import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { PublicationApiError } from '@/lib/publication-errors'
import { buildPublicationCorsHeaders } from '@/lib/publication-service'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import {
  createPublicationTokenInventoryRecord,
  listPublicationTokenInventory,
} from '@/lib/publication-token-registry'
import {
  hasPublicationTokenSecret,
  issuePublicationAccessToken,
  PUBLICATION_TOKEN_SCOPES,
  type PublicationTokenScope,
} from '@/lib/publication-tokens'
import {
  createPublicationSkillProfile,
  listPublicationConnectorHealth,
  listPublicationSkills,
} from '@/lib/publication-skills'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET(request: NextRequest) {
  try {
    const user = await assertPublicationAdminSession('manage publication tokens')
    const tokens = await listPublicationTokenInventory()

    await recordPublicationAuditEvent({
      action: 'audit.read',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/tokens',
      method: 'GET',
      metadata: {
        inventoryCount: tokens.length,
      },
    })

    return NextResponse.json(
      {
        mcpEndpoint: `${request.nextUrl.origin}/api/publications/mcp`,
        restBaseUrl: `${request.nextUrl.origin}/api/publications`,
        docsUrl: `${request.nextUrl.origin}/docs/publications-api-mcp`,
        signedTokensEnabled: hasPublicationTokenSecret(),
        staticTokenConfigured: Boolean(
          process.env.PUBLICATION_API_TOKEN?.trim() || process.env.PUBLICATION_API_TOKENS?.trim()
        ),
        defaultModel: process.env.PUBLICATION_AGENT_MODEL || 'openai/gpt-5-mini',
        availableScopes: PUBLICATION_TOKEN_SCOPES,
        availableSkills: listPublicationSkills({
          auth: { enabledSkillIds: [], adminVisibility: true },
          includeDisabled: true,
        }),
        connectorHealth: listPublicationConnectorHealth(),
        tokens,
      },
      { headers: buildPublicationCorsHeaders() }
    )
  } catch (error) {
    return handlePublicationTokenError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await assertPublicationAdminSession('manage publication tokens')

    const body = await request.json().catch(() => ({}))
    const label = typeof body.label === 'string' ? body.label.trim() : 'External MCP Client'
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((value: unknown): value is PublicationTokenScope => typeof value === 'string')
      : undefined
    const profileEnabledSkillIds = normalizeSkillIds(body.profileEnabledSkillIds)
    const tokenEnabledSkillIds = Array.isArray(body.tokenEnabledSkillIds)
      ? normalizeSkillIds(body.tokenEnabledSkillIds)
      : null
    const allowProfileSkillOverrides = body.allowProfileSkillOverrides === true
    const profile = createPublicationSkillProfile({
      label: typeof body.profileLabel === 'string' ? body.profileLabel : 'Default Publication Agent',
      enabledSkillIds: profileEnabledSkillIds,
      allowTokenOverrides: allowProfileSkillOverrides,
    })
    const issuedAt = new Date().toISOString()
    const expiresInDays = typeof body.expiresInDays === 'number' ? body.expiresInDays : 365
    const expiresAt = new Date(
      Date.now() + Math.min(365, Math.max(1, Math.floor(expiresInDays))) * 24 * 60 * 60 * 1000
    ).toISOString()
    const tokenRecord = await createPublicationTokenInventoryRecord({
      label,
      scopes: scopes && scopes.length > 0 ? scopes : ['mcp:connect', 'articles:read', 'articles:write', 'articles:publish', 'agent:generate'],
      profileId: profile.id,
      profileLabel: profile.label,
      profileEnabledSkillIds: profile.enabledSkillIds,
      tokenEnabledSkillIds,
      allowProfileSkillOverrides,
      issuedAt,
      expiresAt,
    })

    const issued = issuePublicationAccessToken({
      tokenId: tokenRecord.id,
      label: tokenRecord.label,
      issuedAt: tokenRecord.issued_at,
      expiresAt: tokenRecord.expires_at,
      scopes: tokenRecord.scopes,
    })

    await recordPublicationAuditEvent({
      action: 'tokens.issue',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/tokens',
      method: 'POST',
      metadata: {
        tokenId: tokenRecord.id,
        label: tokenRecord.label,
        scopes: tokenRecord.scopes,
        profileId: tokenRecord.profile_id,
        profileLabel: tokenRecord.profile_label,
        profileEnabledSkillIds: tokenRecord.profile_enabled_skill_ids,
        tokenEnabledSkillIds: tokenRecord.token_enabled_skill_ids,
        allowProfileSkillOverrides: tokenRecord.allow_profile_skill_overrides,
      },
    })

    return NextResponse.json(
      {
        token: issued,
        tokenRecord,
        mcpEndpoint: `${request.nextUrl.origin}/api/publications/mcp`,
        restBaseUrl: `${request.nextUrl.origin}/api/publications`,
      },
      {
        status: 201,
        headers: buildPublicationCorsHeaders(),
      }
    )
  } catch (error) {
    return handlePublicationTokenError(error)
  }
}

function normalizeSkillIds(input: unknown) {
  const requested = Array.isArray(input)
    ? input.filter((value): value is string => typeof value === 'string')
    : []
  const availableSkillIds = new Set(
    listPublicationSkills({
      auth: { enabledSkillIds: [], adminVisibility: true },
      includeDisabled: true,
    }).map((skill) => skill.id)
  )

  return [...new Set(requested.filter((skillId) => availableSkillIds.has(skillId)))]
}

function handlePublicationTokenError(error: unknown) {
  if (error instanceof PublicationApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      {
        status: error.status,
        headers: buildPublicationCorsHeaders(),
      }
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown publication token error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
