import { NextRequest, NextResponse } from 'next/server'
import { recordPublicationAuditEvent } from '@/lib/publication-audit'
import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { PublicationApiError } from '@/lib/publication-errors'
import { deletePublicationMedia, listPublicationMedia, uploadPublicationMedia } from '@/lib/publication-media'
import { assertPublicationApiAuth, buildPublicationCorsHeaders, type PublicationAuthContext } from '@/lib/publication-service'

export const runtime = 'nodejs'

export async function OPTIONS() {
  return NextResponse.json({}, { headers: buildPublicationCorsHeaders() })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolvePublicationMediaAuth(request, ['articles:read'], 'browse publication media')
    const searchParams = request.nextUrl.searchParams
    const media = await listPublicationMedia({
      articleIdentifier: searchParams.get('articleIdentifier') ?? undefined,
      articleSlug: searchParams.get('articleSlug') ?? undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    })

    await recordPublicationAuditEvent({
      action: 'media.list',
      auth,
      route: '/api/publications/media',
      method: 'GET',
      metadata: {
        articleSlug: media.articleSlug,
        count: media.assets.length,
      },
    })

    return NextResponse.json(media, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationMediaError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolvePublicationMediaAuth(request, ['articles:write'], 'upload publication media')
    const upload = request.headers.get('content-type')?.includes('multipart/form-data')
      ? await parseMultipartPublicationMediaRequest(request)
      : await parseJsonPublicationMediaRequest(request)

    const result = await uploadPublicationMedia(upload)

    await recordPublicationAuditEvent({
      action: 'media.upload',
      auth,
      route: '/api/publications/media',
      method: 'POST',
      metadata: {
        articleSlug: result.asset.articleSlug,
        path: result.asset.path,
        kind: result.asset.kind,
        contentType: result.asset.contentType,
      },
    })

    return NextResponse.json(result, {
      status: 201,
      headers: buildPublicationCorsHeaders(),
    })
  } catch (error) {
    return handlePublicationMediaError(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await resolvePublicationMediaAuth(request, ['articles:delete'], 'delete publication media')
    const body = await request.json().catch(() => ({}))
    const path = typeof body.path === 'string' ? body.path : ''
    const result = await deletePublicationMedia(path)

    await recordPublicationAuditEvent({
      action: 'media.delete',
      auth,
      route: '/api/publications/media',
      method: 'DELETE',
      metadata: {
        path: result.path,
      },
    })

    return NextResponse.json(result, { headers: buildPublicationCorsHeaders() })
  } catch (error) {
    return handlePublicationMediaError(error)
  }
}

async function resolvePublicationMediaAuth(
  request: NextRequest,
  scopes: Parameters<typeof assertPublicationApiAuth>[1],
  purpose: string,
): Promise<PublicationAuthContext> {
  const hasPublicationToken =
    Boolean(request.headers.get('authorization')?.trim()) ||
    Boolean(request.headers.get('x-publication-token')?.trim())

  if (hasPublicationToken) {
    return assertPublicationApiAuth(request, scopes)
  }

  const user = await assertPublicationAdminSession(purpose)
  return createPublicationAdminAuthContext(user.email)
}

async function parseJsonPublicationMediaRequest(request: NextRequest) {
  const body = await request.json().catch(() => ({}))

  return {
    articleIdentifier: typeof body.articleIdentifier === 'string' ? body.articleIdentifier : undefined,
    articleSlug: typeof body.articleSlug === 'string' ? body.articleSlug : undefined,
    fileName: typeof body.fileName === 'string' ? body.fileName : '',
    contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
    dataBase64: typeof body.dataBase64 === 'string' ? body.dataBase64 : undefined,
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
    altText: typeof body.altText === 'string' ? body.altText : undefined,
    caption: typeof body.caption === 'string' ? body.caption : undefined,
    posterUrl: typeof body.posterUrl === 'string' ? body.posterUrl : undefined,
  }
}

async function parseMultipartPublicationMediaRequest(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    throw new PublicationApiError(400, 'media_file_missing', 'Attach a "file" field when uploading publication media.')
  }

  const arrayBuffer = await file.arrayBuffer()

  return {
    articleIdentifier: stringFromFormData(formData.get('articleIdentifier')),
    articleSlug: stringFromFormData(formData.get('articleSlug')),
    fileName: file.name,
    contentType: file.type || undefined,
    dataBase64: Buffer.from(arrayBuffer).toString('base64'),
    altText: stringFromFormData(formData.get('altText')),
    caption: stringFromFormData(formData.get('caption')),
    posterUrl: stringFromFormData(formData.get('posterUrl')),
  }
}

function stringFromFormData(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function handlePublicationMediaError(error: unknown) {
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
      },
    )
  }

  const message = error instanceof Error ? error.message : 'Unknown publication media error'
  return NextResponse.json(
    { error: message, code: 'internal_error' },
    {
      status: 500,
      headers: buildPublicationCorsHeaders(),
    },
  )
}
