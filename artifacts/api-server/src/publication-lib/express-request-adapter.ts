import type { Request } from 'express'

export function adaptExpressRequestToFetch(req: Request): Request {
  const protocol = req.protocol || 'http'
  const host = req.get('host') || 'localhost'
  const url = `${protocol}://${host}${req.originalUrl || req.url}`

  const headers = new Headers()
  Object.entries(req.headers).forEach(([key, value]) => {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
  })

  return new globalThis.Request(url, {
    method: req.method,
    headers,
  }) as any
}
