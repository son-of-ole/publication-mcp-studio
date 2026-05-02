import type { PublicationHeading } from '@/lib/publications'

export default function PublicationTableOfContents({
  headings,
}: {
  headings: PublicationHeading[]
}) {
  if (headings.length === 0) {
    return null
  }

  return (
    <div className="rounded-[1.6rem] border border-slate-200 bg-white/88 p-5 shadow-[0_20px_70px_rgba(15,23,42,0.07)] backdrop-blur">
      <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">On This Page</div>
      <nav className="mt-4 space-y-2">
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            className={`block rounded-xl px-3 py-2 text-sm leading-6 text-slate-600 transition hover:bg-cyan-50 hover:text-cyan-800 ${
              heading.level === 3 ? 'ml-3' : heading.level >= 4 ? 'ml-6 text-xs' : ''
            }`}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </div>
  )
}
