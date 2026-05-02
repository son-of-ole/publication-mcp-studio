import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  PUBLICATION_TOKEN_SCOPES,
  type PublicationTokenScope,
} from '@publication-mcp-studio/platform'
import { PublicationApiError } from './publication-errors.js'
export { PUBLICATION_TOKEN_SCOPES } from '@publication-mcp-studio/platform'
export type { PublicationTokenScope } from '@publication-mcp-studio/platform'

type PublicationTokenPayload = {
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
  | {
      ok: true
      payload: PublicationTokenPayload
      secretIndex: number
    }
  | {
      ok: false
      reason: 'not_publication_token' | 'malformed' | 'bad_signature' | 'expired'
      payload?: PublicationTokenPayload
    }

const TOKEN_PREFIX = 'pubtok_'

export function issuePublicationAccessToken(input: {
  tokenId: string
  label?: string
  issuedAt?: string
  expiresAt?: string
  expiresInDays?: number
  scopes?: PublicationTokenScope[]
}): PublicationIssuedToken {
  const secret = getPublicationTokenSecret()
  const issuedAtSeconds = input.issuedAt ? Math.floor(new Date(input.issuedAt).getTime() / 1000) : Math.floor(Date.now() / 1000)
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
  const signature = signPublicationTokenPayload(encodedPayload, secret)
  const token = `${TOKEN_PREFIX}${encodedPayload}.${signature}`

  return {
    tokenId: payload.jti,
    token,
    label: payload.label,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    scopes: payload.scopes,
  }
}

export function verifyPublicationAccessToken(token: string) {
  const result = inspectPublicationAccessToken(token)

  return result.ok ? result.payload : null
}

export function inspectPublicationAccessToken(token: string): PublicationTokenVerificationResult {
  if (!token.startsWith(TOKEN_PREFIX)) {
    return {
      ok: false,
      reason: 'not_publication_token',
    }
  }

  const rawToken = token.slice(TOKEN_PREFIX.length)
  const [encodedPayload, signature] = rawToken.split('.')

  if (!encodedPayload || !signature) {
    return {
      ok: false,
      reason: 'malformed',
    }
  }

  const payload = parsePublicationTokenPayload(encodedPayload)

  if (!payload || payload.sub !== 'publication-api') {
    return {
      ok: false,
      reason: 'malformed',
    }
  }

  const secrets = getPublicationTokenSecrets()
  const matchingSecretIndex = secrets.findIndex((secret) =>
    safeEqual(signature, signPublicationTokenPayload(encodedPayload, secret))
  )

  if (matchingSecretIndex === -1) {
    return {
      ok: false,
      reason: 'bad_signature',
      payload,
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)

  if (payload.exp <= nowSeconds) {
    return {
      ok: false,
      reason: 'expired',
      payload,
    }
  }

  return {
    ok: true,
    payload,
    secretIndex: matchingSecretIndex,
  }
}

export function hasPublicationTokenSecret() {
  return getPublicationTokenSecrets().length > 0
}

function getPublicationTokenSecret() {
  const [secret] = getPublicationTokenSecrets()

  if (!secret) {
    throw new PublicationApiError(
      500,
      'publication_api_secret_missing',
      'PUBLICATION_API_SECRET must be configured to mint signed publication access tokens.'
    )
  }

  return secret
}

function getPublicationTokenSecrets() {
  const secrets = [
    process.env.PUBLICATION_API_SECRET,
    process.env.PUBLICATION_API_SECRETS,
  ]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  return [...new Set(secrets)]
}

function signPublicationTokenPayload(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function parsePublicationTokenPayload(encodedPayload: string): PublicationTokenPayload | null {
  try {
    const raw = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as Partial<PublicationTokenPayload>

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

    const scopes = normalizeScopes(parsed.scopes)

    return {
      ...parsed,
      scopes,
    } as PublicationTokenPayload
  } catch {
    return null
  }
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function clampExpiryDays(input?: number) {
  if (!input || Number.isNaN(input)) {
    return 30
  }

  return Math.min(365, Math.max(1, Math.floor(input)))
}

function normalizeScopes(input?: unknown): PublicationTokenScope[] {
  const requestedScopes = Array.isArray(input) ? input.filter((value): value is string => typeof value === 'string') : []
  const validScopes = requestedScopes.filter((scope): scope is PublicationTokenScope =>
    (PUBLICATION_TOKEN_SCOPES as readonly string[]).includes(scope)
  )

  if (validScopes.length === 0) {
    return ['mcp:connect', 'articles:read', 'articles:write', 'articles:publish', 'agent:generate']
  }

  return [...new Set(validScopes)]
}
