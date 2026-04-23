import { createPublicationAdminAuthContext, assertPublicationAdminSession } from '@/lib/publication-admin'
import { assertPublicationApiAuth, type PublicationAuthContext } from '@/lib/publication-service'
import type { PublicationTokenScope } from '@/lib/publication-tokens'

export function hasPublicationApiCredentials(request: Request) {
  return (
    Boolean(request.headers.get('authorization')?.trim()) ||
    Boolean(request.headers.get('x-publication-token')?.trim())
  )
}

export async function resolvePublicationRouteAuth(
  request: Request,
  scopes: PublicationTokenScope[],
  purpose: string,
): Promise<PublicationAuthContext> {
  if (hasPublicationApiCredentials(request)) {
    return assertPublicationApiAuth(request, scopes)
  }

  const user = await assertPublicationAdminSession(purpose)
  return createPublicationAdminAuthContext(user.email)
}
