import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { FileText, LogOut, Plus } from 'lucide-react'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="shrink-0 p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Publications
          </h2>
        </div>
        
        <nav className="flex-1 overflow-y-auto px-4 space-y-1">
          <Link
            href="/admin/articles"
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-blue-50 text-blue-700"
          >
            All Articles
          </Link>
          <Link
            href="/admin/articles/new"
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
          >
            <Plus className="w-4 h-4" />
            Create New
          </Link>
        </nav>

        <div className="shrink-0 border-t border-gray-200 p-4">
          <div className="text-xs text-gray-500 truncate mb-2">{user.email}</div>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 w-full"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
