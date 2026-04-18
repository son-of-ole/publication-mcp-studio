'use client'

import dynamic from 'next/dynamic'
import type { Article } from './ArticleEditor'

const ArticleEditor = dynamic(() => import('./ArticleEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-0 items-center justify-center bg-[#f4f8fb] px-6">
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
        Loading publication workspace...
      </div>
    </div>
  ),
})

export default function ClientArticleEditor({ initialArticle }: { initialArticle?: Article }) {
  return <ArticleEditor initialArticle={initialArticle} />
}
