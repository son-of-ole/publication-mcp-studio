import { BookOpenText } from 'lucide-react'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-20 pt-24">
      <section className="mx-auto max-w-5xl rounded-3xl bg-white p-8 shadow-sm sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-widest text-cyan-700">Publications</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Research, evidence and ideas.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">Explore published articles with full text, figures and references. Every article is also available as a complete Markdown document.</p>
        <a href="/publications" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-5 py-3 font-medium text-white hover:bg-cyan-800">
          <BookOpenText className="h-4 w-4" /> Explore Publications
        </a>
      </section>
    </main>
  )
}
