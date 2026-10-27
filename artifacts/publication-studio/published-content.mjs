/** Shared by development and production. This is an allowlisted reader, never an API proxy. */
export function createPublishedContentReader(publishedOrigin) {
  const origin = new URL(publishedOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLICATION_PUBLISHED_ORIGIN must be a bare HTTP(S) origin')
  return async function read(path) {
    const url = new URL(path, 'http://reader.invalid')
    if (url.pathname !== '/healthz' && !/^\/articles(?:\/[^/]+)?$/.test(url.pathname) && !/^\/__publication-(?:local\/media|assets)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) return new Response('Not found', { status: 404 })
    const target = new URL(url.pathname, origin)
    for (const key of ['offset', 'limit']) if (url.searchParams.has(key)) target.searchParams.set(key, url.searchParams.get(key))
    // No visitor headers, cookies, bearer tokens, arbitrary queries or redirects.
    return fetch(target, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  }
}

export function createReaderMiddleware({ publishedOrigin }) {
  const read = createPublishedContentReader(publishedOrigin)
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://reader.invalid')
    let pathname
    try { pathname = decodeURIComponent(url.pathname).toLowerCase() } catch { res.statusCode = 404; res.end('Not found'); return }
    if (/^\/(?:api|admin|mcp)(?:\/|$)/.test(pathname)) {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Robots-Tag', 'noindex, nofollow')
      res.statusCode = 404; res.end('Not found'); return
    }
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.setHeader('Allow', 'GET, HEAD'); res.setHeader('Cache-Control', 'no-store')
      res.statusCode = 405; res.end('Read-only website'); return
    }
    if (pathname === '/healthz') {
      res.setHeader('Cache-Control', 'no-store')
      try { const response = await read('/healthz'); res.statusCode = response.ok ? 200 : 503; res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: response.ok ? 'ready' : 'unavailable' })) }
      catch { res.statusCode = 503; res.end('{"status":"unavailable"}') }
      return
    }
    const media = pathname.startsWith('/__publication-local/') || pathname.startsWith('/__publication-assets/')
    if (!pathname.startsWith('/content/') && !media) return next()
    res.setHeader('Cache-Control', 'no-store')
    if (!media) res.setHeader('X-Robots-Tag', 'noindex')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const response = await read(`${media ? url.pathname : url.pathname.slice('/content'.length)}${url.search}`)
      res.statusCode = response.status
      res.setHeader('Content-Type', media ? response.headers.get('content-type') || 'application/octet-stream' : 'application/json; charset=utf-8')
      if (media) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
      if (media && response.headers.has('content-disposition')) res.setHeader('Content-Disposition', response.headers.get('content-disposition'))
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
    } catch { res.statusCode = 503; res.end('{"error":"Published content unavailable"}') }
  }
}
