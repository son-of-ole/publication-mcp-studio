import type { PublicationArticleRecord, PublicationAttachment } from './types'

/** Defensive public projection, also safe to import into a browser renderer. */
export function getPublicationAttachments(article: Pick<PublicationArticleRecord, 'metadata'>): PublicationAttachment[] {
  const values = article.metadata.attachments
  if (!Array.isArray(values)) return []
  return values.filter((value): value is PublicationAttachment => Boolean(value && typeof value === 'object' &&
    typeof value.id === 'string' && typeof value.url === 'string' &&
    /^(?:\/__publication-(?:local\/media|assets)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)$/.test(value.url) &&
    typeof value.label === 'string' && typeof value.fileName === 'string' && typeof value.contentType === 'string' &&
    typeof value.description === 'string' && ['image', 'video', 'audio', 'document', 'other'].includes(value.kind) &&
    (value.textContent === undefined || typeof value.textContent === 'string'))).slice(0, 30).map(value => ({ ...value, label: value.label.slice(0, 200), description: value.description.slice(0, 4000), textContent: value.textContent?.slice(0, 16_000) }))
}

function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_[\]<>#!|]/g, '\\$&').replace(/[\r\n]+/g, ' ')
}

/** A single readable document, including links and author-supplied attachment text. */
export function publicationMarkdownWithAttachments(article: Pick<PublicationArticleRecord, 'contentMarkdown' | 'metadata'>) {
  const attachments = getPublicationAttachments(article)
  if (!attachments.length) return article.contentMarkdown
  const blocks = attachments.map(asset => {
    const link = `[${escapeMarkdown(asset.label)}](${asset.url})`
    const image = asset.kind === 'image' ? `\n\n![${escapeMarkdown(asset.description || asset.label)}](${asset.url})` : ''
    const description = asset.description ? `\n\n${escapeMarkdown(asset.description)}` : ''
    // Fenced code preserves supplied data/text verbatim without executing markup.
    const fence = '`'.repeat(Array.from((asset.textContent || '').matchAll(/`+/g)).reduce((length, match) => Math.max(length, match[0].length + 1), 3))
    const text = asset.textContent ? `\n\nSupporting text/data supplied by the author:\n\n${fence}text\n${asset.textContent}\n${fence}` : ''
    return `### ${escapeMarkdown(asset.label)}\n\n${link} (${escapeMarkdown(asset.contentType)}${typeof asset.sizeBytes === 'number' ? `, ${asset.sizeBytes} bytes` : ''})${image}${description}${text}`
  })
  return `${article.contentMarkdown.trimEnd()}\n\n## Supporting materials\n\n${blocks.join('\n\n')}\n`
}
