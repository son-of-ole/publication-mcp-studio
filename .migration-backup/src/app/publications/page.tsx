import type { Metadata } from 'next'
import { FileText } from 'lucide-react'
import PublicationsDirectory from '@/components/publications/PublicationsDirectory'
import { listPublicationArticles } from '@/lib/publication-service'

export const revalidate = 60
export const metadata: Metadata = {
  title: 'Scientific Publications | Publication MCP Studio',
  description:
    'Scientific publications rendered from markdown with math support, interactive modules, raw source access, and publication-grade presentation.',
}

export default async function PublicationsPage() {
  let publicationCards: Awaited<ReturnType<typeof listPublicationArticles>>['articles'] = []
  let error: Error | null = null

  try {
    publicationCards = (await listPublicationArticles({
      status: 'published',
      includeContent: true,
    })).articles
  } catch (nextError) {
    error = nextError instanceof Error ? nextError : new Error('Failed to load publications.')
  }

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
            Explore research articles published in a markdown-first format with polished human presentation, source transparency, math support, and richer interactive scientific blocks.
          </p>
        </div>

        {error ? (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
            Failed to load publications. Please try again later.
          </div>
        ) : publicationCards.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            No publications are available yet.
          </div>
        ) : (
          <PublicationsDirectory
            articles={publicationCards.map((article) => ({
              title: article.presentation.metadata.title || article.title,
              slug: article.slug,
              publishedLabel: article.presentation.publishedLabel,
              readingMinutes: article.presentation.readingMinutes,
              subtitle: article.presentation.metadata.subtitle,
              lead: article.presentation.lead,
              tags: article.presentation.metadata.tags,
              authors: article.presentation.metadata.authors,
              publicationLabel: article.presentation.metadata.publicationLabel,
            }))}
          />
        )}
      </div>
    </div>
  )
}
