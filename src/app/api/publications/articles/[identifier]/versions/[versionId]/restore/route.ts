import { NextRequest, NextResponse } from 'next/server'
import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { buildPublicationCorsHeaders, restorePublicationArticleVersion } from '@/lib/publication-service'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ identifier: string; versionId: string }>
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const user = await assertPublicationAdminSession('restore article versions')
    const { identifier, versionId } = await context.params
    const auth = createPublicationAdminAuthContext(user.email)
    const result = await restorePublicationArticleVersion(identifier, versionId, auth)

    await recordPublicationAuditEvent({
      action: 'versions.restore',
      auth,
      route: '/api/publications/articles/[identifier]/versions/[versionId]/restore',
      method: 'POST',
      article: {
        id: result.article.id,
        slug: result.article.slug,
      },
      metadata: {
        restoredFromVersionId: result.restoredFromVersion.id,
        restoredFromVersionNumber: result.restoredFromVersion.version_number,
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

  const message = error instanceof Error ? error.message : 'Unknown article restore error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
