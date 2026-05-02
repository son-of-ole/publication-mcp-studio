import Cite from 'citation-js'

export type PublicationFrontmatterValue = string | string[]

export type PublicationFrontmatter = Record<string, PublicationFrontmatterValue>

export type PublicationMetadata = {
  title: string
  publicationLabel: string
  subtitle: string
  abstract: string
  authors: string[]
  authorProfiles: string[]
  affiliations: string[]
  tags: string[]
  doi: string
  journal: string
  repositoryUrl: string
  repositoryLabel: string
  published: string
  revised: string
  canonicalUrl: string
  heroImage: string
  heroVideo: string
  heroPoster: string
  heroCaption: string
}

export type PublicationAuthorProfile = {
  name: string
  email: string
  orcid: string
  social: string
  url: string
}

export type PublicationDocument = {
  metadata: PublicationMetadata
  customFrontmatter: PublicationFrontmatter
  body: string
}

export type PublicationPresentation = {
  metadata: PublicationMetadata
  lead: string
  readingMinutes: number
  publishedLabel: string
}

export type PublicationHeading = {
  id: string
  level: number
  text: string
}

export type PublicationReference = {
  id: string
  type: string
  title: string
  authors: string[]
  journal: string
  publisher: string
  year: string
  month: string
  day: string
  url: string
  doi: string
  volume: string
  issue: string
  pages: string
  edition: string
  note: string
}

type FrontmatterParseResult = {
  frontmatter: PublicationFrontmatter
  body: string
}

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?/
const REFERENCE_DIRECTIVE_PATTERN = /^::reference\{([^}]*)\}\s*$/gm
const CITATION_PATTERN = /\[@[^\]]+\]/g

const KNOWN_METADATA_KEYS = [
  'title',
  'publicationLabel',
  'subtitle',
  'abstract',
  'authors',
  'authorProfiles',
  'affiliations',
  'tags',
  'doi',
  'journal',
  'repositoryUrl',
  'repositoryLabel',
  'published',
  'revised',
  'canonicalUrl',
  'heroImage',
  'heroVideo',
  'heroPoster',
  'heroCaption',
] as const

type KnownMetadataKey = (typeof KNOWN_METADATA_KEYS)[number]

function isKnownMetadataKey(key: string): key is KnownMetadataKey {
  return KNOWN_METADATA_KEYS.includes(key as KnownMetadataKey)
}

export function createEmptyPublicationMetadata(title = ''): PublicationMetadata {
  return {
    title,
    publicationLabel: '',
    subtitle: '',
    abstract: '',
    authors: [],
    authorProfiles: [],
    affiliations: [],
    tags: [],
    doi: '',
    journal: '',
    repositoryUrl: '',
    repositoryLabel: '',
    published: '',
    revised: '',
    canonicalUrl: '',
    heroImage: '',
    heroVideo: '',
    heroPoster: '',
    heroCaption: '',
  }
}

export function splitPublicationFrontmatter(markdown: string): FrontmatterParseResult {
  const match = FRONTMATTER_PATTERN.exec(markdown)

  if (!match) {
    return {
      frontmatter: {},
      body: markdown,
    }
  }

  return {
    frontmatter: parseFrontmatterBlock(match[1] ?? ''),
    body: markdown.slice(match[0].length),
  }
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

      if (Array.isArray(currentValue)) {
        currentValue.push(normalized)
      } else if (typeof currentValue === 'string' && currentValue.length > 0) {
        frontmatter[activeListKey] = [currentValue, normalized]
      } else {
        frontmatter[activeListKey] = [normalized]
      }
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

    if (value.length === 0) {
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

export function serializeFrontmatterBlock(frontmatter: PublicationFrontmatter): string {
  return Object.entries(frontmatter)
    .filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0
      }

      return value.trim().length > 0
    })
    .map(([key, value]) => serializeFrontmatterEntry(key, value))
    .join('\n')
}

export function extractPublicationDocument(markdown: string, fallbackTitle = ''): PublicationDocument {
  const { frontmatter, body } = splitPublicationFrontmatter(markdown)
  const metadata = createEmptyPublicationMetadata(fallbackTitle)
  const customFrontmatter: PublicationFrontmatter = {}

  for (const [key, value] of Object.entries(frontmatter)) {
    if (isKnownMetadataKey(key)) {
      switch (key) {
        case 'authors':
        case 'authorProfiles':
        case 'affiliations':
        case 'tags':
          metadata[key] = normalizeListValue(value)
          break
        default:
          metadata[key] = normalizeScalarValue(value)
      }
    } else {
      customFrontmatter[key] = value
    }
  }

  if (!metadata.title.trim()) {
    metadata.title = fallbackTitle
  }

  return {
    metadata,
    customFrontmatter,
    body: body.trim(),
  }
}

export function composePublicationMarkdown(
  metadata: PublicationMetadata,
  body: string,
  customFrontmatter: PublicationFrontmatter = {}
): string {
  const frontmatter: PublicationFrontmatter = {
    ...customFrontmatter,
  }

  const normalizedMetadata = normalizePublicationMetadata(metadata)

  for (const key of KNOWN_METADATA_KEYS) {
    const value = normalizedMetadata[key]

    if (Array.isArray(value)) {
      if (value.length > 0) {
        frontmatter[key] = value
      } else {
        delete frontmatter[key]
      }
      continue
    }

    if (value.trim().length > 0) {
      frontmatter[key] = value
    } else {
      delete frontmatter[key]
    }
  }

  const serializedFrontmatter = serializeFrontmatterBlock(frontmatter)
  const trimmedBody = body.trim()

  if (!serializedFrontmatter) {
    return trimmedBody
  }

  if (!trimmedBody) {
    return `---\n${serializedFrontmatter}\n---`
  }

  return `---\n${serializedFrontmatter}\n---\n\n${trimmedBody}`
}

export function normalizePublicationMetadata(metadata: PublicationMetadata): PublicationMetadata {
  return {
    ...metadata,
    title: metadata.title.trim(),
    publicationLabel: metadata.publicationLabel.trim(),
    subtitle: metadata.subtitle.trim(),
    abstract: metadata.abstract.trim(),
    authors: normalizeListValue(metadata.authors),
    authorProfiles: normalizeListValue(metadata.authorProfiles),
    affiliations: normalizeListValue(metadata.affiliations),
    tags: normalizeListValue(metadata.tags),
    doi: metadata.doi.trim(),
    journal: metadata.journal.trim(),
    repositoryUrl: metadata.repositoryUrl.trim(),
    repositoryLabel: metadata.repositoryLabel.trim(),
    published: metadata.published.trim(),
    revised: metadata.revised.trim(),
    canonicalUrl: metadata.canonicalUrl.trim(),
    heroImage: metadata.heroImage.trim(),
    heroVideo: metadata.heroVideo.trim(),
    heroPoster: metadata.heroPoster.trim(),
    heroCaption: metadata.heroCaption.trim(),
  }
}

export function stringifyFrontmatterForEditor(frontmatter: PublicationFrontmatter): string {
  return serializeFrontmatterBlock(frontmatter)
}

export function parseFrontmatterEditorInput(raw: string): PublicationFrontmatter {
  if (!raw.trim()) {
    return {}
  }

  return parseFrontmatterBlock(raw.trim())
}

export function splitEditorListInput(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function joinEditorListInput(values: string[]): string {
  return values.join('\n')
}

export function parseAuthorProfilesEditorInput(raw: string, authorCount = 0): string[] {
  const trimmed = raw.trim()

  if (!trimmed) {
    return []
  }

  const blocks = trimmed
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)

  if (blocks.length > 1) {
    return blocks.map((block) => collapseAuthorProfileBlock(block)).filter(Boolean)
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length <= 1) {
    return lines.map((line) => collapseAuthorProfileBlock(line)).filter(Boolean)
  }

  if (authorCount <= 1) {
    return [collapseAuthorProfileBlock(lines.join(' | '))].filter(Boolean)
  }

  return lines.map((line) => collapseAuthorProfileBlock(line)).filter(Boolean)
}

export function parsePublicationAuthorProfiles(
  authors: string[],
  authorProfiles: string[],
): PublicationAuthorProfile[] {
  const parsedProfiles = authorProfiles
    .map((entry, index) => parsePublicationAuthorProfileEntry(entry, authors[index]))
    .filter((entry): entry is PublicationAuthorProfile => Boolean(entry))

  if (authors.length === 0) {
    return parsedProfiles.filter((profile) => profile.name.length > 0)
  }

  const matchedProfileIndexes = new Set<number>()
  const profilesByName = new Map<string, number[]>()

  parsedProfiles.forEach((profile, index) => {
    const key = profile.name.trim().toLowerCase()
    if (!key) {
      return
    }

    const existing = profilesByName.get(key)
    if (existing) {
      existing.push(index)
    } else {
      profilesByName.set(key, [index])
    }
  })

  return authors
    .map((author, authorIndex) => {
      const normalizedAuthor = author.trim()
      if (!normalizedAuthor) {
        return null
      }

      const namedMatches = profilesByName.get(normalizedAuthor.toLowerCase()) ?? []
      const namedIndex = namedMatches.find((index) => !matchedProfileIndexes.has(index))
      const orderedIndex =
        authorIndex < parsedProfiles.length && !matchedProfileIndexes.has(authorIndex)
          ? authorIndex
          : undefined
      const profileIndex = namedIndex ?? orderedIndex

      if (typeof profileIndex === 'number') {
        matchedProfileIndexes.add(profileIndex)
        return mergePublicationAuthorProfileName(parsedProfiles[profileIndex], normalizedAuthor)
      }

      return {
        name: normalizedAuthor,
        email: '',
        orcid: '',
        social: '',
        url: '',
      }
    })
    .filter((profile): profile is PublicationAuthorProfile => Boolean(profile))
}

export function buildPublicationAuthorLinkItems(profile: PublicationAuthorProfile) {
  const links: Array<{ label: string; href: string }> = []

  if (profile.email) {
    links.push({
      label: 'Email',
      href: profile.email.startsWith('mailto:') ? profile.email : `mailto:${profile.email}`,
    })
  }

  if (profile.orcid) {
    links.push({
      label: 'ORCID',
      href: normalizePublicationProfileUrl(profile.orcid, 'https://orcid.org/'),
    })
  }

  if (profile.social) {
    links.push({
      label: inferPublicationSocialLabel(profile.social),
      href: normalizePublicationProfileUrl(profile.social),
    })
  }

  if (profile.url) {
    links.push({
      label: 'Profile',
      href: normalizePublicationProfileUrl(profile.url),
    })
  }

  return links
}

export function getPublicationPresentation(
  articleTitle: string,
  markdown: string,
  createdAt?: string | Date
): PublicationPresentation {
  const { metadata } = extractPublicationDocument(markdown, articleTitle)

  return {
    metadata,
    lead: extractPublicationLead(markdown, 280),
    readingMinutes: estimatePublicationReadingMinutes(markdown),
    publishedLabel: formatPublicationDate(metadata.published, createdAt),
  }
}

export function extractPublicationHeadings(markdown: string): PublicationHeading[] {
  const { body } = splitPublicationFrontmatter(markdown)
  const headings: PublicationHeading[] = []
  let inCodeFence = false
  const seenHeadingIds = new Map<string, number>()

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence
      continue
    }

    if (inCodeFence) {
      continue
    }

    const match = /^(#{2,4})\s+(.+)$/.exec(line)
    if (!match) {
      continue
    }

    const text = normalizePublicationHeadingText(match[2] ?? '')
    if (!text) {
      continue
    }

    headings.push({
      id: createPublicationHeadingAnchor(text, seenHeadingIds),
      level: match[1].length,
      text,
    })
  }

  return headings
}

export function formatPublicationDate(value: string, fallback?: string | Date): string {
  const raw = value.trim()

  if (raw) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    }

    return raw
  }

  if (!fallback) {
    return 'Unscheduled'
  }

  const parsedFallback = fallback instanceof Date ? fallback : new Date(fallback)
  if (Number.isNaN(parsedFallback.getTime())) {
    return 'Unscheduled'
  }

  return parsedFallback.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function serializeFrontmatterEntry(key: string, value: PublicationFrontmatterValue): string {
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => `  - ${quoteFrontmatterString(entry)}`)

    return `${key}:\n${items.join('\n')}`
  }

  return `${key}: ${quoteFrontmatterString(value.trim())}`
}

function quoteFrontmatterString(value: string): string {
  if (!value) {
    return '""'
  }

  if (/^[A-Za-z0-9._\/:-]+$/.test(value) && !value.startsWith('-')) {
    return value
  }

  return JSON.stringify(value)
}

function normalizeScalarValue(value: PublicationFrontmatterValue): string {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ').trim()
  }

  return value.trim()
}

function normalizeListValue(value: PublicationFrontmatterValue | string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean)
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function parsePublicationAuthorProfileEntry(entry: string, fallbackName?: string): PublicationAuthorProfile | null {
  const normalizedEntry = collapseAuthorProfileBlock(entry)
  const parts = normalizedEntry
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  const firstPart = parts[0]
  const profile: PublicationAuthorProfile = {
    name: isPublicationAuthorProfileToken(firstPart) ? fallbackName?.trim() ?? '' : firstPart,
    email: '',
    orcid: '',
    social: '',
    url: '',
  }

  for (const part of parts.slice(isPublicationAuthorProfileToken(firstPart) ? 0 : 1)) {
    const match = /^([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/.exec(part)

    if (!match) {
      if (!profile.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
        profile.email = part
        continue
      }

      if (!profile.url && /^(https?:\/\/|www\.)/i.test(part)) {
        profile.url = part
      }

      continue
    }

    const key = match[1].toLowerCase()
    const value = stripWrappingQuotes(match[2].trim())

    switch (key) {
      case 'name':
      case 'author':
        profile.name = value
        break
      case 'email':
      case 'mail':
        profile.email = value
        break
      case 'orcid':
        profile.orcid = value
        break
      case 'social':
      case 'linkedin':
      case 'x':
      case 'twitter':
        profile.social = value
        break
      case 'github':
        profile.social = normalizePublicationProfileUrl(value, 'https://github.com/')
        break
      case 'url':
      case 'link':
      case 'profile':
      case 'website':
      case 'site':
        profile.url = value
        break
      default:
        break
    }
  }

  return profile.name.trim() ? profile : null
}

function isPublicationAuthorProfileToken(value: string) {
  return /^([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^(https?:\/\/|www\.)/i.test(value)
}

function collapseAuthorProfileBlock(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ')
}

function mergePublicationAuthorProfileName(profile: PublicationAuthorProfile, name: string): PublicationAuthorProfile {
  if (profile.name.trim().toLowerCase() === name.trim().toLowerCase()) {
    return profile
  }

  return {
    ...profile,
    name,
  }
}

function normalizePublicationProfileUrl(value: string, prefix?: string) {
  const trimmedValue = value.trim()

  if (/^[a-z]+:/i.test(trimmedValue) || trimmedValue.startsWith('//')) {
    return trimmedValue
  }

  if (prefix) {
    return `${prefix}${trimmedValue.replace(/^\/+/, '')}`
  }

  return `https://${trimmedValue.replace(/^\/+/, '')}`
}

function inferPublicationSocialLabel(value: string) {
  const normalized = value.toLowerCase()

  if (normalized.includes('orcid.org')) return 'ORCID'
  if (normalized.includes('linkedin.com')) return 'LinkedIn'
  if (normalized.includes('github.com')) return 'GitHub'
  if (normalized.includes('twitter.com') || normalized.includes('x.com')) return 'Social'

  return 'Social'
}

export function normalizePublicationHeadingText(value: string) {
  return value
    .trim()
    .replace(/^\[(center|right)\]\s*/i, '')
    .replace(/\s+#*$/, '')
    .trim()
}

export function createPublicationHeadingAnchor(value: string, seenHeadingIds?: Map<string, number>) {
  const base = slugifyPublicationHeading(normalizePublicationHeadingText(value))

  if (!seenHeadingIds) {
    return base
  }

  const count = seenHeadingIds.get(base) ?? 0
  seenHeadingIds.set(base, count + 1)

  return count === 0 ? base : `${base}-${count + 1}`
}

export function slugifyPublicationHeading(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function parseDirectiveAttributes(attributeSource: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g

  for (const match of attributeSource.matchAll(pattern)) {
    const key = match[1]
    const value = match[2] ?? match[3] ?? match[4] ?? 'true'

    if (key) {
      attributes[key] = value
    }
  }

  return attributes
}

export function extractPublicationReferences(markdown: string): {
  body: string
  references: PublicationReference[]
} {
  const { body } = splitPublicationFrontmatter(markdown)
  const referencesById = new Map<string, PublicationReference>()

  const cleanedBody = body
    .replace(REFERENCE_DIRECTIVE_PATTERN, (_, rawAttributeSource: string) => {
      const reference = parsePublicationReference(rawAttributeSource)

      if (reference) {
        referencesById.set(reference.id, reference)
      }

      return ''
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    body: cleanedBody,
    references: [...referencesById.values()],
  }
}

export function parsePublicationCitationKeys(source: string): string[] {
  const inner = source.replace(/^\[/, '').replace(/\]$/, '')

  return inner
    .split(';')
    .map((part) => part.trim())
    .map((part) => {
      const match = /@([A-Za-z0-9:_./-]+)/.exec(part)
      return match?.[1] ?? ''
    })
    .filter(Boolean)
}

export function extractPublicationCitationKeys(markdown: string): string[] {
  const { body } = splitPublicationFrontmatter(markdown)
  const keys = new Set<string>()

  for (const match of body.matchAll(CITATION_PATTERN)) {
    for (const key of parsePublicationCitationKeys(match[0])) {
      keys.add(key)
    }
  }

  return [...keys]
}

export function getPublicationReferenceAnchor(referenceId: string): string {
  return `reference-${referenceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'entry'}`
}

export function formatPublicationCitationLabel(reference: PublicationReference): string {
  try {
    const rendered = new Cite([buildPublicationReferenceCsl(reference)]).format('citation', {
      format: 'text',
      template: 'apa',
      lang: 'en-US',
    })

    return stripOuterParentheses(rendered.trim()) || fallbackPublicationCitationLabel(reference)
  } catch {
    return fallbackPublicationCitationLabel(reference)
  }
}

export function formatPublicationBibliographyHtml(references: PublicationReference[]): string {
  if (references.length === 0) {
    return ''
  }

  try {
    return new Cite(references.map(buildPublicationReferenceCsl))
      .format('bibliography', {
        format: 'html',
        template: 'apa',
        lang: 'en-US',
      })
      .replace(
        /data-csl-entry-id="([^"]+)"/g,
        (_match: string, referenceId: string) =>
          `id="${getPublicationReferenceAnchor(referenceId)}" data-csl-entry-id="${referenceId}"`,
      )
  } catch {
    return [
      '<div class="csl-bib-body">',
      ...references.map((reference) => {
        const identifier = escapeHtml(reference.id)
        return `<div id="${getPublicationReferenceAnchor(reference.id)}" data-csl-entry-id="${identifier}" class="csl-entry">${escapeHtml(formatFallbackPublicationReference(reference))}</div>`
      }),
      '</div>',
    ].join('')
  }
}

export function stripPublicationMarkdown(markdown: string): string {
  const { body } = splitPublicationFrontmatter(markdown)

  return body
    .replace(/^:::[\s\S]+?\n:::\s*$/gm, ' ')
    .replace(/^::[A-Za-z0-9_-]+\{[^}]*\}\s*$/gm, ' ')
    .replace(/^```[\s\S]*?^```/gm, ' ')
    .replace(/^---$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\+\+([^+]+)\+\+/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function estimatePublicationReadingMinutes(markdown: string): number {
  const plainText = stripPublicationMarkdown(markdown)
  const wordCount = plainText.length > 0 ? plainText.split(/\s+/).length : 0

  return Math.max(1, Math.round(wordCount / 225))
}

export function extractPublicationLead(markdown: string, maxLength = 240): string {
  const { frontmatter, body } = splitPublicationFrontmatter(markdown)
  const abstract = frontmatter.abstract

  if (typeof abstract === 'string' && abstract.trim().length > 0) {
    return truncateText(abstract.trim(), maxLength)
  }

  const blocks = body
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean)

  for (const block of blocks) {
    if (
      block.startsWith('#') ||
      block.startsWith('::') ||
      block.startsWith(':::') ||
      block.startsWith('```') ||
      block.startsWith('[gallery')
    ) {
      continue
    }

    const plain = stripPublicationMarkdown(block)
    if (plain.length > 30) {
      return truncateText(plain, maxLength)
    }
  }

  return truncateText(stripPublicationMarkdown(body), maxLength)
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  const sliced = text.slice(0, maxLength)
  const boundary = sliced.lastIndexOf(' ')

  return `${(boundary > 0 ? sliced.slice(0, boundary) : sliced).trim()}...`
}

function parsePublicationReference(attributeSource: string): PublicationReference | null {
  const attributes = parseDirectiveAttributes(attributeSource)
  const id = (attributes.id ?? attributes.key ?? '').trim()
  const title = (attributes.title ?? '').trim()

  if (!id || !title) {
    return null
  }

  return {
    id,
    type: (attributes.type ?? inferPublicationReferenceType(attributes)).trim(),
    title,
    authors: splitReferenceAuthors(attributes.authors ?? attributes.author ?? ''),
    journal: (attributes.journal ?? attributes.venue ?? attributes.container ?? '').trim(),
    publisher: (attributes.publisher ?? '').trim(),
    year: (attributes.year ?? '').trim(),
    month: (attributes.month ?? '').trim(),
    day: (attributes.day ?? '').trim(),
    url: (attributes.url ?? attributes.href ?? '').trim(),
    doi: (attributes.doi ?? '').trim(),
    volume: (attributes.volume ?? '').trim(),
    issue: (attributes.issue ?? '').trim(),
    pages: (attributes.pages ?? attributes.page ?? '').trim(),
    edition: (attributes.edition ?? '').trim(),
    note: (attributes.note ?? '').trim(),
  }
}

function inferPublicationReferenceType(attributes: Record<string, string>): string {
  if (attributes.journal || attributes.venue || attributes.container) {
    return 'article-journal'
  }

  if (attributes.publisher) {
    return 'book'
  }

  return 'webpage'
}

function splitReferenceAuthors(rawAuthors: string): string[] {
  return rawAuthors
    .split(';')
    .map((author) => author.trim())
    .filter(Boolean)
}

function buildPublicationReferenceCsl(reference: PublicationReference): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: reference.id,
    type: reference.type || 'article-journal',
    title: reference.title,
  }

  const authors = reference.authors.map(parsePublicationAuthorName).filter(Boolean)
  if (authors.length > 0) {
    item.author = authors
  }

  if (reference.journal) {
    item['container-title'] = reference.journal
  }

  if (reference.publisher) {
    item.publisher = reference.publisher
  }

  if (reference.url) {
    item.URL = reference.url
  }

  if (reference.doi) {
    item.DOI = reference.doi
  }

  if (reference.volume) {
    item.volume = reference.volume
  }

  if (reference.issue) {
    item.issue = reference.issue
  }

  if (reference.pages) {
    item.page = reference.pages
  }

  if (reference.edition) {
    item.edition = reference.edition
  }

  if (reference.note) {
    item.note = reference.note
  }

  const issued = buildPublicationIssuedDate(reference)
  if (issued) {
    item.issued = issued
  }

  return item
}

function parsePublicationAuthorName(author: string): { given?: string; family: string } | null {
  const trimmed = author.trim()

  if (!trimmed) {
    return null
  }

  if (trimmed.includes(',')) {
    const [family, given] = trimmed.split(',').map((part) => part.trim())
    if (!family) {
      return null
    }

    return {
      family,
      given: given || undefined,
    }
  }

  const parts = trimmed.split(/\s+/)
  const family = parts.pop()

  if (!family) {
    return null
  }

  return {
    family,
    given: parts.join(' ') || undefined,
  }
}

function buildPublicationIssuedDate(reference: PublicationReference): { 'date-parts': number[][] } | null {
  const year = Number.parseInt(reference.year, 10)

  if (Number.isNaN(year)) {
    return null
  }

  const dateParts = [year]

  const month = Number.parseInt(reference.month, 10)
  if (!Number.isNaN(month)) {
    dateParts.push(month)
  }

  const day = Number.parseInt(reference.day, 10)
  if (!Number.isNaN(day)) {
    dateParts.push(day)
  }

  return {
    'date-parts': [dateParts],
  }
}

function fallbackPublicationCitationLabel(reference: PublicationReference): string {
  const authorNames = reference.authors
    .map((author) => {
      const parsed = parsePublicationAuthorName(author)
      return parsed?.family ?? author
    })
    .filter(Boolean)

  const authorLabel =
    authorNames.length === 0
      ? reference.title || reference.id
      : authorNames.length === 1
        ? authorNames[0]
        : authorNames.length === 2
          ? `${authorNames[0]} & ${authorNames[1]}`
          : `${authorNames[0]} et al.`

  return `${authorLabel}, ${reference.year || 'n.d.'}`
}

function formatFallbackPublicationReference(reference: PublicationReference): string {
  const authors = reference.authors.join(', ')
  const year = reference.year || 'n.d.'
  const venue = reference.journal || reference.publisher
  const location = [reference.volume, reference.issue ? `(${reference.issue})` : '', reference.pages]
    .filter(Boolean)
    .join(', ')

  return [authors, `(${year}).`, reference.title, venue, location, reference.doi ? `https://doi.org/${reference.doi}` : reference.url]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripOuterParentheses(value: string): string {
  if (value.startsWith('(') && value.endsWith(')')) {
    return value.slice(1, -1)
  }

  return value
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
