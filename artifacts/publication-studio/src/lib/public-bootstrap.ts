import type { PublicationArticleRecord } from '@publication-mcp-studio/platform/types'

export type PublicBootstrap = { kind: 'article'; article: PublicationArticleRecord } | { kind: 'directory'; articles: PublicationArticleRecord[] }

let bootstrap: PublicBootstrap | null | undefined
export function readPublicBootstrap(): PublicBootstrap | null {
  if (typeof document === 'undefined') return null
  if (bootstrap !== undefined) return bootstrap
  const element = document.getElementById('publication-data')
  try { bootstrap = element?.textContent ? JSON.parse(element.textContent) : null }
  catch { bootstrap = null }
  return bootstrap ?? null
}
