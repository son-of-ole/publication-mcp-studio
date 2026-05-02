import { NextRequest, NextResponse } from 'next/server'
import { exportPublicationDocument } from '@/lib/publication-import-export'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { assertPublicationApiAuth, buildPublicationCorsHeaders, getPublicationArticle } from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:read'])
    const body = await request.json().catch(() => ({}))
    const markdown = await resolveMarkdownForExport(body)
    const format = normalizeExportFormat(body.format)
    const exportResult = await exportPublicationDocument({
      markdown,
      format,
      fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
      fallbackTitle: typeof body.fallbackTitle === 'string' ? body.fallbackTitle : undefined,
    })

    await recordPublicationAuditEvent({
      action: 'articles.read',
      auth,
      route: '/api/publications/export',
      method: 'POST',
      metadata: {
        format,
        fileName: exportResult.fileName,
      },
    })

    return NextResponse.json({ exportResult }, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationError(error)
  }
}

async function resolveMarkdownForExport(body: Record<string, unknown>) {
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

  throw new PublicationApiError(400, 'markdown_missing', 'Provide either markdown or an article identifier when exporting.')
}

function normalizeExportFormat(value: unknown) {
  if (value === 'markdown' || value === 'json' || value === 'latex' || value === 'docx' || value === 'pdf') {
    return value
  }

  throw new PublicationApiError(
    400,
    'invalid_export_format',
    'format must be one of: markdown, json, latex, docx, pdf.'
  )
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

  const message = error instanceof Error ? error.message : 'Unknown publication export error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
