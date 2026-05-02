'use client'

// Link replaced by <a> or useLocation
import { useMemo, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'

type PublicationDirectoryItem = {
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

export default function PublicationsDirectory({
  articles,
}: {
  articles: PublicationDirectoryItem[]
}) {
  const [query, setQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string>('All')

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const article of articles) {
      for (const tag of article.tags) {
        tags.add(tag)
      }
    }

    return ['All', ...[...tags].sort((left, right) => left.localeCompare(right))]
  }, [articles])

  const filteredArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return articles.filter((article) => {
      const tagMatch = selectedTag === 'All' || article.tags.includes(selectedTag)

      if (!tagMatch) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      const haystack = [
        article.title,
        article.subtitle,
        article.lead,
        article.publicationLabel,
        article.tags.join(' '),
        article.authors.join(' '),
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [articles, query, selectedTag])

  const featured = filteredArticles[0] ?? null
  const remaining = featured ? filteredArticles.slice(1) : []

  return (
    <div className="mt-10 space-y-8">
      <section className="rounded-[1.8rem] border border-slate-200 bg-white/92 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, author, tag, or topic"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-11 py-3.5 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:bg-white"
            />
          </div>

          <div className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-900">{filteredArticles.length}</span> publication{filteredArticles.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {allTags.map((tag) => {
            const active = selectedTag === tag

            return (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                  active
                    ? 'border-cyan-300 bg-cyan-100 text-cyan-900'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                {tag}
              </button>
            )
          })}
        </div>
      </section>

      {featured ? (
        <a
          href={`/publications/${featured.slug}`}
          className="group block overflow-hidden rounded-[2rem] border border-slate-200 bg-white/95 shadow-[0_26px_80px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_34px_90px_rgba(8,145,178,0.14)]"
        >
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_320px]">
            <div className="p-7 sm:p-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-700">
                Latest Publication
              </div>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                {featured.publicationLabel || 'Scientific Publication'} / {featured.publishedLabel} / {featured.readingMinutes} min read
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 transition-colors group-hover:text-cyan-800 sm:text-4xl">
                {featured.title}
              </h2>
              {featured.subtitle ? (
                <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">{featured.subtitle}</p>
              ) : null}
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">{featured.lead}</p>

              {featured.authors.length > 0 ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {featured.authors.map((author) => (
                    <span
                      key={`${featured.slug}-${author}`}
                      className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm font-medium text-cyan-900"
                    >
                      {author}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col justify-between gap-6 border-t border-slate-200 bg-[linear-gradient(180deg,#effcff_0%,#f8fafc_100%)] p-7 lg:border-l lg:border-t-0">
              <div className="flex flex-wrap gap-2">
                {featured.tags.map((tag) => (
                  <span
                    key={`${featured.slug}-featured-${tag}`}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-800"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-[1.4rem] border border-white/80 bg-white/90 px-5 py-4 shadow-sm">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Open publication</div>
                  <div className="mt-2 text-sm text-slate-600">Read the full article, source, math, and interactive blocks.</div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-600 text-white">
                  <ArrowRight className="h-5 w-5" />
                </div>
              </div>
            </div>
          </div>
        </a>
      ) : null}

      {remaining.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {remaining.map((article) => (
            <a
              key={article.slug}
              href={`/publications/${article.slug}`}
              className="group rounded-[1.75rem] border border-slate-200 bg-white/92 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_28px_80px_rgba(14,116,144,0.14)]"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                {article.publicationLabel || 'Scientific Publication'} / {article.publishedLabel} / {article.readingMinutes} min read
              </div>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 transition-colors group-hover:text-cyan-800">
                {article.title}
              </h3>
              {article.subtitle ? (
                <p className="mt-3 text-base leading-7 text-slate-600">{article.subtitle}</p>
              ) : null}
              <p className="mt-3 text-sm leading-7 text-slate-600">{article.lead}</p>

              {article.tags.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {article.tags.slice(0, 5).map((tag) => (
                    <span
                      key={`${article.slug}-${tag}`}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </a>
          ))}
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No published articles match your search yet.
        </div>
      ) : null}
    </div>
  )
}
