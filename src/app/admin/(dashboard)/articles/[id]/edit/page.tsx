import ClientArticleEditor from '@/components/ClientArticleEditor'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  
  const supabase = await createServerSupabaseClient()
  const { data: article, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !article) {
    return notFound()
  }

  return (
    <div className="h-full min-h-0 bg-gray-50">
      <ClientArticleEditor initialArticle={article} />
    </div>
  )
}
