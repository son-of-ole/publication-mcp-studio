'use client'

import { useState } from 'react'
import { Copy, KeyRound, Loader2, PlugZap } from 'lucide-react'

type PublicationAccessInfo = {
  mcpEndpoint: string
  restBaseUrl: string
  docsUrl: string
  signedTokensEnabled: boolean
  staticTokenConfigured: boolean
  defaultModel: string
  availableScopes: string[]
  availableSkills: PublicationSkillSummary[]
  connectorHealth: PublicationConnectorHealth[]
  tokens: PublicationTokenInventory[]
}

type PublicationIssuedToken = {
  tokenId: string
  token: string
  label: string
  issuedAt: string
  expiresAt: string
  scopes: string[]
}

type PublicationTokenInventory = {
  id: string
  label: string
  token_type: 'signed'
  scopes: string[]
  profile_id: string | null
  profile_label: string | null
  profile_enabled_skill_ids: string[]
  token_enabled_skill_ids: string[] | null
  allow_profile_skill_overrides: boolean
  issued_at: string
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  last_used_route: string | null
  last_used_method: string | null
}

type PublicationSkillSummary = {
  id: string
  label: string
  description: string
  status: 'experimental' | 'active' | 'deprecated' | 'disabled'
  category: string
  defaultEnablement: 'off' | 'read-only'
}

type PublicationConnectorHealth = {
  connectorId: string
  status: 'ready' | 'configured' | 'unconfigured' | 'degraded'
  summary: string
  configured: boolean
}

const DEFAULT_INFO: PublicationAccessInfo = {
  mcpEndpoint: '',
  restBaseUrl: '',
  docsUrl: '',
  signedTokensEnabled: false,
  staticTokenConfigured: false,
  defaultModel: 'openai/gpt-5-mini',
  availableScopes: [],
  availableSkills: [],
  connectorHealth: [],
  tokens: [],
}

const DEFAULT_SCOPES = ['mcp:connect', 'articles:read', 'articles:write', 'articles:publish', 'agent:generate']

export default function PublicationAccessPanel() {
  const [info, setInfo] = useState<PublicationAccessInfo>(DEFAULT_INFO)
  const [label, setLabel] = useState('Primary MCP Client')
  const [expiresInDays, setExpiresInDays] = useState('365')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(DEFAULT_SCOPES)
  const [profileLabel, setProfileLabel] = useState('Default Publication Agent')
  const [profileSkillIds, setProfileSkillIds] = useState<string[]>([])
  const [restrictTokenSkills, setRestrictTokenSkills] = useState(false)
  const [tokenSkillIds, setTokenSkillIds] = useState<string[]>([])
  const [allowProfileSkillOverrides, setAllowProfileSkillOverrides] = useState(false)
  const [issuedToken, setIssuedToken] = useState<PublicationIssuedToken | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [issuingToken, setIssuingToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [referenceNow, setReferenceNow] = useState(() => Date.now())

  const mcpConfig =
    info.mcpEndpoint && issuedToken?.token
      ? JSON.stringify(
          {
            mcpServers: {
              'publication-mcp-studio': {
                type: 'http',
                url: info.mcpEndpoint,
                headers: {
                  Authorization: `Bearer ${issuedToken.token}`,
                },
              },
            },
          },
          null,
          2
        )
      : ''

  const tokenWarnings = info.tokens.reduce(
    (acc, token) => {
      if (token.revoked_at) {
        acc.revoked += 1
        return acc
      }

      const expiresAt = new Date(token.expires_at).getTime()

      if (expiresAt <= referenceNow) {
        acc.expired += 1
      } else if (expiresAt - referenceNow <= 7 * 24 * 60 * 60 * 1000) {
        acc.expiringSoon += 1
      }

      return acc
    },
    { expiringSoon: 0, expired: 0, revoked: 0 }
  )

  const loadInfo = async () => {
    setLoadingInfo(true)
    setError(null)

    try {
      const response = await fetch('/api/publications/tokens', { method: 'GET' })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load publication access info.')
      }

      setInfo(data)
      setReferenceNow((prev) => prev + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publication access info.')
    } finally {
      setLoadingInfo(false)
    }
  }

  const issueToken = async () => {
    setIssuingToken(true)
    setError(null)

    try {
      const response = await fetch('/api/publications/tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label,
          expiresInDays: Number(expiresInDays),
          scopes: selectedScopes,
          profileLabel,
          profileEnabledSkillIds: profileSkillIds,
          tokenEnabledSkillIds: restrictTokenSkills ? tokenSkillIds : null,
          allowProfileSkillOverrides,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to issue publication token.')
      }

      setInfo((prev) => ({
        ...prev,
        mcpEndpoint: data.mcpEndpoint || prev.mcpEndpoint,
        restBaseUrl: data.restBaseUrl || prev.restBaseUrl,
        tokens: data.tokenRecord ? [data.tokenRecord, ...prev.tokens] : Array.isArray(data.tokens) ? data.tokens : prev.tokens,
      }))
      setIssuedToken(data.token)
      setReferenceNow((prev) => prev + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue publication token.')
    } finally {
      setIssuingToken(false)
    }
  }

  const revokeToken = async (tokenId: string) => {
    setError(null)

    try {
      const response = await fetch(`/api/publications/tokens/${tokenId}/revoke`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to revoke publication token.')
      }

      setInfo((prev) => ({
        ...prev,
        tokens: prev.tokens.map((token) => (token.id === tokenId ? data.token : token)),
      }))
      setReferenceNow((prev) => prev + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke publication token.')
    }
  }

  const copyText = async (value: string) => {
    if (!value) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError('Clipboard copy failed. You can still select and copy the text manually.')
    }
  }

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((entry) => entry !== scope) : [...prev, scope]
    )
  }

  const toggleProfileSkill = (skillId: string) => {
    setProfileSkillIds((prev) => {
      const next = prev.includes(skillId) ? prev.filter((entry) => entry !== skillId) : [...prev, skillId]

      if (!allowProfileSkillOverrides) {
        setTokenSkillIds((current) => current.filter((entry) => next.includes(entry)))
      }

      return next
    })
  }

  const toggleTokenSkill = (skillId: string) => {
    setTokenSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((entry) => entry !== skillId) : [...prev, skillId]
    )
  }

  const availableTokenSkillIds = allowProfileSkillOverrides
    ? info.availableSkills.map((skill) => skill.id)
    : profileSkillIds

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-700">
            <PlugZap className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em]">MCP Access</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">External Agent Connection</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            The MCP endpoint is always on. This panel is only for minting access tokens and copying the connection
            details external agents need to draft, update, and publish articles directly.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-6 text-slate-500">
            Long-lived external plugins should usually use a 365-day token and be rotated intentionally.
          </p>
        </div>

        <button
          type="button"
          onClick={loadInfo}
          disabled={loadingInfo}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-white px-4 py-2 text-sm font-medium text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100 disabled:opacity-60"
        >
          {loadingInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Load Access Details
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {(info.mcpEndpoint || loadingInfo) && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4 rounded-2xl border border-white/70 bg-white/80 p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">MCP Endpoint</div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-cyan-100">
                  {info.mcpEndpoint || 'Loading...'}
                </code>
                <button
                  type="button"
                  onClick={() => copyText(info.mcpEndpoint)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Signed Tokens</div>
                <div className="mt-2 text-sm text-slate-800">{info.signedTokensEnabled ? 'Enabled' : 'Not configured'}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Default Model</div>
                <div className="mt-2 text-sm text-slate-800">{info.defaultModel}</div>
              </div>
            </div>

            {info.availableSkills.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Installed Skills</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {info.availableSkills.map((skill) => (
                    <div key={skill.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">{skill.label}</div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600">
                          {skill.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{skill.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {info.connectorHealth.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Connector Readiness</div>
                <div className="mt-3 space-y-2">
                  {info.connectorHealth.map((connector) => (
                    <div key={connector.connectorId} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-slate-900">{connector.connectorId}</div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600">
                          {connector.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{connector.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(tokenWarnings.expiringSoon > 0 || tokenWarnings.expired > 0) ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Token Warnings</div>
                <div className="mt-2 text-sm text-amber-900">
                  {tokenWarnings.expired > 0 ? `${tokenWarnings.expired} token(s) already expired. ` : ''}
                  {tokenWarnings.expiringSoon > 0 ? `${tokenWarnings.expiringSoon} token(s) expire within 7 days.` : ''}
                </div>
              </div>
            ) : null}

            {issuedToken ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Issued Token</div>
                    <p className="mt-2 text-sm text-emerald-900">
                      Expires {new Date(issuedToken.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(issuedToken.token)}
                    className="rounded-xl border border-emerald-200 bg-white p-2 text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-900"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>

                <code className="mt-3 block overflow-x-auto rounded-xl bg-emerald-950 px-3 py-3 text-xs text-emerald-100">
                  {issuedToken.token}
                </code>

                <div className="mt-3 flex flex-wrap gap-2">
                  {issuedToken.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {mcpConfig ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Example MCP Config</div>
                <div className="flex items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto rounded-2xl bg-slate-950 px-4 py-4 text-xs leading-6 text-cyan-100">
                    {mcpConfig}
                  </pre>
                  <button
                    type="button"
                    onClick={() => copyText(mcpConfig)}
                    className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}

            {info.tokens.length > 0 ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Issued Tokens</div>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="max-h-[320px] overflow-y-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Client</th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Last Used</th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {info.tokens.map((token) => (
                          <tr key={token.id}>
                            <td className="px-3 py-3 align-top">
                              <div className="text-sm font-medium text-slate-900">{token.label}</div>
                              <div className="mt-1 text-[11px] text-slate-500">{token.id}</div>
                              <div className="mt-2 flex max-w-[280px] flex-wrap gap-1.5">
                                {token.scopes.map((scope) => (
                                  <span
                                    key={`${token.id}-${scope}`}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700"
                                  >
                                    {scope}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-2 text-[11px] text-slate-500">
                                Profile: {token.profile_label || 'Unscoped profile'}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                Skills: {(token.token_enabled_skill_ids ?? token.profile_enabled_skill_ids).length > 0
                                  ? (token.token_enabled_skill_ids ?? token.profile_enabled_skill_ids).join(', ')
                                  : 'Core only'}
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top text-sm text-slate-600">
                              <div className={token.revoked_at ? 'text-red-700' : isTokenExpiringSoon(token) ? 'text-amber-700' : 'text-emerald-700'}>
                                {token.revoked_at
                                  ? 'Revoked'
                                  : isTokenExpired(token)
                                    ? 'Expired'
                                    : isTokenExpiringSoon(token)
                                      ? 'Expiring Soon'
                                      : 'Active'}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                Expires {new Date(token.expires_at).toLocaleString()}
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top text-sm text-slate-600">
                              {token.last_used_at ? (
                                <>
                                  <div>{new Date(token.last_used_at).toLocaleString()}</div>
                                  <div className="mt-1 text-[11px] text-slate-500">
                                    {token.last_used_method} {token.last_used_route}
                                  </div>
                                </>
                              ) : (
                                <span className="text-[11px] text-slate-500">Not used yet</span>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top text-right">
                              <button
                                type="button"
                                disabled={Boolean(token.revoked_at)}
                                onClick={() => revokeToken(token.id)}
                                className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:border-red-300 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {token.revoked_at ? 'Revoked' : 'Revoke'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/70 bg-white/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Mint New Token</div>

            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Label</label>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400"
              placeholder="Primary MCP Client"
            />

            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Expires In</label>
            <select
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400"
            >
              <option value="365">365 days</option>
              <option value="90">90 days</option>
              <option value="30">30 days</option>
              <option value="7">7 days</option>
            </select>

            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Scopes</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(info.availableScopes.length ? info.availableScopes : DEFAULT_SCOPES).map((scope) => {
                  const selected = selectedScopes.includes(scope)

                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggleScope(scope)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? 'border-cyan-400 bg-cyan-100 text-cyan-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {scope}
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Profile Label</label>
            <input
              type="text"
              value={profileLabel}
              onChange={(event) => setProfileLabel(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400"
              placeholder="Default Publication Agent"
            />

            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Profile Skills</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Skills stay advisory and agent-first. Leave everything off for a core-only token.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {info.availableSkills.map((skill) => {
                  const selected = profileSkillIds.includes(skill.id)

                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleProfileSkill(skill.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? 'border-cyan-400 bg-cyan-100 text-cyan-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {skill.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={restrictTokenSkills}
                onChange={(event) => setRestrictTokenSkills(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-700 focus:ring-cyan-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">Restrict This Token Further</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  Leave this off to inherit the full profile skill set.
                </span>
              </span>
            </label>

            <label className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={allowProfileSkillOverrides}
                onChange={(event) => {
                  const next = event.target.checked
                  setAllowProfileSkillOverrides(next)
                  if (!next) {
                    setTokenSkillIds((prev) => prev.filter((skillId) => profileSkillIds.includes(skillId)))
                  }
                }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-700 focus:ring-cyan-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">Allow Token Overrides</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  When enabled, token skill selections may diverge from the profile defaults instead of only narrowing them.
                </span>
              </span>
            </label>

            {restrictTokenSkills ? (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Token Skill Restrictions</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {info.availableSkills.map((skill) => {
                    const selectable = availableTokenSkillIds.includes(skill.id)
                    const selected = tokenSkillIds.includes(skill.id)

                    return (
                      <button
                        key={`token-${skill.id}`}
                        type="button"
                        disabled={!selectable}
                        onClick={() => toggleTokenSkill(skill.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          selected
                            ? 'border-cyan-400 bg-cyan-100 text-cyan-900'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {skill.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={issueToken}
              disabled={issuingToken || selectedScopes.length === 0}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-cyan-800 disabled:opacity-60"
            >
              {issuingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {issuingToken ? 'Issuing Token...' : 'Issue Access Token'}
            </button>

            <p className="mt-4 text-xs leading-6 text-slate-500">
              External agents connect straight to the MCP endpoint with this bearer token. They do not need the browser
              editor open.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function isTokenExpired(token: PublicationTokenInventory) {
  return !token.revoked_at && new Date(token.expires_at).getTime() <= Date.now()
}

function isTokenExpiringSoon(token: PublicationTokenInventory) {
  if (token.revoked_at) {
    return false
  }

  const expiresAt = new Date(token.expires_at).getTime()
  const now = Date.now()
  return expiresAt > now && expiresAt - now <= 7 * 24 * 60 * 60 * 1000
}
