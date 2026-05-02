import { NextResponse } from 'next/server'
import { signOutPublicationAdminSession } from '@/lib/publication-admin'

export async function POST(request: Request) {
  await signOutPublicationAdminSession()

  return NextResponse.redirect(new URL('/admin/login', request.url), {
    status: 302,
  })
}
