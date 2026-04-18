import { NextRequest, NextResponse } from 'next/server'
import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { buildPublicationCorsHeaders, createPublicationArticle } from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const user = await assertPublicationAdminSession('create admin articles')
    const body = await request.json()
    const auth = createPublicationAdminAuthContext(user.email)
    const article = await createPublicationArticle(body, auth)

    await recordPublicationAuditEvent({
      action: 'articles.create',
      auth,
      route: '/api/admin/articles',
      method: 'POST',
      article: {
        id: article.id,
        slug: article.slug,
      },
      metadata: {
        source: 'admin-editor',
      },
    })

    return NextResponse.json({ article }, { status: 201, headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handleAdminArticleError(error)
  }
}

function handleAdminArticleError(error: unknown) {
  if (error instanceof PublicationApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status, headers: buildPublicationCorsHeaders() }
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown admin article error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    { status: 500, headers: buildPublicationCorsHeaders() }
  )
}
