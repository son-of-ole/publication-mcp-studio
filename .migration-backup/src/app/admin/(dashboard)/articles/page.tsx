import Link from 'next/link'
import { Plus, Edit3 } from 'lucide-react'
import PublicationAccessPanel from '@/components/publications/PublicationAccessPanel'
import PublicationAuditPanel from '@/components/publications/PublicationAuditPanel'
import ProductionReadinessPanel from '@/components/publications/ProductionReadinessPanel'
import { listPublicationArticles } from '@/lib/publication-service'

export default async function AdminArticlesPage() {
  let articles: Awaited<ReturnType<typeof listPublicationArticles>>['articles'] = []
  let error: Error | null = null

  try {
    articles = (await listPublicationArticles({
      status: 'all',
      includeContent: true,
    })).articles
  } catch (nextError) {
    error = nextError instanceof Error ? nextError : new Error('Failed to load articles.')
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-8">
      <div className="sticky top-0 z-10 mb-8 flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white/90 p-5 shadow-sm backdrop-blur">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Articles</h1>
          <p className="mt-1 text-sm text-gray-500">Create, review, and publish your markdown-first scientific publications.</p>
        </div>
        <Link
          href="/admin/articles/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          Create Article
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="mb-6">
        <PublicationAccessPanel />
      </div>

      <div className="mb-6">
        <ProductionReadinessPanel />
      </div>

      <div className="mb-6">
        <PublicationAuditPanel />
      </div>

      {error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-md">
          Error loading articles: {error.message}
        </div>
      ) : articles.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 mb-4">You don&apos;t have any articles yet.</p>
          <Link
            href="/admin/articles/new"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Create your first article
          </Link>
        </div>
      ) : (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
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
                    <Link
                      href={`/admin/articles/${article.id}/edit`}
                      className="text-blue-600 hover:text-blue-900 flex items-center justify-end gap-1"
                    >
                      <Edit3 className="w-4 h-4" />
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  )
}
