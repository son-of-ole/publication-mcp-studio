import { NextRequest, NextResponse } from 'next/server'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import {
  assertPublicationApiAuth,
  buildPublicationCorsHeaders,
  unpublishPublicationArticle,
} from '@/lib/publication-service'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ identifier: string }>
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:publish'])
    const { identifier } = await context.params
    const article = await unpublishPublicationArticle(identifier, auth)

    await recordPublicationAuditEvent({
      action: 'articles.publish',
      auth,
      route: '/api/publications/articles/[identifier]/unpublish',
      method: 'POST',
      article: {
        id: article.id,
        slug: article.slug,
      },
      metadata: {
        status: article.status,
      },
    })

    return NextResponse.json({ article }, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    if (error instanceof PublicationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status, headers: buildPublicationCorsHeaders() }
      )
    }

    const message = error instanceof Error ? error.message : 'Unknown publication API error'
    return NextResponse.json(
      { error: message, code: 'internal_error' },
      { status: 500, headers: buildPublicationCorsHeaders() }
    )
  }
}
