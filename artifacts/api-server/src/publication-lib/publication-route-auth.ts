import { createPublicationAdminAuthContext, assertPublicationAdminSession } from './publication-admin.js'
import { assertPublicationApiAuth, type PublicationAuthContext, type PublicationRouteRequest } from './publication-service.js'
import type { PublicationTokenScope } from './publication-tokens.js'

export type { PublicationRouteRequest }

function getHeaderValue(request: PublicationRouteRequest, name: string): string {
  const headers = request.headers as unknown
  if (headers && typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as Headers).get(name) ?? ''
  }
  const val = (headers as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(val) ? val[0] ?? '' : val ?? ''
}

export function hasPublicationApiCredentials(request: PublicationRouteRequest) {
  return (
    Boolean(getHeaderValue(request, 'authorization')?.trim()) ||
    Boolean(getHeaderValue(request, 'x-publication-token')?.trim())
  )
}

export async function resolvePublicationRouteAuth(
  request: PublicationRouteRequest,
  scopes: PublicationTokenScope[],
  purpose: string,
): Promise<PublicationAuthContext> {
  if (hasPublicationApiCredentials(request)) {
    return assertPublicationApiAuth(request, scopes)
  }

  const user = await assertPublicationAdminSession(purpose)
  return createPublicationAdminAuthContext(user.email)
}
