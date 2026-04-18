import { NextRequest, NextResponse } from 'next/server'
import { generatePublicationDraft } from '@/lib/publication-agent'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import {
  assertPublicationApiAuth,
  buildPublicationCorsHeaders,
} from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await assertPublicationApiAuth(request, ['agent:generate'])

    const body = await request.json()
    const draft = await generatePublicationDraft(body)

    await recordPublicationAuditEvent({
      action: 'agent.generate',
      auth,
      route: '/api/publications/agent',
      method: 'POST',
      metadata: {
        model: draft.model,
        title: draft.document.metadata.title,
      },
    })

    return NextResponse.json({ draft }, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationError(error)
  }
}

function handlePublicationError(error: unknown) {
  if (error instanceof PublicationApiError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      {
        status: error.status,
        headers: buildPublicationCorsHeaders(),
      }
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown publication agent error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
