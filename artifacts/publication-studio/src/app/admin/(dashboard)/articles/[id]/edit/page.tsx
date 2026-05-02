import ClientArticleEditor from '@/components/ClientArticleEditor'
import { getPublicationPlatform } from '@/lib/publication-platform'
import { notFound } from 'next/navigation'

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const article = await getPublicationPlatform().publicationStore.getArticleByIdentifier(id)

  if (!article) {
    return notFound()
  }

  return (
    <div className="h-full min-h-0 bg-gray-50">
      <ClientArticleEditor initialArticle={article} />
    </div>
  )
}
