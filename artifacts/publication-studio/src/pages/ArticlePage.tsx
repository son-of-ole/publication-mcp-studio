import { useEffect, useState } from 'react'
import { publicationMarkdownWithAttachments } from '@publication-mcp-studio/platform/attachments'
import { readPublicBootstrap } from '@/lib/public-bootstrap'
import type { PublicationArticleRecord } from '@publication-mcp-studio/platform/types'
import { useParams } from 'wouter'
import { ArrowLeft, FileCode2 } from 'lucide-react'
import CopyMarkdownButton from '@/components/CopyMarkdownButton'
import PublicationHero from '@/components/publications/PublicationHero'
import PublicationRenderer from '@/components/publications/PublicationRenderer'
import PublicationTableOfContents from '@/components/publications/PublicationTableOfContents'
import { extractPublicationHeadings, getPublicationPresentation } from '@/lib/publications'

export default function ArticlePage() {
  const { slug } = useParams<{ slug: string }>()
  const initial = readPublicBootstrap()
  const initialArticle = initial?.kind === 'article' && initial.article.slug === slug ? initial.article : null
  const [article, setArticle] = useState<PublicationArticleRecord | null>(initialArticle)
  const [loading, setLoading] = useState(!initialArticle)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug || initialArticle) return
    fetch(`/content/articles/${slug}?includeContent=true`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Article not found')
        return data
      })
      .then((data) => setArticle(data.article))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug, initialArticle])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-slate-500">Loading article...</div>
      </div>
    )
  }

  if (error || !article) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500">{error || 'Article not found'}</p>
          <a href="/publications" className="mt-4 block text-cyan-700 hover:underline">
            Back to publications
          </a>
        </div>
      </div>
    )
  }

  return <ArticleView article={article} />
}

export function ArticleView({ article }: { article: PublicationArticleRecord }) {
  const [showSource, setShowSource] = useState(false)
  const contentMarkdown = publicationMarkdownWithAttachments(article)
  const presentation = getPublicationPresentation(article.title, contentMarkdown, article.createdAt)
  const headings = extractPublicationHeadings(contentMarkdown)

  return (
    <article className="min-h-screen bg-white">
      <PublicationHero
        {...presentation.metadata}
        title={presentation.metadata.title || article.title}
        publishedLabel={presentation.publishedLabel}
        readingMinutes={presentation.readingMinutes}
      />

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-8">
          <a href="/publications" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft className="h-4 w-4" />
            All Publications
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/publications/${encodeURIComponent(article.slug)}.md`} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Markdown</a>
            <CopyMarkdownButton markdown={contentMarkdown} />
            <button
              onClick={() => setShowSource(!showSource)}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <FileCode2 className="h-3.5 w-3.5" />
              {showSource ? 'Rendered' : 'Source'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_220px]">
          <main>
            {showSource ? (
              <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-6 text-xs text-slate-700 font-mono leading-relaxed overflow-x-auto">
                {contentMarkdown}
              </pre>
            ) : (
              <PublicationRenderer markdown={contentMarkdown} />
            )}
          </main>

          {headings.length > 0 && !showSource && (
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <PublicationTableOfContents headings={headings} />
              </div>
            </aside>
          )}
        </div>
      </div>
    </article>
  )
}
