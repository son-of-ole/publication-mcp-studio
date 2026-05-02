import { NextRequest, NextResponse } from 'next/server'
import {
  listPublicationPresets,
  listPublicationVerifiers,
  runPublicationPreset,
  verifyPublicationMarkdown,
} from '@/lib/publication-verifiers'
import { buildPublicationDocumentIR } from '@/lib/publication-document-ir'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { assertPublicationApiAuth, buildPublicationCorsHeaders, getPublicationArticle } from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:read'])

    return NextResponse.json(
      {
        verifiers: listPublicationVerifiers(auth),
        presets: listPublicationPresets(auth),
      },
      { headers: buildPublicationCorsHeaders() }
    )
  } catch (error) {
    return handlePublicationError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:read'])
    const body = await request.json().catch(() => ({}))
    const markdown = await resolveMarkdownForVerification(body)
    const fallbackTitle = typeof body.fallbackTitle === 'string' ? body.fallbackTitle : ''

    const response =
      typeof body.presetId === 'string' && body.presetId.trim()
        ? {
            preset: await runPublicationPreset(markdown, body.presetId.trim(), fallbackTitle, auth),
            ir: buildPublicationDocumentIR(markdown, fallbackTitle),
          }
        : typeof body.verifierId === 'string' && body.verifierId.trim()
          ? {
              result: await verifyPublicationMarkdown(markdown, body.verifierId.trim(), fallbackTitle, auth),
              ir: buildPublicationDocumentIR(markdown, fallbackTitle),
            }
          : (() => {
              throw new PublicationApiError(400, 'verification_target_missing', 'Provide verifierId or presetId when verifying a publication document.')
            })()

    await recordPublicationAuditEvent({
      action: 'articles.read',
      auth,
      route: '/api/publications/verify',
      method: 'POST',
      metadata: {
        verifierId: typeof body.verifierId === 'string' ? body.verifierId : undefined,
        presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
      },
    })

    return NextResponse.json(response, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationError(error)
  }
}

async function resolveMarkdownForVerification(body: Record<string, unknown>) {
  if (typeof body.markdown === 'string' && body.markdown.trim()) {
    return body.markdown
  }

  if (typeof body.identifier === 'string' && body.identifier.trim()) {
    const article = await getPublicationArticle(body.identifier.trim(), true)
    if (!article.contentMarkdown) {
      throw new PublicationApiError(404, 'article_markdown_missing', `No markdown content was found for "${body.identifier.trim()}".`)
    }

    return article.contentMarkdown
  }

  throw new PublicationApiError(400, 'markdown_missing', 'Provide either markdown or an article identifier when verifying.')
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

  const message = error instanceof Error ? error.message : 'Unknown publication verification error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
