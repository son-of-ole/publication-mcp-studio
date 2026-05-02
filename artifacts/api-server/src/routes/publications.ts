import { Router } from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { setPublicationAdminRequestContext, clearPublicationAdminRequestContext } from '../publication-lib/publication-admin-express.js'
import type { PublicationTokenScope } from '../publication-lib/publication-tokens.js'

// Lazy imports to avoid circular deps
async function getPublicationPlatform() {
  const { getPublicationPlatform } = await import('../publication-lib/publication-platform-express.js')
  return getPublicationPlatform()
}

async function getPublicationService() {
  const mod = await import('../publication-lib/publication-service.js')
  return mod
}

async function getPublicationAdmin() {
  const mod = await import('../publication-lib/publication-admin.js')
  return mod
}

async function getPublicationAudit() {
  const mod = await import('../publication-lib/publication-audit.js')
  return mod
}

async function getPublicationErrors() {
  const mod = await import('../publication-lib/publication-errors.js')
  return mod
}

async function getPublicationTokenRegistry() {
  const mod = await import('../publication-lib/publication-token-registry.js')
  return mod
}

async function getPublicationTokens() {
  const mod = await import('../publication-lib/publication-tokens.js')
  return mod
}

async function getPublicationSkills() {
  const mod = await import('../publication-lib/publication-skills.js')
  return mod
}

async function getPublicationVersioning() {
  const mod = await import('../publication-lib/publication-versioning.js')
  return mod
}

async function getPublicationImportExport() {
  const mod = await import('../publication-lib/publication-import-export.js')
  return mod
}

async function getPublicationMedia() {
  const mod = await import('../publication-lib/publication-media.js')
  return mod
}

async function getPublicationVerifiers() {
  const mod = await import('../publication-lib/publication-verifiers.js')
  return mod
}

async function getPublicationDocumentIR() {
  const mod = await import('../publication-lib/publication-document-ir.js')
  return mod
}

async function getPublicationAgent() {
  const mod = await import('../publication-lib/publication-agent.js')
  return mod
}

async function getProductionReadiness() {
  const mod = await import('../publication-lib/production-readiness.js')
  return mod
}

async function getPublicationRouteAuth() {
  const mod = await import('../publication-lib/publication-route-auth.js')
  return mod
}

const upload = multer({ storage: multer.memoryStorage() })

const router = Router()

// Middleware to wire request context for auth stores
router.use(cookieParser())
router.use((req, res, next) => {
  setPublicationAdminRequestContext(req, res, next)
})

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-publication-token',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function setCorsHeaders(res: any) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v))
}

function handleError(res: any, error: unknown) {
  import('../publication-lib/publication-errors.js').then(({ PublicationApiError }) => {
    if (error instanceof PublicationApiError) {
      setCorsHeaders(res)
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        details: error.details,
      })
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    setCorsHeaders(res)
    return res.status(500).json({ error: message, code: 'internal_error' })
  }).catch(() => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    setCorsHeaders(res)
    return res.status(500).json({ error: message, code: 'internal_error' })
  })
}

// OPTIONS preflight
router.options('/{*path}', (req, res) => {
  setCorsHeaders(res)
  res.status(200).json({})
})

// ── Auth Routes ──────────────────────────────────────────────────────────────

router.post('/auth/local-login', async (req, res) => {
  try {
    const platform = await getPublicationPlatform()
    const { email, password } = req.body
    if (!platform.adminAuthStore.signInWithPassword) {
      return res.status(400).json({ error: 'Local admin sign-in is unavailable.' })
    }
    const user = await platform.adminAuthStore.signInWithPassword({ email: email || '', password: password || '' })
    return res.json({ ok: true, user })
  } catch (error) {
    return handleError(res, error)
  }
})

router.post('/auth/signout', async (req, res) => {
  try {
    const platform = await getPublicationPlatform()
    await platform.adminAuthStore.signOut()
    res.redirect('/admin/login')
  } catch (error) {
    handleError(res, error)
  }
})

// ── Publications Admin Login ─────────────────────────────────────────────────

router.post('/publications/admin/login', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { email, password } = req.body
    const platform = await getPublicationPlatform()
    if (!platform.adminAuthStore.signInWithPassword) {
      return res.status(501).json({ error: 'Password auth unavailable.', code: 'password_auth_unavailable' })
    }
    const user = await platform.adminAuthStore.signInWithPassword({ email: email || '', password: password || '' })
    const { getPublicationErrors: _e } = await import('../publication-lib/publication-errors.js').then(m => ({ getPublicationErrors: m }))
    const { createPublicationTokenInventoryRecord } = await getPublicationTokenRegistry()
    const { issuePublicationAccessToken } = await getPublicationTokens()
    const { createPublicationAdminAuthContext } = await getPublicationAdmin()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const scopes: PublicationTokenScope[] = ['mcp:connect', 'articles:read', 'articles:write', 'articles:publish', 'articles:delete', 'agent:generate', 'audit:read']
    const tokenRecord = await createPublicationTokenInventoryRecord({ label: `Admin token for ${user.email ?? 'Publication admin'}`, scopes, issuedAt, expiresAt })
    const token = issuePublicationAccessToken({ tokenId: tokenRecord.id, label: tokenRecord.label, issuedAt: tokenRecord.issued_at, expiresAt: tokenRecord.expires_at, scopes: tokenRecord.scopes })

    await recordPublicationAuditEvent({
      action: 'tokens.issue',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/admin/login',
      method: 'POST',
      metadata: { tokenId: tokenRecord.id, label: tokenRecord.label },
    })

    const origin = `${req.protocol}://${req.get('host')}`
    return res.status(201).json({
      ok: true, user, token, tokenRecord,
      restBaseUrl: `${origin}/api/publications`,
      mcpEndpoint: `${origin}/api/publications/mcp`,
    })
  } catch (error) {
    return handleError(res, error)
  }
})

// ── Admin Articles List/Get ──────────────────────────────────────────────────

router.get('/admin/articles-list', async (req, res) => {
  try {
    const { assertPublicationAdminSession } = await getPublicationAdmin()
    const platform = await getPublicationPlatform()
    await assertPublicationAdminSession('list admin articles')
    const articles = await platform.publicationStore.listArticles({ status: 'all', limit: 200 })
    res.json({ articles: articles.map((a) => ({
      id: a.id, title: a.title, slug: a.slug, status: a.status, createdAt: a.created_at,
    })) })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/admin/articles-list/:id', async (req, res) => {
  try {
    const { assertPublicationAdminSession } = await getPublicationAdmin()
    const platform = await getPublicationPlatform()
    await assertPublicationAdminSession('view admin article')
    const article = await platform.publicationStore.getArticleByIdentifier(req.params.id)
    if (!article) return res.status(404).json({ error: 'Article not found', code: 'article_not_found' })
    return res.json({ article: {
      id: article.id, title: article.title, slug: article.slug,
      content_markdown: article.content_markdown, status: article.status,
      created_at: article.created_at, updated_at: article.updated_at,
    }})
  } catch (error) {
    return handleError(res, error)
  }
})

// ── Admin Articles ───────────────────────────────────────────────────────────

router.post('/admin/articles', async (req, res) => {
  try {
    const { assertPublicationAdminSession, createPublicationAdminAuthContext } = await getPublicationAdmin()
    const { createPublicationArticle, normalizePublicationArticleMutationInput, buildPublicationCorsHeaders } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const user = await assertPublicationAdminSession('create admin articles')
    const auth = createPublicationAdminAuthContext(user.email)
    const article = await createPublicationArticle(normalizePublicationArticleMutationInput(req.body), auth)

    await recordPublicationAuditEvent({
      action: 'articles.create', auth,
      route: '/api/admin/articles', method: 'POST',
      article: { id: article.id, slug: article.slug },
      metadata: { source: 'admin-editor' },
    })

    setCorsHeaders(res)
    return res.status(201).json({ article })
  } catch (error) {
    return handleError(res, error)
  }
})

router.patch('/admin/articles/:id', async (req, res) => {
  try {
    const { assertPublicationAdminSession, createPublicationAdminAuthContext } = await getPublicationAdmin()
    const { updatePublicationArticle, normalizePublicationArticleMutationInput } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const user = await assertPublicationAdminSession('update admin articles')
    const auth = createPublicationAdminAuthContext(user.email)
    const article = await updatePublicationArticle(req.params.id, normalizePublicationArticleMutationInput(req.body), auth)

    await recordPublicationAuditEvent({
      action: 'articles.update', auth,
      route: '/api/admin/articles/:id', method: 'PATCH',
      article: { id: article.id, slug: article.slug },
      metadata: { source: 'admin-editor' },
    })

    setCorsHeaders(res)
    res.json({ article })
  } catch (error) {
    handleError(res, error)
  }
})

// ── Admin Production Readiness ───────────────────────────────────────────────

router.get('/admin/production-readiness', async (req, res) => {
  try {
    const { assertPublicationAdminSession } = await getPublicationAdmin()
    const { getProductionReadinessReport } = await getProductionReadiness()
    await assertPublicationAdminSession('view production readiness')
    const report = await getProductionReadinessReport()
    res.json(report)
  } catch (error) {
    handleError(res, error)
  }
})

// ── Extract Text ─────────────────────────────────────────────────────────────

router.post('/extract-text', upload.single('file'), async (req, res) => {
  try {
    const { importPublicationDocument } = await getPublicationImportExport()

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' })
    }

    const importResult = await importPublicationDocument({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      data: req.file.buffer,
    })

    const text = importResult.ir.sections.map((s: any) => s.text).join('\n\n').trim() || importResult.document.body
    return res.json({ text, markdown: importResult.markdown, ir: importResult.ir, warnings: importResult.warnings })
  } catch (error) {
    return handleError(res, error)
  }
})

// ── Publications Articles ────────────────────────────────────────────────────

router.get('/publications/articles', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { hasPublicationApiCredentials } = await import('../publication-lib/publication-route-auth.js')
    const { assertPublicationApiAuth, listPublicationArticles } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const q = req.query as Record<string, string>
    const isPublicRequest = !hasPublicationApiCredentials(req)
    const requestedStatus = q.status === 'draft' || q.status === 'published' || q.status === 'all' ? q.status : 'published'

    let auth: any = null
    if (hasPublicationApiCredentials(req)) {
      auth = await assertPublicationApiAuth(req, ['articles:read'])
    }

    const tags = [...(Array.isArray(q.tag) ? q.tag : q.tag ? [q.tag] : []),
      ...(q.tags ? q.tags.split(',') : [])].map((t: string) => t.trim()).filter(Boolean)

    const result = await listPublicationArticles({
      status: isPublicRequest ? 'published' : requestedStatus,
      search: q.search,
      category: q.category,
      tag: Array.isArray(q.tag) ? q.tag[0] : q.tag,
      tags: tags.length > 0 ? tags : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      cursor: q.cursor,
      includeContent: q.includeContent === 'true',
    })

    if (auth) {
      await recordPublicationAuditEvent({
        action: 'articles.list', auth,
        route: '/api/publications/articles', method: 'GET',
      })
    }

    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/articles', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth, createPublicationArticle, normalizePublicationArticleMutationInput } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const auth = await assertPublicationApiAuth(req, ['articles:write'])
    const article = await createPublicationArticle(normalizePublicationArticleMutationInput(req.body), auth)

    await recordPublicationAuditEvent({
      action: 'articles.create', auth,
      route: '/api/publications/articles', method: 'POST',
      article: { id: article.id, slug: article.slug },
    })

    return res.status(201).json({ article })
  } catch (error) {
    return handleError(res, error)
  }
})

router.get('/publications/articles/:identifier', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { hasPublicationApiCredentials } = await import('../publication-lib/publication-route-auth.js')
    const { assertPublicationApiAuth, getPublicationArticle } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const includeContent = req.query.includeContent !== 'false'
    const article = await getPublicationArticle(req.params.identifier, includeContent)

    if (hasPublicationApiCredentials(req)) {
      const auth = await assertPublicationApiAuth(req, ['articles:read'])
      await recordPublicationAuditEvent({
        action: 'articles.read', auth,
        route: '/api/publications/articles/:identifier', method: 'GET',
        article: { id: article.id, slug: article.slug },
      })
    } else if (article.status !== 'published') {
      const { PublicationApiError } = await getPublicationErrors()
      throw new PublicationApiError(403, 'article_not_published', 'This article is not published.')
    }

    res.json({ article })
  } catch (error) {
    handleError(res, error)
  }
})

router.patch('/publications/articles/:identifier', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth, updatePublicationArticle, normalizePublicationArticleMutationInput } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const auth = await assertPublicationApiAuth(req, ['articles:write'])
    const article = await updatePublicationArticle(req.params.identifier, normalizePublicationArticleMutationInput(req.body), auth)

    await recordPublicationAuditEvent({
      action: 'articles.update', auth,
      route: '/api/publications/articles/:identifier', method: 'PATCH',
      article: { id: article.id, slug: article.slug },
    })

    res.json({ article })
  } catch (error) {
    handleError(res, error)
  }
})

router.delete('/publications/articles/:identifier', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth, deletePublicationArticle } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const auth = await assertPublicationApiAuth(req, ['articles:delete'])
    await deletePublicationArticle(req.params.identifier, auth)

    await recordPublicationAuditEvent({
      action: 'articles.delete', auth,
      route: '/api/publications/articles/:identifier', method: 'DELETE',
    })

    res.json({ ok: true })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/articles/:identifier/publish', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth, publishPublicationArticle } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const auth = await assertPublicationApiAuth(req, ['articles:publish'])
    const article = await publishPublicationArticle(req.params.identifier, auth)

    await recordPublicationAuditEvent({
      action: 'articles.publish', auth,
      route: '/api/publications/articles/:identifier/publish', method: 'POST',
      article: { id: article.id, slug: article.slug },
    })

    res.json({ article })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/articles/:identifier/unpublish', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth, unpublishPublicationArticle } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const auth = await assertPublicationApiAuth(req, ['articles:publish'])
    const article = await unpublishPublicationArticle(req.params.identifier, auth)

    await recordPublicationAuditEvent({
      action: 'articles.publish', auth,
      route: '/api/publications/articles/:identifier/unpublish', method: 'POST',
      article: { id: article.id, slug: article.slug },
    })

    res.json({ article })
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/publications/articles/:identifier/versions', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { resolvePublicationRouteAuth, listPublicationArticleVersions } = await getPublicationRouteAuth().then(async m => {
      const svc = await getPublicationService()
      return { resolvePublicationRouteAuth: m.resolvePublicationRouteAuth, listPublicationArticleVersions: svc.listPublicationArticleVersions }
    })
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const auth = await resolvePublicationRouteAuth(req, ['articles:read'], 'view article version history')
    const result = await listPublicationArticleVersions(req.params.identifier)

    await recordPublicationAuditEvent({
      action: 'versions.list', auth,
      route: '/api/publications/articles/:identifier/versions', method: 'GET',
      article: { id: result.article.id, slug: result.article.slug },
    })

    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/articles/:identifier/versions/:versionId/restore', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { resolvePublicationRouteAuth } = await getPublicationRouteAuth()
    const { restorePublicationArticleVersion } = await getPublicationService()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const auth = await resolvePublicationRouteAuth(req, ['articles:write'], 'restore article versions')
    const result = await restorePublicationArticleVersion(req.params.identifier, req.params.versionId, auth)

    await recordPublicationAuditEvent({
      action: 'versions.restore', auth,
      route: '/api/publications/articles/:identifier/versions/:versionId/restore', method: 'POST',
      article: { id: result.article.id, slug: result.article.slug },
    })

    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

// ── Publications Audit ───────────────────────────────────────────────────────

router.get('/publications/audit', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationAdminSession, createPublicationAdminAuthContext } = await getPublicationAdmin()
    const { listPublicationAuditEvents, recordPublicationAuditEvent } = await getPublicationAudit()

    const user = await assertPublicationAdminSession('view publication audit events')
    const limit = req.query.limit ? Number(req.query.limit) : 30
    const events = await listPublicationAuditEvents(limit)

    await recordPublicationAuditEvent({
      action: 'audit.read',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/audit', method: 'GET',
      metadata: { limit },
    })

    res.json({ events })
  } catch (error) {
    handleError(res, error)
  }
})

// ── Publications Export/Import ───────────────────────────────────────────────

router.post('/publications/export', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth, getPublicationArticle } = await getPublicationService()
    const { exportPublicationDocument } = await getPublicationImportExport()
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const { PublicationApiError } = await getPublicationErrors()

    const auth = await assertPublicationApiAuth(req, ['articles:read'])
    const body = req.body || {}
    let markdown = ''

    if (typeof body.markdown === 'string' && body.markdown.trim()) {
      markdown = body.markdown
    } else if (typeof body.identifier === 'string' && body.identifier.trim()) {
      const article = await getPublicationArticle(body.identifier.trim(), true)
      if (!article.contentMarkdown) throw new PublicationApiError(404, 'article_markdown_missing', `No markdown found for "${body.identifier.trim()}"`)
      markdown = article.contentMarkdown
    } else {
      throw new PublicationApiError(400, 'markdown_missing', 'Provide markdown or an article identifier.')
    }

    const format = ['markdown', 'json', 'latex', 'docx', 'pdf'].includes(body.format) ? body.format : (() => { throw new PublicationApiError(400, 'invalid_export_format', 'format must be: markdown, json, latex, docx, pdf') })()
    const exportResult = await exportPublicationDocument({ markdown, format, fileName: body.fileName, fallbackTitle: body.fallbackTitle })

    await recordPublicationAuditEvent({ action: 'articles.read', auth, route: '/api/publications/export', method: 'POST', metadata: { format } })
    res.json({ exportResult })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/import', upload.single('file'), async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth } = await getPublicationService()
    const { importPublicationDocument } = await getPublicationImportExport()
    const { recordPublicationAuditEvent } = await getPublicationAudit()
    const { PublicationApiError } = await getPublicationErrors()

    const auth = await assertPublicationApiAuth(req, ['articles:write'])
    let payload: { fileName: string; mimeType?: string; data: Uint8Array | Buffer }

    if (req.file) {
      payload = { fileName: req.file.originalname, mimeType: req.file.mimetype, data: req.file.buffer }
    } else {
      const body = req.body || {}
      if (!body.fileName?.trim()) throw new PublicationApiError(400, 'file_name_missing', 'A fileName is required.')
      if (!body.dataBase64?.trim() && !body.text?.trim()) throw new PublicationApiError(400, 'file_data_missing', 'Provide dataBase64 or text.')
      payload = {
        fileName: body.fileName,
        mimeType: body.mimeType,
        data: body.dataBase64?.trim()
          ? Buffer.from(body.dataBase64.includes(',') ? body.dataBase64.slice(body.dataBase64.indexOf(',') + 1) : body.dataBase64, 'base64')
          : Buffer.from(body.text || '', 'utf8'),
      }
    }

    const result = await importPublicationDocument(payload)
    await recordPublicationAuditEvent({ action: 'articles.create', auth, route: '/api/publications/import', method: 'POST', metadata: { sourceFormat: result.format } })
    res.json({ importResult: result })
  } catch (error) {
    handleError(res, error)
  }
})

// ── Publications Media ───────────────────────────────────────────────────────

router.get('/publications/media', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { resolvePublicationRouteAuth } = await getPublicationRouteAuth()
    const { listPublicationMedia } = await getPublicationMedia()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const auth = await resolvePublicationRouteAuth(req, ['articles:read'], 'browse publication media')
    const q = req.query as Record<string, string>
    const media = await listPublicationMedia({
      articleIdentifier: q.articleIdentifier,
      articleSlug: q.articleSlug,
      limit: q.limit ? Number(q.limit) : undefined,
    })

    await recordPublicationAuditEvent({ action: 'media.list', auth, route: '/api/publications/media', method: 'GET' })
    res.json(media)
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/media', upload.single('file'), async (req, res) => {
  try {
    setCorsHeaders(res)
    const { resolvePublicationRouteAuth } = await getPublicationRouteAuth()
    const { uploadPublicationMedia } = await getPublicationMedia()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const auth = await resolvePublicationRouteAuth(req, ['articles:write'], 'upload publication media')
    let uploadInput: any

    if (req.file) {
      uploadInput = {
        fileName: req.file.originalname,
        contentType: req.file.mimetype,
        dataBase64: req.file.buffer.toString('base64'),
        articleIdentifier: req.body?.articleIdentifier,
        articleSlug: req.body?.articleSlug,
        altText: req.body?.altText,
        caption: req.body?.caption,
        posterUrl: req.body?.posterUrl,
      }
    } else {
      uploadInput = req.body || {}
    }

    const result = await uploadPublicationMedia(uploadInput)
    await recordPublicationAuditEvent({ action: 'media.upload', auth, route: '/api/publications/media', method: 'POST' })
    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

router.delete('/publications/media', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { resolvePublicationRouteAuth } = await getPublicationRouteAuth()
    const { deletePublicationMedia } = await getPublicationMedia()
    const { PublicationApiError } = await getPublicationErrors()

    await resolvePublicationRouteAuth(req, ['articles:write'], 'delete publication media')
    const path = typeof req.body?.path === 'string' && req.body.path.trim()
      ? req.body.path.trim()
      : (typeof req.query?.path === 'string' ? req.query.path.trim() : '')
    if (!path) {
      throw new PublicationApiError(400, 'media_path_missing', 'A "path" field is required to delete media.')
    }
    const result = await deletePublicationMedia(path)
    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

// ── Publications Tokens ──────────────────────────────────────────────────────

router.get('/publications/tokens', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationAdminSession, createPublicationAdminAuthContext } = await getPublicationAdmin()
    const { listPublicationTokenInventory } = await getPublicationTokenRegistry()
    const { hasPublicationTokenSecret, PUBLICATION_TOKEN_SCOPES } = await getPublicationTokens()
    const { listPublicationSkills, listPublicationConnectorHealth } = await getPublicationSkills()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const user = await assertPublicationAdminSession('manage publication tokens')
    const tokens = await listPublicationTokenInventory()

    await recordPublicationAuditEvent({
      action: 'audit.read',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/tokens', method: 'GET',
      metadata: { inventoryCount: tokens.length },
    })

    const origin = `${req.protocol}://${req.get('host')}`
    res.json({
      mcpEndpoint: `${origin}/api/publications/mcp`,
      restBaseUrl: `${origin}/api/publications`,
      signedTokensEnabled: hasPublicationTokenSecret(),
      staticTokenConfigured: Boolean(process.env.PUBLICATION_API_TOKEN?.trim() || process.env.PUBLICATION_API_TOKENS?.trim()),
      defaultModel: process.env.PUBLICATION_AGENT_MODEL || 'openai/gpt-5-mini',
      availableScopes: PUBLICATION_TOKEN_SCOPES,
      availableSkills: listPublicationSkills({ auth: { enabledSkillIds: [], adminVisibility: true }, includeDisabled: true }),
      connectorHealth: listPublicationConnectorHealth(),
      tokens,
    })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/tokens', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationAdminSession, createPublicationAdminAuthContext } = await getPublicationAdmin()
    const { createPublicationTokenInventoryRecord } = await getPublicationTokenRegistry()
    const { issuePublicationAccessToken } = await getPublicationTokens()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const user = await assertPublicationAdminSession('create publication tokens')
    const auth = createPublicationAdminAuthContext(user.email)
    const body = req.body || {}
    const issuedAt = new Date().toISOString()
    const expiresAt = body.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

    const tokenRecord = await createPublicationTokenInventoryRecord({
      label: body.label || 'Publication API Token',
      scopes: Array.isArray(body.scopes) ? body.scopes : ['articles:read'],
      profileId: body.profileId || null,
      profileLabel: body.profileLabel || null,
      profileEnabledSkillIds: Array.isArray(body.profileEnabledSkillIds) ? body.profileEnabledSkillIds : [],
      tokenEnabledSkillIds: body.tokenEnabledSkillIds || null,
      allowProfileSkillOverrides: Boolean(body.allowProfileSkillOverrides),
      issuedAt,
      expiresAt,
    })
    const token = issuePublicationAccessToken({
      tokenId: tokenRecord.id,
      label: tokenRecord.label,
      issuedAt: tokenRecord.issued_at,
      expiresAt: tokenRecord.expires_at,
      scopes: tokenRecord.scopes,
    })

    await recordPublicationAuditEvent({ action: 'tokens.issue', auth, route: '/api/publications/tokens', method: 'POST', metadata: { tokenId: tokenRecord.id } })
    res.status(201).json({ token, tokenRecord })
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/publications/tokens/:tokenId/revoke', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationAdminSession, createPublicationAdminAuthContext } = await getPublicationAdmin()
    const { revokePublicationTokenInventoryRecord } = await getPublicationTokenRegistry()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const user = await assertPublicationAdminSession('revoke publication tokens')
    const token = await revokePublicationTokenInventoryRecord(req.params.tokenId)

    await recordPublicationAuditEvent({
      action: 'tokens.revoke',
      auth: createPublicationAdminAuthContext(user.email),
      route: '/api/publications/tokens/:tokenId/revoke', method: 'POST',
      metadata: { tokenId: token.id },
    })

    res.json({ token })
  } catch (error) {
    handleError(res, error)
  }
})

// ── Publications Verify ──────────────────────────────────────────────────────

router.all('/publications/verify', async (req, res) => {
  try {
    setCorsHeaders(res)
    if (req.method === 'GET') {
      const { assertPublicationApiAuth } = await getPublicationService()
      const { listPublicationVerifiers, listPublicationPresets } = await getPublicationVerifiers()
      const auth = await assertPublicationApiAuth(req, ['articles:read'])
      return res.json({ verifiers: listPublicationVerifiers(auth), presets: listPublicationPresets(auth) })
    }
    if (req.method === 'POST') {
      const { assertPublicationApiAuth, getPublicationArticle } = await getPublicationService()
      const { verifyPublicationMarkdown, runPublicationPreset, listPublicationVerifiers, listPublicationPresets } = await getPublicationVerifiers()
      const { buildPublicationDocumentIR } = await getPublicationDocumentIR()
      const { recordPublicationAuditEvent } = await getPublicationAudit()
      const { PublicationApiError } = await getPublicationErrors()

      const auth = await assertPublicationApiAuth(req, ['articles:read'])
      const body = req.body || {}
      let markdown = ''
      if (typeof body.markdown === 'string' && body.markdown.trim()) {
        markdown = body.markdown
      } else if (typeof body.identifier === 'string') {
        const article = await getPublicationArticle(body.identifier, true)
        if (!article.contentMarkdown) throw new PublicationApiError(404, 'article_markdown_missing', 'No markdown found')
        markdown = article.contentMarkdown
      } else {
        throw new PublicationApiError(400, 'markdown_missing', 'Provide markdown or identifier')
      }

      const fallbackTitle = typeof body.fallbackTitle === 'string' ? body.fallbackTitle : ''
      const response = typeof body.presetId === 'string' && body.presetId.trim()
        ? { preset: await runPublicationPreset(markdown, body.presetId.trim(), fallbackTitle, auth), ir: buildPublicationDocumentIR(markdown, fallbackTitle) }
        : typeof body.verifierId === 'string' && body.verifierId.trim()
          ? { result: await verifyPublicationMarkdown(markdown, body.verifierId.trim(), fallbackTitle, auth), ir: buildPublicationDocumentIR(markdown, fallbackTitle) }
          : (() => { throw new PublicationApiError(400, 'verification_target_missing', 'Provide verifierId or presetId') })()

      await recordPublicationAuditEvent({ action: 'articles.read', auth, route: '/api/publications/verify', method: 'POST' })
      return res.json(response)
    }
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' })
  } catch (error) {
    return handleError(res, error)
  }
})

// ── Publications Agent ───────────────────────────────────────────────────────

router.post('/publications/agent', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { assertPublicationApiAuth } = await getPublicationService()
    const { generatePublicationDraft } = await getPublicationAgent()
    const { recordPublicationAuditEvent } = await getPublicationAudit()

    const auth = await assertPublicationApiAuth(req, ['agent:generate'])
    const draft = await generatePublicationDraft(req.body)

    await recordPublicationAuditEvent({ action: 'agent.generate', auth, route: '/api/publications/agent', method: 'POST' })
    res.json({ draft })
  } catch (error) {
    handleError(res, error)
  }
})

// ── MCP Health ───────────────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = '2025-03-26'
const MCP_SERVER_NAME = 'publication-mcp-studio'

router.get('/publications/mcp/health', async (req, res) => {
  setCorsHeaders(res)
  res.json({
    ok: true,
    protocolVersion: MCP_PROTOCOL_VERSION,
    server: MCP_SERVER_NAME,
  })
})

// ── MCP Main Endpoint ────────────────────────────────────────────────────────

router.get('/publications/mcp', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { handleMcpGet } = await import('../publication-routes/publications/mcp/route.js')
    return handleMcpGet(req, res)
  } catch (error) {
    return handleError(res, error)
  }
})

router.post('/publications/mcp', async (req, res) => {
  try {
    setCorsHeaders(res)
    const { handleMcpPost } = await import('../publication-routes/publications/mcp/route.js')
    return handleMcpPost(req, res)
  } catch (error) {
    return handleError(res, error)
  }
})

export default router
