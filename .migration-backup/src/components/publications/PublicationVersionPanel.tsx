'use client'

import { useMemo, useState } from 'react'
import { Diff, History, Loader2, RotateCcw } from 'lucide-react'

type PublicationVersionRecord = {
  id: string
  version_number: number
  source_action: string
  title: string
  slug: string
  content_markdown: string
  status: 'draft' | 'published'
  actor_label: string | null
  actor_type: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

type RestoredArticle = {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
  contentMarkdown?: string
}

export default function PublicationVersionPanel({
  identifier,
  currentMarkdown,
  onRestore,
}: {
  identifier: string
  currentMarkdown: string
  onRestore?: (article: RestoredArticle, restoredFromVersionNumber: number) => void
}) {
  const [versions, setVersions] = useState<PublicationVersionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? versions[0] ?? null,
    [selectedVersionId, versions]
  )

  const diffPreview = useMemo(() => {
    if (!selectedVersion) {
      return null
    }

    return buildDiffPreview(currentMarkdown, selectedVersion.content_markdown)
  }, [currentMarkdown, selectedVersion])

  const loadVersions = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/publications/articles/${identifier}/versions`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load article version history.')
      }

      const nextVersions = Array.isArray(data.versions) ? data.versions : []
      setVersions(nextVersions)
      setSelectedVersionId((prev) => prev ?? nextVersions[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load article version history.')
    } finally {
      setLoading(false)
    }
  }

  const restoreVersion = async (versionId: string, versionNumber: number) => {
    const confirmed = window.confirm(
      `Restore version ${versionNumber}? Any unsaved changes in the editor will be replaced by the selected snapshot.`
    )

    if (!confirmed) {
      return
    }

    setRestoringVersionId(versionId)
    setError(null)

    try {
      const response = await fetch(`/api/publications/articles/${identifier}/versions/${versionId}/restore`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to restore article version.')
      }

      await loadVersions()
      if (data.article) {
        onRestore?.(data.article, data.restoredFromVersion?.version_number ?? versionNumber)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore article version.')
    } finally {
      setRestoringVersionId(null)
    }
  }

  return (
    <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50/80 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-amber-200 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-amber-700">
            <History className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em]">Version History</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Recover Earlier Article Snapshots</h2>
        </div>

        <button
          type="button"
          onClick={loadVersions}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
          Load Versions
        </button>
      </div>

      <div className="p-5">
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

        {versions.length > 0 ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
              <div className="max-h-[300px] overflow-y-auto">
                <table className="min-w-full divide-y divide-amber-100">
                  <thead className="sticky top-0 bg-amber-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Version</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Saved</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Source</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 bg-white">
                    {versions.map((version) => {
                      const isSelected = selectedVersion?.id === version.id

                      return (
                        <tr
                          key={version.id}
                          className={isSelected ? 'bg-amber-50/60' : ''}
                          onClick={() => setSelectedVersionId(version.id)}
                        >
                          <td className="px-4 py-3 text-sm text-slate-900">
                            <div className="font-medium">v{version.version_number}</div>
                            <div className="text-xs text-slate-500">{version.status}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            <div>{new Date(version.created_at).toLocaleString()}</div>
                            <div className="text-xs text-slate-500">{version.actor_label || 'Unknown actor'}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            <div>{version.source_action}</div>
                            <div className="text-xs text-slate-500">{version.actor_type || 'system'}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedVersionId(version.id)}
                                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                                  isSelected
                                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                                    : 'border-amber-200 bg-white text-amber-800 hover:border-amber-300 hover:text-amber-900'
                                }`}
                              >
                                <Diff className="h-3.5 w-3.5" />
                                Preview
                              </button>
                              <button
                                type="button"
                                onClick={() => restoreVersion(version.id, version.version_number)}
                                disabled={restoringVersionId === version.id}
                                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-800 transition hover:border-amber-300 hover:text-amber-900 disabled:opacity-60"
                              >
                                {restoringVersionId === version.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                                Restore
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedVersion && diffPreview ? (
              <div className="rounded-2xl border border-amber-200 bg-white p-4">
                <div className="flex items-center gap-2 text-amber-700">
                  <Diff className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-[0.2em]">Diff Preview</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Comparing your current editor state against version {selectedVersion.version_number}.
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Changed Lines</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{diffPreview.changedLines}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Added In Current</div>
                    <div className="mt-2 text-lg font-semibold text-emerald-900">{diffPreview.addedLines}</div>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Missing From Current</div>
                    <div className="mt-2 text-lg font-semibold text-rose-900">{diffPreview.removedLines}</div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current-only Lines</div>
                    <div className="max-h-[220px] overflow-y-auto rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      {diffPreview.addedPreview.length > 0 ? (
                        <ul className="space-y-2 text-sm text-emerald-950">
                          {diffPreview.addedPreview.map((line, index) => (
                            <li key={`current-${index}`} className="rounded-lg bg-white/80 px-3 py-2 font-mono text-xs">
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-emerald-800">No extra lines in the current editor content.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Version-only Lines</div>
                    <div className="max-h-[220px] overflow-y-auto rounded-xl border border-rose-200 bg-rose-50 p-3">
                      {diffPreview.removedPreview.length > 0 ? (
                        <ul className="space-y-2 text-sm text-rose-950">
                          {diffPreview.removedPreview.map((line, index) => (
                            <li key={`version-${index}`} className="rounded-lg bg-white/80 px-3 py-2 font-mono text-xs">
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-rose-800">No missing lines from the selected version.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-amber-200 bg-white px-4 py-5 text-sm text-slate-500">
            Load versions to inspect or restore earlier saved article states.
          </div>
        )}
      </div>
    </section>
  )
}

function buildDiffPreview(currentMarkdown: string, versionMarkdown: string) {
  const currentLines = normalizeLines(currentMarkdown)
  const versionLines = normalizeLines(versionMarkdown)
  const currentSet = new Set(currentLines)
  const versionSet = new Set(versionLines)

  const added = currentLines.filter((line) => line && !versionSet.has(line))
  const removed = versionLines.filter((line) => line && !currentSet.has(line))

  return {
    changedLines: added.length + removed.length,
    addedLines: added.length,
    removedLines: removed.length,
    addedPreview: added.slice(0, 8),
    removedPreview: removed.slice(0, 8),
  }
}

function normalizeLines(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
