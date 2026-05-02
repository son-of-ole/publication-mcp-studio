import { useEffect, useState } from 'react'
import { useParams, useLocation } from 'wouter'
import ClientArticleEditor from '@/components/ClientArticleEditor'
import type { Article } from '@/components/ArticleEditor'

export default function AdminEditArticlePage() {
  const { id } = useParams<{ id: string }>()
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [, setLocation] = useLocation()

  useEffect(() => {
    if (!id) return
    fetch(`/api/admin/articles-list/${id}`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) {
          setLocation('/admin/login')
          return null
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Article not found')
        return data
      })
      .then((data) => {
        if (data) setArticle(data.article)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f8fb]">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
          Loading article...
        </div>
      </div>
    )
  }

  if (error || !article) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f8fb]">
        <div className="text-center">
          <p className="text-slate-500">{error || 'Article not found'}</p>
          <a href="/admin/articles" className="mt-4 block text-blue-600 hover:underline">Back to articles</a>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen min-h-0 bg-gray-50">
      <ClientArticleEditor initialArticle={article} />
    </div>
  )
}
