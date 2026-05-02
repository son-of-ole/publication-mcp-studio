import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import './globals.css'

const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.example'

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  title: 'Publication MCP Studio',
  description: 'A portable markdown-first scientific publication system with MCP, API, media, and public rendering.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_top,#f8fafc_0%,#eef6ff_34%,#f8fafc_100%)] text-slate-950">
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-y-2 px-3 py-2 sm:h-16 sm:px-6 lg:px-8">
            <Link href="/" className="group inline-flex min-h-[44px] min-w-0 items-center gap-2 pr-2 transition-opacity hover:opacity-80 sm:gap-3">
              <Image
                src="/logo.png"
                alt="Publication MCP Studio"
                width={160}
                height={40}
                className="h-8 w-auto sm:h-10"
                priority
              />
              <span className="hidden truncate text-base font-bold text-gray-900 transition-colors group-hover:text-cyan-700 md:block sm:text-lg">
                Publication MCP Studio
              </span>
            </Link>
            <div className="flex items-center gap-1 sm:gap-4">
              <Link href="/publications" className="inline-flex min-h-[44px] items-center px-2 py-2 text-xs font-medium text-gray-500 transition-colors hover:text-cyan-700 sm:text-sm">
                Publications
              </Link>
              <Link href="/admin/articles" className="inline-flex min-h-[44px] items-center px-2 py-2 text-xs font-medium text-gray-500 transition-colors hover:text-cyan-700 sm:text-sm">
                Admin
              </Link>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  )
}
