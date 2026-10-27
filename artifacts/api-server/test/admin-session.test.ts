import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request, Response } from 'express'
import {
  createExpressLocalPublicationAdminAuthStore,
  runWithPublicationAdminRequestContext,
} from '../src/publication-lib/publication-admin-express.js'

const credentials = { adminEmail: 'owner@example.invalid', adminPassword: ' test password ' }
const login = { email: 'OWNER@example.invalid', password: credentials.adminPassword }
const cookieName = 'publication_admin_session'

function context(cookie?: unknown, headers: Record<string, string> = {}, method = 'GET') {
  const result = { cookie: '', options: {} as Record<string, unknown>, cleared: false }
  const req = {
    cookies: { [cookieName]: cookie }, method, protocol: 'http',
    get: (name: string) => name === 'host' ? 'localhost:5180' : headers[name],
  } as unknown as Request
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      assert.equal(name, cookieName)
      result.cookie = value
      result.options = options
    },
    clearCookie: () => { result.cleared = true },
  } as unknown as Response
  return { result, run: <T>(fn: () => T) => runWithPublicationAdminRequestContext(req, res, fn) }
}

test('rejects legacy, forged, encoded, malformed and non-string session cookies', async () => {
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  for (const value of [undefined, 'owner@example.invalid', 'owner%40example.invalid', '%E0%A4%A', 'x'.repeat(43), {}, ['x']]) {
    assert.equal(await context(value).run(() => store.getCurrentUser()), null)
  }
})

test('valid login creates an opaque cookie accepted by a newly created store', async () => {
  const ctx = context()
  const user = await ctx.run(() => createExpressLocalPublicationAdminAuthStore(credentials).signInWithPassword!(login))
  assert.equal(user.email, credentials.adminEmail)
  assert.match(ctx.result.cookie, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(ctx.result.options.httpOnly, true)
  assert.equal(ctx.result.options.sameSite, 'lax')
  assert.equal(ctx.result.options.maxAge, 8 * 60 * 60 * 1000)
  assert.equal((await context(ctx.result.cookie).run(() => createExpressLocalPublicationAdminAuthStore(credentials).getCurrentUser()))?.email, credentials.adminEmail)
  const modified = (ctx.result.cookie[0] === 'a' ? 'b' : 'a') + ctx.result.cookie.slice(1)
  assert.equal(await context(modified).run(() => createExpressLocalPublicationAdminAuthStore(credentials).getCurrentUser()), null)
})

test('missing or incorrect credentials cannot issue a session; password whitespace is significant', async () => {
  const ctx = context()
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  for (const input of [{ email: '', password: '' }, { ...login, password: 'wrong' }, { ...login, password: login.password.trim() }, { email: 12, password: {} }]) {
    await assert.rejects(() => ctx.run(() => store.signInWithPassword!(input as typeof login)))
    assert.equal(ctx.result.cookie, '')
  }
  await assert.rejects(() => ctx.run(() => createExpressLocalPublicationAdminAuthStore().signInWithPassword!(login)), { code: 'admin_login_disabled' })
})

test('expiry and credential changes invalidate sessions and disabled auth fails closed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  const ctx = context()
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  await ctx.run(() => store.signInWithPassword!(login))
  assert.equal(await context(ctx.result.cookie).run(() => createExpressLocalPublicationAdminAuthStore().getCurrentUser()), null)
  t.mock.timers.tick(8 * 60 * 60 * 1000)
  assert.equal(await context(ctx.result.cookie).run(() => store.getCurrentUser()), null)
  await ctx.run(() => store.signInWithPassword!(login))
  assert.equal(await context(ctx.result.cookie).run(() => createExpressLocalPublicationAdminAuthStore({ ...credentials, adminPassword: 'rotated' }).getCurrentUser()), null)
})

test('logout revokes the server session, including a replay of the old cookie', async () => {
  const ctx = context()
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  await ctx.run(() => store.signInWithPassword!(login))
  const signedIn = context(ctx.result.cookie)
  await signedIn.run(() => store.signOut())
  assert.equal(signedIn.result.cleared, true)
  assert.equal(await context(ctx.result.cookie).run(() => store.getCurrentUser()), null)
})

test('a fresh login rotates the session instead of accepting a fixed session ID', async () => {
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  const first = context('x'.repeat(43))
  await first.run(() => store.signInWithPassword!(login))
  const second = context(first.result.cookie)
  await second.run(() => store.signInWithPassword!(login))
  assert.notEqual(first.result.cookie, second.result.cookie)
  assert.equal(await context(first.result.cookie).run(() => store.getCurrentUser()), null)
  assert.ok(await context(second.result.cookie).run(() => store.getCurrentUser()))
})

test('cross-origin login, cookie writes and logout fail without revoking a valid session', async () => {
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  const ctx = context()
  await ctx.run(() => store.signInWithPassword!(login))
  for (const headers of [{ origin: 'https://attacker.invalid' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    const crossSite = context(ctx.result.cookie, headers, 'POST')
    await assert.rejects(() => crossSite.run(() => store.signInWithPassword!(login)), { code: 'admin_origin_invalid' })
    await assert.rejects(() => crossSite.run(() => store.getCurrentUser()), { code: 'admin_origin_invalid' })
    await assert.rejects(() => crossSite.run(() => store.signOut()), { code: 'admin_origin_invalid' })
  }
  assert.ok(await context(ctx.result.cookie, { origin: 'http://localhost:5180' }, 'POST').run(() => store.getCurrentUser()))
})

test('request context isolates concurrent authenticated and anonymous requests', async () => {
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  const ctx = context()
  await ctx.run(() => store.signInWithPassword!(login))
  const users = await Promise.all([
    context(ctx.result.cookie).run(async () => { await new Promise(resolve => setImmediate(resolve)); return store.getCurrentUser() }),
    context().run(async () => { await new Promise(resolve => setImmediate(resolve)); return store.getCurrentUser() }),
  ])
  assert.equal(users[0]?.email, credentials.adminEmail)
  assert.equal(users[1], null)
})

test('explicit public origin supports a TLS proxy and rejects other origins', async (t) => {
  const previous = process.env.PUBLICATION_ADMIN_ORIGIN
  process.env.PUBLICATION_ADMIN_ORIGIN = 'https://studio.example.invalid'
  t.after(() => {
    if (previous === undefined) delete process.env.PUBLICATION_ADMIN_ORIGIN
    else process.env.PUBLICATION_ADMIN_ORIGIN = previous
  })
  const store = createExpressLocalPublicationAdminAuthStore(credentials)
  const ctx = context(undefined, { origin: 'https://studio.example.invalid' }, 'POST')
  await ctx.run(() => store.signInWithPassword!(login))
  assert.ok(await context(ctx.result.cookie, { origin: 'https://studio.example.invalid' }, 'PATCH').run(() => store.getCurrentUser()))
  await assert.rejects(() => context(ctx.result.cookie, { origin: 'http://localhost:5180' }, 'POST').run(() => store.signOut()), { code: 'admin_origin_invalid' })
  process.env.PUBLICATION_ADMIN_ORIGIN = 'invalid'
  await assert.rejects(() => ctx.run(() => store.signInWithPassword!(login)), { code: 'admin_origin_invalid' })
})

test('production cookies are Secure and HTTPS origin works behind TLS termination', async (t) => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  })
  const ctx = context(undefined, { origin: 'https://localhost:5180' }, 'POST')
  await ctx.run(() => createExpressLocalPublicationAdminAuthStore(credentials).signInWithPassword!(login))
  assert.equal(ctx.result.options.secure, true)
})
