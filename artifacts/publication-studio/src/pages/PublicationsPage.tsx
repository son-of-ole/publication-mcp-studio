import { useEffect, useState } from 'react'
import { readPublicBootstrap } from '@/lib/public-bootstrap'
import { getPublicationPresentation } from '@/lib/publications'
import type { PublicationArticleRecord } from '@publication-mcp-studio/platform/types'
import { FileText } from 'lucide-react'
import PublicationsDirectory from '@/components/publications/PublicationsDirectory'

type PublicationCard = {
  title: string
  slug: string
  publishedLabel: string
  readingMinutes: number
  subtitle: string
  lead: string
  tags: string[]
  authors: string[]
  publicationLabel: string
}

export default function PublicationsPage() {
  const initial = readPublicBootstrap()
  const initialArticles = initial?.kind === 'directory' ? initial.articles : null
  const [articles, setArticles] = useState<PublicationCard[]>(() => initialArticles ? publicationCards(initialArticles) : [])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!initialArticles)

  useEffect(() => {
    if (initialArticles) return
    fetch('/content/articles?status=published&includeContent=true')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load publications')
        return data
      })
      .then((data) => {
        const arts = Array.isArray(data.articles) ? data.articles : []
        setArticles(publicationCards(arts))
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [initialArticles])

  return <PublicationsView articles={articles} loading={loading} error={error} />
}

export function publicationCards(articles: PublicationArticleRecord[]): PublicationCard[] {
  return articles.map(article => {
    const presentation = getPublicationPresentation(article.title, article.contentMarkdown, article.createdAt)
    return {
      title: presentation.metadata.title || article.title, slug: article.slug,
      publishedLabel: presentation.publishedLabel, readingMinutes: presentation.readingMinutes,
      subtitle: presentation.metadata.subtitle, lead: presentation.lead, tags: presentation.metadata.tags,
      authors: presentation.metadata.authors, publicationLabel: presentation.metadata.publicationLabel,
    }
  })
}

export function PublicationsView({ articles, loading = false, error = null }: { articles: PublicationCard[]; loading?: boolean; error?: string | null }) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5fbff_0%,#f8fafc_35%,#ffffff_100%)] px-4 pb-16 pt-24">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-[0_28px_90px_rgba(15,23,42,0.08)] backdrop-blur sm:p-10">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700">
              <FileText className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-700">Publication System</p>
              <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Scientific Publications</h1>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
            Explore research articles published in a markdown-first format with polished human presentation,
            source transparency, math support, and richer interactive scientific blocks.
          </p>
        </div>

        {loading ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            Loading publications...
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
            {error}
          </div>
        ) : articles.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            No publications are available yet.
          </div>
        ) : (
          <PublicationsDirectory articles={articles} />
        )}
      </div>
    </div>
  )
}
