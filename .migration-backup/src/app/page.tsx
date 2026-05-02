import Link from 'next/link'
import { BookOpenText, FilePenLine, PlugZap } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5fbff_0%,#f8fafc_35%,#ffffff_100%)] px-4 pb-20 pt-24">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-[0_28px_90px_rgba(15,23,42,0.08)] backdrop-blur sm:p-10">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-700">Portable Publication Stack</div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
            A standalone scientific publication system with MCP built in.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
            Publish markdown-first scientific articles with polished public presentation, media storage, tokens, audit logs,
            version history, and an always-on MCP endpoint for external agents.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/publications"
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-cyan-800"
            >
              <BookOpenText className="h-4 w-4" />
              Explore Publications
            </Link>
            <Link
              href="/admin/articles"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
            >
              <FilePenLine className="h-4 w-4" />
              Open Admin Workspace
            </Link>
            <Link
              href="/api/publications/mcp/health"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
            >
              <PlugZap className="h-4 w-4" />
              MCP Health
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
