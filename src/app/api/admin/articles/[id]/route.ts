import { NextRequest, NextResponse } from 'next/server'
import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { buildPublicationCorsHeaders, updatePublicationArticle } from '@/lib/publication-service'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await assertPublicationAdminSession('update admin articles')
    const { id } = await context.params
    const body = await request.json()
    const auth = createPublicationAdminAuthContext(user.email)
    const article = await updatePublicationArticle(id, body, auth)

    await recordPublicationAuditEvent({
      action: 'articles.update',
      auth,
      route: '/api/admin/articles/[id]',
      method: 'PATCH',
      article: {
        id: article.id,
        slug: article.slug,
      },
      metadata: {
        source: 'admin-editor',
      },
    })

    return NextResponse.json({ article }, { headers: buildPublicationCorsHeaders() })
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
