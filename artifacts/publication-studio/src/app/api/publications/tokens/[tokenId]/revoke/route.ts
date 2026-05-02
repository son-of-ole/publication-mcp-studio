import { NextRequest, NextResponse } from 'next/server'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { PublicationApiError } from '@/lib/publication-errors'
import { buildPublicationCorsHeaders } from '@/lib/publication-service'
import { revokePublicationTokenInventoryRecord } from '@/lib/publication-token-registry'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ tokenId: string }>
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const user = await assertPublicationAdminSession('revoke publication tokens')
    const { tokenId } = await context.params
    const token = await revokePublicationTokenInventoryRecord(tokenId)

    await recordPublicationAuditEvent({
      action: 'tokens.revoke',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/tokens/[tokenId]/revoke',
      method: 'POST',
      metadata: {
        tokenId: token.id,
        label: token.label,
      },
    })

    return NextResponse.json({ token }, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationTokenError(error)
  }
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
