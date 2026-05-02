import { NextRequest, NextResponse } from 'next/server'
import { createPublicationAdminAuthContext } from '@/lib/publication-admin'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { getPublicationPlatform } from '@/lib/publication-platform'
import { buildPublicationCorsHeaders } from '@/lib/publication-service'
import {
  createPublicationTokenInventoryRecord,
} from '@/lib/publication-token-registry'
import {
  issuePublicationAccessToken,
  type PublicationTokenScope,
} from '@/lib/publication-tokens'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const platform = getPublicationPlatform()

    if (!platform.adminAuthStore.signInWithPassword) {
      throw new PublicationApiError(
        501,
        'password_auth_unavailable',
        'This publication platform does not implement password admin auth.'
      )
    }

    const user = await platform.adminAuthStore.signInWithPassword({ email, password })
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const scopes: PublicationTokenScope[] = [
      'mcp:connect',
      'articles:read',
      'articles:write',
      'articles:publish',
      'articles:delete',
      'agent:generate',
      'audit:read',
    ]
    const tokenRecord = await createPublicationTokenInventoryRecord({
      label: `Admin token for ${user.email ?? 'Publication admin'}`,
      scopes,
      issuedAt,
      expiresAt,
    })
    const token = issuePublicationAccessToken({
      tokenId: tokenRecord.id,
      label: tokenRecord.label,
      issuedAt: tokenRecord.issued_at,
      expiresAt: tokenRecord.expires_at,
      scopes: tokenRecord.scopes,
    })

    await recordPublicationAuditEvent({
      action: 'tokens.issue',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/admin/login',
      method: 'POST',
      metadata: {
        tokenId: tokenRecord.id,
        label: tokenRecord.label,
      },
    })

    return NextResponse.json(
      {
        ok: true,
        user,
        token,
        tokenRecord,
        restBaseUrl: `${request.nextUrl.origin}/api/publications`,
        mcpEndpoint: `${request.nextUrl.origin}/api/publications/mcp`,
      },
      { status: 201, headers: buildPublicationCorsHeaders() }
    )
  } catch (error) {
    if (error instanceof PublicationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status, headers: buildPublicationCorsHeaders() }
      )
    }

    const message = error instanceof Error ? error.message : 'Publication admin login failed.'
    return NextResponse.json(
      { error: message, code: 'admin_login_failed' },
      { status: 400, headers: buildPublicationCorsHeaders() }
    )
  }
}
