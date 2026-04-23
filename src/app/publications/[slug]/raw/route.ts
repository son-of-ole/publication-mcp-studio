import { getPublicationPlatform } from '@publication-platform'
import { assertPublicationAdminSession } from '@/lib/publication-admin'

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const article = await getPublicationPlatform().publicationStore.getArticleByIdentifier(slug)

  if (!article) {
    return new Response('Not found', { status: 404 })
  }

  if (article.status !== 'published') {
    const user = await assertPublicationAdminSession('view draft markdown').catch(() => null)
    if (!user) {
      return new Response('Not found', { status: 404 })
    }
  }

  const fileName = `${slug}.md`

  return new Response(article.content_markdown, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `inline; filename="${fileName}"`,
      'x-publication-title': encodeURIComponent(article.title),
    },
  })
}
