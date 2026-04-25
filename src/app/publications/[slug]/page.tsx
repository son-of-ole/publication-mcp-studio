import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileCode2 } from 'lucide-react'
import { getPublicationPlatform } from '@/lib/publication-platform'
import CopyMarkdownButton from '@/components/CopyMarkdownButton'
import PublicationHero from '@/components/publications/PublicationHero'
import PublicationRenderer from '@/components/publications/PublicationRenderer'
import PublicationTableOfContents from '@/components/publications/PublicationTableOfContents'
import { assertPublicationAdminSession } from '@/lib/publication-admin'
import { extractPublicationHeadings, formatPublicationDate, getPublicationPresentation } from '@/lib/publications'

export const revalidate = 60
const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://your-domain.example'

async function getArticleBySlug(slug: string) {
  return getPublicationPlatform().publicationStore.getArticleByIdentifier(slug)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticleBySlug(slug)

  if (!article) {
    return {
      title: 'Publication Not Found | Publication MCP Studio',
    }
  }

  if (article.status !== 'published') {
    return {
      title: 'Publication Draft | Publication MCP Studio',
      robots: {
        index: false,
        follow: false,
      },
    }
  }

  const presentation = getPublicationPresentation(article.title, article.content_markdown, article.created_at)
  const title = presentation.metadata.title || article.title
  const description = presentation.metadata.abstract || presentation.lead
  const canonical = presentation.metadata.canonicalUrl || `${PUBLIC_SITE_URL}/publications/${article.slug}`
  const revisedTime = presentation.metadata.revised || article.updated_at || article.created_at

  return {
    title: `${title} | Publication MCP Studio`,
    description,
    keywords: presentation.metadata.tags,
    alternates: {
      canonical,
    },
    openGraph: {
      type: 'article',
      title,
      description,
      url: canonical,
      publishedTime: article.created_at ?? undefined,
      modifiedTime: revisedTime ?? undefined,
      authors: presentation.metadata.authors,
      tags: presentation.metadata.tags,
      images: presentation.metadata.heroImage ? [{ url: presentation.metadata.heroImage }] : undefined,
      videos: presentation.metadata.heroVideo ? [{ url: presentation.metadata.heroVideo }] : undefined,
    },
    twitter: {
      card: presentation.metadata.heroImage ? 'summary_large_image' : 'summary',
      title,
      description,
      images: presentation.metadata.heroImage ? [presentation.metadata.heroImage] : undefined,
    },
    robots: article.status === 'published' ? undefined : { index: false, follow: false },
  }
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const article = await getArticleBySlug(slug)

  if (!article) {
    return notFound()
  }

  if (article.status !== 'published') {
    const user = await assertPublicationAdminSession('view draft publications').catch(() => null)
    if (!user) {
      return notFound()
    }
  }

  const presentation = getPublicationPresentation(article.title, article.content_markdown, article.created_at)
  const headings = extractPublicationHeadings(article.content_markdown)
  const revisedLabel = presentation.metadata.revised
    ? formatPublicationDate(presentation.metadata.revised)
    : ''
  const canonical = presentation.metadata.canonicalUrl || `${PUBLIC_SITE_URL}/publications/${article.slug}`
  const relatedArticles = (await getPublicationPlatform().publicationStore.listArticles({
    status: 'published',
    limit: 12,
  })).filter((entry) => entry.slug !== article.slug)

  const relatedPublications =
    relatedArticles
      .map((entry) => {
        const relatedPresentation = getPublicationPresentation(entry.title, entry.content_markdown, entry.created_at)
        const sharedTags = relatedPresentation.metadata.tags.filter((tag) =>
          presentation.metadata.tags.includes(tag)
        )

        return {
          slug: entry.slug,
          title: relatedPresentation.metadata.title || entry.title,
          lead: relatedPresentation.lead,
          publishedLabel: relatedPresentation.publishedLabel,
          sharedTags,
          score: sharedTags.length,
        }
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: presentation.metadata.title || article.title,
    description: presentation.metadata.abstract || presentation.lead,
    abstract: presentation.metadata.abstract || presentation.lead,
    author: presentation.metadata.authors.map((name) => ({
      '@type': 'Person',
      name,
    })),
    datePublished: article.created_at ?? undefined,
    dateModified: presentation.metadata.revised || article.updated_at || article.created_at || undefined,
    image: presentation.metadata.heroImage || undefined,
    url: canonical,
    keywords: presentation.metadata.tags.join(', ') || undefined,
    identifier: presentation.metadata.doi || undefined,
    isPartOf: presentation.metadata.journal
                  ? {
          '@type': 'PublicationIssue',
          name: presentation.metadata.journal,
        }
      : undefined,
  }

  return (
    <article className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f5fbff_0%,#ffffff_28%,#f8fafc_100%)] text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-24 h-72 w-72 rounded-full bg-cyan-200/35 blur-3xl" />
        <div className="absolute right-[-6rem] top-48 h-80 w-80 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="absolute bottom-16 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-100/45 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-24 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
          <div>
            <div>
              <Link
                href="/publications"
                className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-cyan-700"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Publications
              </Link>

              <PublicationHero
                title={presentation.metadata.title || article.title}
                publicationLabel={presentation.metadata.publicationLabel}
                subtitle={presentation.metadata.subtitle}
                abstract={presentation.metadata.abstract || presentation.lead}
                authors={presentation.metadata.authors}
                authorProfiles={presentation.metadata.authorProfiles}
                affiliations={presentation.metadata.affiliations}
                tags={presentation.metadata.tags}
                doi={presentation.metadata.doi}
                journal={presentation.metadata.journal}
                repositoryUrl={presentation.metadata.repositoryUrl}
                repositoryLabel={presentation.metadata.repositoryLabel}
                publishedLabel={presentation.publishedLabel}
                revisedLabel={revisedLabel}
                readingMinutes={presentation.readingMinutes}
                heroImage={presentation.metadata.heroImage}
                heroVideo={presentation.metadata.heroVideo}
                heroPoster={presentation.metadata.heroPoster}
                heroCaption={presentation.metadata.heroCaption}
              />
            </div>

            <div className="mt-10 rounded-[2rem] border border-slate-200 bg-white/92 px-6 py-8 shadow-[0_28px_90px_rgba(15,23,42,0.08)] sm:px-10 sm:py-10">
              <PublicationRenderer markdown={article.content_markdown} />
            </div>

            {relatedPublications.length > 0 ? (
              <section className="mt-10 rounded-[2rem] border border-slate-200 bg-white/92 px-6 py-8 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:px-8">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Related Reading</div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {relatedPublications.map((related) => (
                    <Link
                      key={related.slug}
                      href={`/publications/${related.slug}`}
                      className="rounded-[1.4rem] border border-slate-200 bg-white p-4 transition hover:border-cyan-200 hover:shadow-[0_16px_40px_rgba(14,116,144,0.12)]"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {related.publishedLabel}
                      </div>
                      <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-950">{related.title}</h2>
                      <p className="mt-3 text-sm leading-7 text-slate-600">{related.lead}</p>
                      {related.sharedTags.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {related.sharedTags.map((tag) => (
                            <span
                              key={`${related.slug}-${tag}`}
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="space-y-5 self-start lg:sticky lg:top-24">
            <PublicationTableOfContents headings={headings} />

            <div className="rounded-[1.6rem] border border-slate-200 bg-white/88 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                Source Access
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <CopyMarkdownButton markdown={article.content_markdown} />
                <Link
                  href={`/publications/${article.slug}/raw`}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:text-cyan-800"
                >
                  <FileCode2 className="h-4 w-4" />
                  Open Raw Markdown
                </Link>
                {presentation.metadata.repositoryUrl ? (
                  <a
                    href={presentation.metadata.repositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:text-cyan-800"
                  >
                    {presentation.metadata.repositoryLabel?.trim() || 'Open GitHub Repository'}
                  </a>
                ) : null}
              </div>

              <div className="mt-6 rounded-[1.2rem] bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                Published articles keep their markdown source intact so readers and downstream agents can review or reuse the original text.
              </div>

              <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-600">
                Canonical URL
                <div className="mt-2 break-all text-cyan-800">{canonical}</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </article>
  )
}
