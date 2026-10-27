'use client'

import { Suspense, lazy } from 'react'
import type { Article } from './ArticleEditor'

const ArticleEditor = lazy(() => import('./ArticleEditor'))

export default function ClientArticleEditor({ initialArticle }: { initialArticle?: Article }) {
  const articleKey = initialArticle
    ? `${initialArticle.id ?? 'article'}:${initialArticle.updated_at ?? 'unknown'}:${initialArticle.status}`
    : 'new-article'

  return (
    <Suspense fallback={
      <div className="flex h-full min-h-0 items-center justify-center bg-[#f4f8fb] px-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
          Loading publication workspace...
        </div>
      </div>
    }>
      <ArticleEditor key={articleKey} initialArticle={initialArticle} />
    </Suspense>
  )
}
