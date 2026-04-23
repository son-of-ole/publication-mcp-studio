import { NextRequest, NextResponse } from 'next/server'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { resolvePublicationRouteAuth } from '@/lib/publication-route-auth'
import { listPublicationArticleVersions, buildPublicationCorsHeaders } from '@/lib/publication-service'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ identifier: string }>
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolvePublicationRouteAuth(request, ['articles:read'], 'view article version history')
    const { identifier } = await context.params
    const result = await listPublicationArticleVersions(identifier)

    await recordPublicationAuditEvent({
      action: 'versions.list',
      auth,
      route: '/api/publications/articles/[identifier]/versions',
      method: 'GET',
      article: {
        id: result.article.id,
        slug: result.article.slug,
      },
      metadata: {
        count: result.versions.length,
      },
    })

    return NextResponse.json(result, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationError(error)
  }
}

function handlePublicationError(error: unknown) {
  if (error instanceof PublicationApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      {
        status: error.status,
        headers: buildPublicationCorsHeaders(),
      }
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown article version error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
