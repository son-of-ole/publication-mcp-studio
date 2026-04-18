import BalancedPublicationTitle from './BalancedPublicationTitle'
import { buildPublicationAuthorLinkItems, parsePublicationAuthorProfiles } from '@/lib/publications'

type PublicationHeroProps = {
  title: string
  publicationLabel?: string
  subtitle?: string
  abstract?: string
  authors?: string[]
  authorProfiles?: string[]
  affiliations?: string[]
  tags?: string[]
  doi?: string
  journal?: string
  repositoryUrl?: string
  repositoryLabel?: string
  publishedLabel?: string
  revisedLabel?: string
  readingMinutes?: number
  heroImage?: string
  heroVideo?: string
  heroPoster?: string
  heroCaption?: string
}

export default function PublicationHero({
  title,
  publicationLabel,
  subtitle,
  abstract,
  authors = [],
  authorProfiles = [],
  affiliations = [],
  tags = [],
  doi,
  journal,
  repositoryUrl,
  repositoryLabel,
  publishedLabel,
  revisedLabel,
  readingMinutes,
  heroImage,
  heroVideo,
  heroPoster,
  heroCaption,
}: PublicationHeroProps) {
  const resolvedAuthorProfiles = parsePublicationAuthorProfiles(authors, authorProfiles)

  return (
    <div className="rounded-[2rem] border border-white/70 bg-white/80 p-7 shadow-[0_28px_90px_rgba(15,23,42,0.08)] backdrop-blur sm:p-10">
      <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
        <span>{publicationLabel?.trim() || 'Scientific Publication'}</span>
        {readingMinutes ? (
          <>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>{readingMinutes} min read</span>
          </>
        ) : null}
        {publishedLabel ? (
          <>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>{publishedLabel}</span>
          </>
        ) : null}
      </div>

      <div className="mt-6 text-center">
        <BalancedPublicationTitle text={title} />
      </div>

      {subtitle ? (
        <p className="mx-auto mt-5 max-w-3xl text-center text-xl leading-8 text-slate-600">
          {subtitle}
        </p>
      ) : null}

      {resolvedAuthorProfiles.length > 0 ? (
        <div className="mx-auto mt-6 flex max-w-4xl flex-wrap justify-center gap-3">
          {resolvedAuthorProfiles.map((author) => {
            const links = buildPublicationAuthorLinkItems(author)
            const primaryLink = links.find((link) => link.label !== 'Email') ?? links[0]

            return (
              <div
                key={author.name}
                className="rounded-[1.2rem] border border-cyan-200 bg-cyan-50 px-4 py-3 text-center text-cyan-950"
              >
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {primaryLink ? (
                    <a
                      href={primaryLink.href}
                      target={primaryLink.href.startsWith('mailto:') ? undefined : '_blank'}
                      rel={primaryLink.href.startsWith('mailto:') ? undefined : 'noreferrer'}
                      className="text-sm font-semibold text-cyan-950 underline decoration-cyan-300 underline-offset-4 transition-colors hover:text-cyan-800"
                    >
                      {author.name}
                    </a>
                  ) : (
                    <div className="text-sm font-semibold">{author.name}</div>
                  )}
                </div>
                {links.length > 0 ? (
                  <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                    {links.map((link) => (
                      <a
                        key={`${author.name}-${link.label}-${link.href}`}
                        href={link.href}
                        target={link.href.startsWith('mailto:') ? undefined : '_blank'}
                        rel={link.href.startsWith('mailto:') ? undefined : 'noreferrer'}
                        className="rounded-full border border-cyan-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-800 transition-colors hover:border-cyan-400 hover:text-cyan-950"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {affiliations.length > 0 ? (
        <div className="mx-auto mt-4 max-w-3xl text-center text-sm leading-7 text-slate-500">
          {affiliations.join(' / ')}
        </div>
      ) : null}

      {abstract ? (
        <p className="mx-auto mt-8 max-w-3xl text-center text-lg leading-8 text-slate-600 sm:text-[1.2rem]">
          {abstract}
        </p>
      ) : null}

      {(journal || doi || revisedLabel || repositoryUrl) ? (
        <div className="mx-auto mt-7 flex max-w-4xl flex-wrap items-center justify-center gap-2 text-sm text-slate-500">
          {journal ? <span className="rounded-full bg-slate-100 px-3 py-1">{journal}</span> : null}
          {doi ? <span className="rounded-full bg-slate-100 px-3 py-1">DOI {doi}</span> : null}
          {revisedLabel ? <span className="rounded-full bg-slate-100 px-3 py-1">Revised {revisedLabel}</span> : null}
          {repositoryUrl ? (
            <a
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-slate-100 px-3 py-1 text-cyan-800 transition-colors hover:bg-cyan-50 hover:text-cyan-950"
            >
              {repositoryLabel?.trim() || 'GitHub Repository'}
            </a>
          ) : null}
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="mx-auto mt-6 flex max-w-4xl flex-wrap justify-center gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {heroVideo ? (
        <figure className="mt-10 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-slate-950 shadow-[0_30px_80px_rgba(15,23,42,0.16)]">
          <video
            controls
            playsInline
            preload="metadata"
            poster={heroPoster || undefined}
            className="block aspect-video w-full bg-slate-950"
            src={heroVideo}
          />
          {heroCaption ? (
            <figcaption className="border-t border-white/10 px-5 py-4 text-sm leading-6 text-slate-300">
              {heroCaption}
            </figcaption>
          ) : null}
        </figure>
      ) : heroImage ? (
        <figure className="mt-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImage}
            alt={heroCaption || title}
            className="block w-full rounded-[1.6rem] border border-slate-200 bg-slate-50 object-cover shadow-[0_24px_60px_rgba(15,23,42,0.08)]"
          />
          {heroCaption ? (
            <figcaption className="mt-4 text-center text-sm leading-6 text-slate-500">
              {heroCaption}
            </figcaption>
          ) : null}
        </figure>
      ) : null}
    </div>
  )
}
