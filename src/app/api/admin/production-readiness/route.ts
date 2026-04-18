import { NextResponse } from 'next/server'
import { assertPublicationAdminSession } from '@/lib/publication-admin'
import { PublicationApiError } from '@/lib/publication-errors'
import { getProductionReadinessReport } from '@/lib/production-readiness'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await assertPublicationAdminSession('view production readiness')
    const report = await getProductionReadinessReport()
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof PublicationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status }
      )
    }

    const message = error instanceof Error ? error.message : 'Unknown production readiness error'
    return NextResponse.json({ error: message, code: 'internal_error' }, { status: 500 })
  }
}
