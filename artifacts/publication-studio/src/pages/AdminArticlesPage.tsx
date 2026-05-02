import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { Plus, Edit3, FileText, LogOut } from 'lucide-react'
import PublicationAccessPanel from '@/components/publications/PublicationAccessPanel'
import PublicationAuditPanel from '@/components/publications/PublicationAuditPanel'
import ProductionReadinessPanel from '@/components/publications/ProductionReadinessPanel'

type Article = {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
  createdAt: string
}

export default function AdminArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [, setLocation] = useLocation()

  useEffect(() => {
    fetch('/api/admin/articles-list')
      .then(async (res) => {
        if (res.status === 401) {
          setLocation('/admin/login')
          return null
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load articles')
        return data
      })
      .then((data) => {
        if (data) setArticles(Array.isArray(data.articles) ? data.articles : [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSignOut = async (e: React.FormEvent) => {
    e.preventDefault()
    await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' })
    setLocation('/admin/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white">
        <div className="shrink-0 p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Publications
          </h2>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 space-y-1">
          <a
            href="/admin/articles"
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-blue-50 text-blue-700"
          >
            All Articles
          </a>
          <a
            href="/admin/articles/new"
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
          >
            <Plus className="w-4 h-4" />
            Create New
          </a>
        </nav>
        <div className="shrink-0 border-t border-gray-200 p-4">
          <form onSubmit={handleSignOut}>
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

      <main className="flex-1 overflow-y-auto">
        <div className="flex flex-col p-8">
          <div className="sticky top-0 z-10 mb-8 flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white/90 p-5 shadow-sm backdrop-blur">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Articles</h1>
              <p className="mt-1 text-sm text-gray-500">Create, review, and publish your markdown-first scientific publications.</p>
            </div>
            <a
              href="/admin/articles/new"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
            >
              <Plus className="w-4 h-4" />
              Create Article
            </a>
          </div>

          <div className="mb-6"><PublicationAccessPanel /></div>
          <div className="mb-6"><ProductionReadinessPanel /></div>
          <div className="mb-6"><PublicationAuditPanel /></div>

          {loading ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200 text-gray-500">
              Loading articles...
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-600 p-4 rounded-md">{error}</div>
          ) : articles.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
              <p className="text-gray-500 mb-4">You don't have any articles yet.</p>
              <a href="/admin/articles/new" className="text-blue-600 hover:text-blue-800 font-medium">
                Create your first article
              </a>
            </div>
          ) : (
            <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {articles.map((article) => (
                    <tr key={article.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{article.title}</div>
                        <div className="text-sm text-gray-500">/{article.slug}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          article.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {article.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(article.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <a
                          href={`/admin/articles/${article.id}/edit`}
                          className="text-blue-600 hover:text-blue-900 flex items-center justify-end gap-1"
                        >
                          <Edit3 className="w-4 h-4" />
                          Edit
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
