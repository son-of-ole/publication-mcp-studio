'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'

type ReadinessCheck = {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

type ProductionReadinessReport = {
  ready: boolean
  summary: {
    pass: number
    warn: number
    fail: number
  }
  environment: {
    nodeEnv: string
    vercelEnv: string
  }
  checks: ReadinessCheck[]
}

export default function ProductionReadinessPanel() {
  const [report, setReport] = useState<ProductionReadinessReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReport = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/production-readiness')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load production readiness report.')
      }

      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load production readiness report.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-slate-600">
            <ShieldCheck className="h-4 w-4 text-cyan-700" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em]">Deployment Readiness</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Production Readiness Report</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Validate the Vercel and Supabase configuration needed to run publications, MCP access, token inventory,
            and article versioning safely in production.
          </p>
        </div>

        <button
          type="button"
          onClick={loadReport}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Run Readiness Check
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {report ? (
        <div className="mt-5 space-y-4">
          <div className={`rounded-2xl border px-4 py-4 ${report.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-center gap-2">
              {report.ready ? <ShieldCheck className="h-5 w-5 text-emerald-700" /> : <ShieldAlert className="h-5 w-5 text-amber-700" />}
              <div className={`text-sm font-semibold ${report.ready ? 'text-emerald-900' : 'text-amber-900'}`}>
                {report.ready ? 'Production-ready baseline checks passed.' : 'Production readiness needs attention before deploy.'}
              </div>
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {report.summary.pass} pass, {report.summary.warn} warning, {report.summary.fail} fail
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Environment: `NODE_ENV={report.environment.nodeEnv}`, `VERCEL_ENV={report.environment.vercelEnv}`
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Check</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {report.checks.map((check) => (
                  <tr key={check.key}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{check.label}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                        check.status === 'pass'
                          ? 'bg-emerald-100 text-emerald-800'
                          : check.status === 'warn'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                      }`}>
                        {check.status === 'pass' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
                        {check.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          Run the readiness report before pushing the production deploy.
        </div>
      )}
    </section>
  )
}
