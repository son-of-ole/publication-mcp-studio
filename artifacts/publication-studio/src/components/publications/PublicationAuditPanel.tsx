'use client'

import { useState } from 'react'
import { Activity, Loader2, RefreshCw } from 'lucide-react'

type PublicationAuditEvent = {
  id: string
  action: string
  actor_label: string
  actor_type: string
  scopes: string[]
  route: string
  method: string
  article_id: string | null
  article_slug: string | null
  status: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export default function PublicationAuditPanel() {
  const [events, setEvents] = useState<PublicationAuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadEvents = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/publications/audit?limit=20')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load publication audit events.')
      }

      setEvents(Array.isArray(data.events) ? data.events : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publication audit events.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-slate-600">
            <Activity className="h-4 w-4 text-cyan-700" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em]">Audit Log</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">External Publication Activity</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Review recent article reads, writes, publishes, and AI draft requests coming through the tokenized API and
            MCP server.
          </p>
        </div>

        <button
          type="button"
          onClick={loadEvents}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Load Audit Events
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {events.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="max-h-[420px] overflow-y-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">When</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Actor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Article</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Scopes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="px-4 py-3 text-sm text-slate-600">{new Date(event.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-900">{event.action}</div>
                      <div className="text-xs text-slate-500">{event.method} {event.route}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-900">{event.actor_label}</div>
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{event.actor_type}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{event.article_slug || 'n/a'}</td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-[280px] flex-wrap gap-1.5">
                        {(event.scopes || []).map((scope) => (
                          <span
                            key={`${event.id}-${scope}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          Load the audit feed to review recent external publication activity.
        </div>
      )}
    </section>
  )
}
