import type { RequestHandler, ErrorRequestHandler } from 'express'

/** Bounded process-local limiter. Reverse proxies must add shared fleet limits. */
export function createEngineSecurity({ now = Date.now, windowMs = 60_000, max = 600, loginMax = 10 } = {}): RequestHandler {
  const clients = new Map<string, { reset: number; count: number; loginCount: number }>()
  return (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" })
    const origin = req.get('origin')
    const allowed = [process.env.PUBLICATION_ENGINE_ORIGIN, process.env.PUBLICATION_ADMIN_ORIGIN].filter(Boolean)
    if (origin && !allowed.includes(origin) && !(process.env.NODE_ENV !== 'production' && origin === `${req.protocol}://${req.get('host')}`)) { res.status(403).json({ error: 'Origin is not allowed', code: 'origin_forbidden' }); return }
    const key = req.socket.remoteAddress || 'unknown', time = now()
    let bucket = clients.get(key)
    if (!bucket || bucket.reset <= time) {
      if (clients.size >= 5000) for (const [id, value] of clients) if (value.reset <= time) clients.delete(id)
      if (clients.size >= 5000 && !clients.has(key)) { res.set('Retry-After', '60').status(429).end(); return }
      bucket = { reset: time + windowMs, count: 0, loginCount: 0 }; clients.set(key, bucket)
    }
    bucket.count++
    if (/\/(?:local-login|admin\/login)$/.test(req.path)) bucket.loginCount++
    if (bucket.count > max || bucket.loginCount > loginMax) { res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - time) / 1000)))).status(429).json({ error: 'Too many requests', code: 'rate_limited' }); return }
    next()
  }
}

export const engineErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const tooLarge = error?.type === 'entity.too.large' || error?.code?.startsWith('LIMIT_')
  res.status(tooLarge ? 413 : error?.type === 'entity.parse.failed' ? 400 : 500).json({ error: tooLarge ? 'Payload too large' : 'Request could not be processed', code: tooLarge ? 'payload_too_large' : 'invalid_request' })
}

export function validateProductionEngine(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'production') return
  let origin: URL
  try { origin = new URL(env.PUBLICATION_ENGINE_ORIGIN || '') } catch { throw new Error('Production requires an HTTPS PUBLICATION_ENGINE_ORIGIN.') }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Production requires a bare HTTPS PUBLICATION_ENGINE_ORIGIN.')
  if (env.PUBLICATION_ADMIN_ORIGIN && env.PUBLICATION_ADMIN_ORIGIN !== origin.origin) throw new Error('PUBLICATION_ADMIN_ORIGIN must match the secured engine origin.')
  if (!env.PUBLICATION_API_SECRET || env.PUBLICATION_API_SECRET.length < 32) throw new Error('Production requires a signing secret of at least 32 characters.')
  if (env.PUBLICATION_API_TOKEN || env.PUBLICATION_API_TOKENS) throw new Error('Production requires scoped registered tokens; static wildcard tokens are disabled.')
  if ((env.PUBLICATION_PLATFORM_ADAPTER || 'local') === 'local' && env.PUBLICATION_ALLOW_LOCAL_PRODUCTION !== 'true') throw new Error('Production filesystem mode requires explicit PUBLICATION_ALLOW_LOCAL_PRODUCTION=true and a single engine process.')
  if (env.PUBLICATION_PLATFORM_ADAPTER === 'supabase' && !env.PUBLICATION_ADMIN_USER_IDS?.trim()) throw new Error('Supabase production requires PUBLICATION_ADMIN_USER_IDS.')
  if (env.PUBLICATION_ADMIN_PASSWORD && env.PUBLICATION_ADMIN_PASSWORD.length < 16) throw new Error('Production owner password must contain at least 16 characters.')
}
