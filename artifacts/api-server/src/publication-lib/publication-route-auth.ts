import { createPublicationAdminAuthContext, assertPublicationAdminSession } from './publication-admin.js'
import { assertPublicationApiAuth, type PublicationAuthContext } from './publication-service.js'
import type { PublicationTokenScope } from './publication-tokens.js'

type AnyRequest = Request | { headers: Record<string, string | string[] | undefined>; url: string; method: string }

function getHeaderValue(request: AnyRequest, name: string): string {
  if (typeof (request as any).headers.get === 'function') {
    return (request as Request).headers.get(name) ?? ''
  }
  const val = (request as any).headers[name]
  return Array.isArray(val) ? val[0] ?? '' : val ?? ''
}

export function hasPublicationApiCredentials(request: AnyRequest) {
  return (
    Boolean(getHeaderValue(request, 'authorization')?.trim()) ||
    Boolean(getHeaderValue(request, 'x-publication-token')?.trim())
  )
}

export async function resolvePublicationRouteAuth(
  request: AnyRequest,
  scopes: PublicationTokenScope[],
  purpose: string,
): Promise<PublicationAuthContext> {
  if (hasPublicationApiCredentials(request)) {
    return assertPublicationApiAuth(request as any, scopes)
  }

  const user = await assertPublicationAdminSession(purpose)
  return createPublicationAdminAuthContext(user.email)
}
