import { NextRequest, NextResponse } from 'next/server'
import { getPublicationPlatform } from '@/lib/publication-platform'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email : ''
  const password = typeof body.password === 'string' ? body.password : ''

  try {
    const platform = getPublicationPlatform()
    if (!platform.adminAuthStore.signInWithPassword) {
      return NextResponse.json({ error: 'Local admin sign-in is unavailable.' }, { status: 400 })
    }

    const user = await platform.adminAuthStore.signInWithPassword({ email, password })
    return NextResponse.json({ ok: true, user })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Local admin sign-in failed.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
