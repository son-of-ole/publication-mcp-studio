import { NextRequest, NextResponse } from 'next/server'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import {
  assertPublicationApiAuth,
  buildPublicationCorsHeaders,
  createPublicationArticle,
  listPublicationArticles,
} from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:read'])

    const searchParams = request.nextUrl.searchParams
    const statusParam = searchParams.get('status')
    const limitParam = searchParams.get('limit')
    const search = searchParams.get('search') ?? undefined
    const includeContent = searchParams.get('includeContent') === 'true'

    const articles = await listPublicationArticles({
      status: statusParam === 'draft' || statusParam === 'published' || statusParam === 'all' ? statusParam : 'all',
      search,
      limit: limitParam ? Number(limitParam) : undefined,
      includeContent,
    })

    await recordPublicationAuditEvent({
      action: 'articles.list',
      auth,
      route: '/api/publications/articles',
      method: 'GET',
      metadata: {
        count: articles.length,
        includeContent,
        status: statusParam || 'all',
      },
    })

    return NextResponse.json(
      {
        articles,
        count: articles.length,
      },
      { headers: buildPublicationCorsHeaders() }
    )
  } catch (error) {
    return handlePublicationError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:write'])

    const body = await request.json()
    const article = await createPublicationArticle(body, auth)

    await recordPublicationAuditEvent({
      action: 'articles.create',
      auth,
      route: '/api/publications/articles',
      method: 'POST',
      article: {
        id: article.id,
        slug: article.slug,
      },
      metadata: {
        status: article.status,
        title: article.title,
      },
    })

    return NextResponse.json({ article }, { status: 201, headers: buildPublicationCorsHeaders() })
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
