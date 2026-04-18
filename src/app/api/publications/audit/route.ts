import { NextRequest, NextResponse } from 'next/server'
import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { PublicationApiError } from '@/lib/publication-errors'
import { listPublicationAuditEvents, recordPublicationAuditEvent } from '@/lib/publication-audit'
import { buildPublicationCorsHeaders } from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET(request: NextRequest) {
  try {
    const user = await assertPublicationAdminSession('view publication audit events')
    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Number(limitParam) : 30
    const events = await listPublicationAuditEvents(limit)

    await recordPublicationAuditEvent({
      action: 'audit.read',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/audit',
      method: 'GET',
      metadata: { limit: Math.min(100, Math.max(1, Math.floor(limit || 30))) },
    })

    return NextResponse.json(
      {
        events,
      },
      { headers: buildPublicationCorsHeaders() }
    )
  } catch (error) {
    return handlePublicationAuditError(error)
  }
}

function handlePublicationAuditError(error: unknown) {
  if (error instanceof PublicationApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      {
        status: error.status,
        headers: buildPublicationCorsHeaders(),
      }
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown publication audit error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
