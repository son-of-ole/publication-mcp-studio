import { NextRequest, NextResponse } from 'next/server'
import { importPublicationDocument } from '@/lib/publication-import-export'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { PublicationApiError } from '@/lib/publication-errors'
import { assertPublicationApiAuth, buildPublicationCorsHeaders } from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await assertPublicationApiAuth(request, ['articles:write'])
    const contentType = request.headers.get('content-type') || ''
    const payload = contentType.includes('multipart/form-data')
      ? await parseMultipartImportRequest(request)
      : await parseJsonImportRequest(request)

    const result = await importPublicationDocument(payload)

    await recordPublicationAuditEvent({
      action: 'articles.create',
      auth,
      route: '/api/publications/import',
      method: 'POST',
      metadata: {
        sourceFormat: result.format,
        fileName: result.fileName,
      },
    })

    return NextResponse.json({ importResult: result }, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationError(error)
  }
}

async function parseMultipartImportRequest(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    throw new PublicationApiError(400, 'file_missing', 'Attach a file when importing a publication document.')
  }

  return {
    fileName: file.name,
    mimeType: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  }
}

async function parseJsonImportRequest(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const fileName = typeof body.fileName === 'string' ? body.fileName : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : undefined
  const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
  const text = typeof body.text === 'string' ? body.text : ''

  if (!fileName.trim()) {
    throw new PublicationApiError(400, 'file_name_missing', 'A fileName is required for JSON document imports.')
  }

  if (!dataBase64.trim() && !text.trim()) {
    throw new PublicationApiError(400, 'file_data_missing', 'Provide either dataBase64 or text for JSON document imports.')
  }

  return {
    fileName,
    mimeType,
    data: dataBase64.trim()
      ? Buffer.from(dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64, 'base64')
      : Buffer.from(text, 'utf8'),
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

  const message = error instanceof Error ? error.message : 'Unknown publication import error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    }
  )
}
