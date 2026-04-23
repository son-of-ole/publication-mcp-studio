import { NextRequest, NextResponse } from 'next/server'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import {
  assertPublicationApiAuth,
  buildPublicationCorsHeaders,
  deletePublicationArticle,
  getPublicationArticle,
  normalizePublicationArticleMutationInput,
  updatePublicationArticle,
} from '@/lib/publication-service'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ identifier: string }>
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:read'])

    const { identifier } = await context.params
    const includeContent = request.nextUrl.searchParams.get('includeContent') !== 'false'
    const article = await getPublicationArticle(identifier, includeContent)

    await recordPublicationAuditEvent({
      action: 'articles.read',
      auth,
      route: '/api/publications/articles/[identifier]',
      method: 'GET',
      article: {
        id: article.id,
        slug: article.slug,
      },
      metadata: {
        includeContent,
      },
    })

    return NextResponse.json({ article }, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationError(error)
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:write'])

    const { identifier } = await context.params
    const body = await request.json()
    const article = await updatePublicationArticle(identifier, normalizePublicationArticleMutationInput(body), auth)

    await recordPublicationAuditEvent({
      action: 'articles.update',
      auth,
      route: '/api/publications/articles/[identifier]',
      method: 'PATCH',
      article: {
        id: article.id,
        slug: article.slug,
      },
      metadata: {
        status: article.status,
        title: article.title,
      },
    })

    return NextResponse.json({ article }, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationError(error)
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:delete'])

    const { identifier } = await context.params
    const result = await deletePublicationArticle(identifier, auth)

    await recordPublicationAuditEvent({
      action: 'articles.delete',
      auth,
      route: '/api/publications/articles/[identifier]',
      method: 'DELETE',
      article: result.article
        ? {
            id: result.article.id,
            slug: result.article.slug,
          }
        : null,
    })

    return NextResponse.json(result, { headers: buildPublicationCorsHeaders() })
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

  const message = error instanceof Error ? error.message : 'Unknown publication API error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
