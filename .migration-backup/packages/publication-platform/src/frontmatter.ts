export type PublicationFrontmatterValue = string | string[]
export type PublicationFrontmatter = Record<string, PublicationFrontmatterValue>

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?/

export function parseArticleFrontmatter(markdown: string) {
  const match = FRONTMATTER_PATTERN.exec(markdown)

  if (!match) {
    return {
      frontmatter: {} as PublicationFrontmatter,
      body: markdown,
    }
  }

  return {
    frontmatter: parseFrontmatterBlock(match[1] ?? ''),
    body: markdown.slice(match[0].length),
  }
}

export function formatArticleFrontmatter(
  frontmatter: PublicationFrontmatter,
  body: string
) {
  const serialized = formatFrontmatterBlock(frontmatter)
  const trimmedBody = body.trim()

  if (!serialized) {
    return trimmedBody
  }

  return trimmedBody ? `---\n${serialized}\n---\n\n${trimmedBody}` : `---\n${serialized}\n---`
}

export function parseFrontmatterBlock(block: string): PublicationFrontmatter {
  const frontmatter: PublicationFrontmatter = {}
  const lines = block.split(/\r?\n/)
  let activeListKey: string | null = null

  for (const line of lines) {
    const listItemMatch = /^\s*-\s+(.*)$/.exec(line)
    if (listItemMatch && activeListKey) {
      const currentValue = frontmatter[activeListKey]
      const normalized = stripWrappingQuotes(listItemMatch[1]?.trim() ?? '')
      frontmatter[activeListKey] = Array.isArray(currentValue)
        ? [...currentValue, normalized]
        : currentValue
          ? [currentValue, normalized]
          : [normalized]
      continue
    }

    const pairMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!pairMatch) {
      activeListKey = null
      continue
    }

    const [, rawKey, rawValue] = pairMatch
    const key = rawKey.trim()
    const value = rawValue.trim()

    if (!value) {
      frontmatter[key] = []
      activeListKey = key
      continue
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => stripWrappingQuotes(item.trim()))
        .filter(Boolean)
      activeListKey = null
      continue
    }

    frontmatter[key] = stripWrappingQuotes(value)
    activeListKey = null
  }

  return frontmatter
}

export function formatFrontmatterBlock(frontmatter: PublicationFrontmatter) {
  return Object.entries(frontmatter)
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : value.trim().length > 0)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:\n${value.map((entry) => `  - ${JSON.stringify(entry)}`).join('\n')}`
      }

      return `${key}: ${JSON.stringify(value)}`
    })
    .join('\n')
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}
