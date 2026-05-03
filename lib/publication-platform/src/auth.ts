import { createHmac, timingSafeEqual } from 'node:crypto'
import { PublicationApiError } from './errors'
import {
  PUBLICATION_TOKEN_SCOPES,
  type PublicationTokenScope,
} from './token-scopes'
import type {
  PublicationPlatform,
  PublicationRequestAuthResult,
  PublicationTokenInventoryRecord,
} from './types'

const TOKEN_PREFIX = 'pubtok_'

export type PublicationTokenPayload = {
  jti: string
  sub: 'publication-api'
  iat: number
  exp: number
  label: string
  scopes: PublicationTokenScope[]
}

export type PublicationIssuedToken = {
  tokenId: string
  token: string
  expiresAt: string
  issuedAt: string
  label: string
  scopes: PublicationTokenScope[]
}

export type PublicationTokenVerificationResult =
  | { ok: true; payload: PublicationTokenPayload; secretIndex: number }
  | {
      ok: false
      reason: 'not_publication_token' | 'malformed' | 'bad_signature' | 'expired'
      payload?: PublicationTokenPayload
    }

export function issuePublicationToken(input: {
  tokenId: string
  secret: string
  label?: string
  issuedAt?: string
  expiresAt?: string
  expiresInDays?: number
  scopes?: PublicationTokenScope[]
}): PublicationIssuedToken {
  const issuedAtSeconds = input.issuedAt
    ? Math.floor(new Date(input.issuedAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000)
  const expiresAtSeconds = input.expiresAt
    ? Math.floor(new Date(input.expiresAt).getTime() / 1000)
    : issuedAtSeconds + clampExpiryDays(input.expiresInDays) * 24 * 60 * 60
  const payload: PublicationTokenPayload = {
    jti: input.tokenId,
    sub: 'publication-api',
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
    label: (input.label?.trim() || 'External MCP Client').slice(0, 120),
    scopes: normalizeScopes(input.scopes),
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = signPublicationTokenPayload(encodedPayload, input.secret)

  return {
    tokenId: payload.jti,
    token: `${TOKEN_PREFIX}${encodedPayload}.${signature}`,
    label: payload.label,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    scopes: payload.scopes,
  }
}

export function verifyPublicationToken(input: {
  token: string
  secrets: string[]
}): PublicationTokenVerificationResult {
  const token = input.token.trim()
  if (!token.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: 'not_publication_token' }
  }

  const [encodedPayload, signature] = token.slice(TOKEN_PREFIX.length).split('.')
  if (!encodedPayload || !signature) {
    return { ok: false, reason: 'malformed' }
  }

  const payload = parsePublicationTokenPayload(encodedPayload)
  if (!payload) {
    return { ok: false, reason: 'malformed' }
  }

  const matchingSecretIndex = input.secrets.findIndex((secret) =>
    safeEqual(signature, signPublicationTokenPayload(encodedPayload, secret))
  )

  if (matchingSecretIndex === -1) {
    return { ok: false, reason: 'bad_signature', payload }
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired', payload }
  }

  return { ok: true, payload, secretIndex: matchingSecretIndex }
}

export async function authenticatePublicationRequest(input: {
  headers: Headers | Record<string, string | string[] | undefined>
  requiredScopes?: PublicationTokenScope[]
  platform: PublicationPlatform
  secrets?: string[]
  staticTokens?: string[]
  route?: string
  method?: string
}): Promise<PublicationRequestAuthResult> {
  const token = readPublicationToken(input.headers)
  const staticTokens = input.staticTokens ?? []
  const secrets = input.secrets ?? []
  const isStaticTokenValid = Boolean(token && staticTokens.includes(token))
  const verification = token && secrets.length > 0
    ? verifyPublicationToken({ token, secrets })
    : null

  if (!isStaticTokenValid && !verification?.ok) {
    throw tokenError(verification)
  }

  if (isStaticTokenValid) {
    const auth: PublicationRequestAuthResult = {
      tokenType: 'static',
      label: 'Static Publication API Token',
      scopes: ['*'],
      enabledSkillIds: [],
    }
    assertScopes(auth.scopes, input.requiredScopes ?? [])
    return auth
  }

  const payload = verification?.ok ? verification.payload : null
  const tokenRecord = payload
    ? await input.platform.tokenStore.getTokenRecord(payload.jti)
    : null

  if (!tokenRecord) {
    throw new PublicationApiError(401, 'token_not_registered', 'This publication token is not registered.')
  }

  assertTokenRecordUsable(tokenRecord)
  const auth: PublicationRequestAuthResult = {
    tokenType: 'signed',
    tokenId: tokenRecord.id,
    label: tokenRecord.label,
    scopes: tokenRecord.scopes,
    profileId: tokenRecord.profile_id,
    profileLabel: tokenRecord.profile_label,
    enabledSkillIds: resolveEnabledSkillIds(tokenRecord),
    adminVisibility: false,
    tokenRecord,
  }
  assertScopes(auth.scopes, input.requiredScopes ?? [])

  if (input.route && input.method) {
    await input.platform.tokenStore.touchTokenRecord(tokenRecord.id, input.route, input.method)
  }

  return auth
}

export function readPublicationToken(headers: Headers | Record<string, string | string[] | undefined>) {
  const authorization = readHeader(headers, 'authorization')
  const bearer = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  return bearer || readHeader(headers, 'x-publication-token') || ''
}

function readHeader(headers: Headers | Record<string, string | string[] | undefined>, key: string) {
  if (headers instanceof Headers) {
    return headers.get(key)?.trim() ?? ''
  }

  const value = headers[key] ?? headers[key.toLowerCase()]
  return Array.isArray(value) ? value[0]?.trim() ?? '' : value?.trim() ?? ''
}

function assertTokenRecordUsable(tokenRecord: PublicationTokenInventoryRecord) {
  if (tokenRecord.revoked_at) {
    throw new PublicationApiError(401, 'token_revoked', 'This publication token has been revoked.')
  }

  if (new Date(tokenRecord.expires_at).getTime() <= Date.now()) {
    throw new PublicationApiError(401, 'token_expired', 'This publication token has expired.')
  }
}

function assertScopes(scopes: Array<PublicationTokenScope | '*'>, requiredScopes: PublicationTokenScope[]) {
  if (requiredScopes.length === 0 || scopes.includes('*')) {
    return
  }

  const missing = requiredScopes.filter((scope) => !scopes.includes(scope))
  if (missing.length > 0) {
    throw new PublicationApiError(
      403,
      'insufficient_scope',
      `This token is missing the required scope${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`
    )
  }
}

function resolveEnabledSkillIds(tokenRecord: PublicationTokenInventoryRecord) {
  if (tokenRecord.allow_profile_skill_overrides && tokenRecord.token_enabled_skill_ids) {
    return tokenRecord.token_enabled_skill_ids
  }

  if (tokenRecord.token_enabled_skill_ids) {
    const allowed = new Set(tokenRecord.profile_enabled_skill_ids)
    return tokenRecord.token_enabled_skill_ids.filter((skillId) => allowed.has(skillId))
  }

  return tokenRecord.profile_enabled_skill_ids
}

function tokenError(verification: PublicationTokenVerificationResult | null) {
  if (!verification || verification.ok || verification.reason === 'not_publication_token') {
    return new PublicationApiError(401, 'unauthorized', 'A valid publication API token is required.')
  }

  if (verification.reason === 'expired') {
    return new PublicationApiError(401, 'token_expired', 'This publication token has expired.')
  }

  if (verification.reason === 'bad_signature') {
    return new PublicationApiError(401, 'token_signature_invalid', 'This publication token signature is invalid.')
  }

  return new PublicationApiError(401, 'token_malformed', 'This publication token is malformed.')
}

function signPublicationTokenPayload(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function parsePublicationTokenPayload(encodedPayload: string): PublicationTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<PublicationTokenPayload>
    if (
      parsed.sub !== 'publication-api' ||
      typeof parsed.jti !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.label !== 'string' ||
      !Array.isArray(parsed.scopes)
    ) {
      return null
    }

    return { ...parsed, scopes: normalizeScopes(parsed.scopes) } as PublicationTokenPayload
  } catch {
    return null
  }
}

function normalizeScopes(input?: unknown): PublicationTokenScope[] {
  const requested = Array.isArray(input) ? input.filter((value): value is string => typeof value === 'string') : []
  const scopes = requested.filter((scope): scope is PublicationTokenScope =>
    (PUBLICATION_TOKEN_SCOPES as readonly string[]).includes(scope)
  )
  return scopes.length > 0 ? [...new Set(scopes)] : ['mcp:connect', 'articles:read']
}

function clampExpiryDays(input?: number) {
  if (!input || Number.isNaN(input)) {
    return 30
  }

  return Math.min(365, Math.max(1, Math.floor(input)))
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
