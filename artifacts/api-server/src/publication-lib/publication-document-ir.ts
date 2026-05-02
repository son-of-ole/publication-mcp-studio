import {
  estimatePublicationReadingMinutes,
  extractPublicationCitationKeys,
  extractPublicationDocument,
  extractPublicationHeadings,
  extractPublicationReferences,
  parseDirectiveAttributes,
  stripPublicationMarkdown,
  type PublicationDocument,
  type PublicationHeading,
  type PublicationReference,
} from './publications.js'

export type PublicationDirectiveIR = {
  id: string
  name: string
  attributes: Record<string, string>
  raw: string
  line: number
  system?: string
}

export type PublicationEquationIR = {
  id: string
  kind: 'inline' | 'block'
  source: string
  line: number
}

export type PublicationSectionIR = {
  id: string
  title: string
  level: number
  line: number
  text: string
  wordCount: number
}

export type PublicationDocumentIR = {
  markdown: string
  document: PublicationDocument
  headings: PublicationHeading[]
  sections: PublicationSectionIR[]
  directives: PublicationDirectiveIR[]
  equations: PublicationEquationIR[]
  citations: string[]
  references: PublicationReference[]
  stats: {
    wordCount: number
    characterCount: number
    readingMinutes: number
    headingCount: number
    sectionCount: number
    directiveCount: number
    equationCount: number
    citationCount: number
    referenceCount: number
  }
}

const INLINE_MATH_PATTERN = /(^|[^$])\$([^$\n]+)\$(?!\$)/g

export function buildPublicationDocumentIR(markdown: string, fallbackTitle = ''): PublicationDocumentIR {
  const document = extractPublicationDocument(markdown, fallbackTitle)
  const headings = extractPublicationHeadings(markdown)
  const { body, references } = extractPublicationReferences(markdown)
  const directives = extractPublicationDirectives(body)
  const equations = extractPublicationEquations(body)
  const citations = extractPublicationCitationKeys(markdown)
  const sections = extractPublicationSections(body, headings)
  const plainText = stripPublicationMarkdown(markdown)
  const wordCount = plainText ? plainText.split(/\s+/).length : 0

  return {
    markdown,
    document,
    headings,
    sections,
    directives,
    equations,
    citations,
    references,
    stats: {
      wordCount,
      characterCount: plainText.length,
      readingMinutes: estimatePublicationReadingMinutes(markdown),
      headingCount: headings.length,
      sectionCount: sections.length,
      directiveCount: directives.length,
      equationCount: equations.length,
      citationCount: citations.length,
      referenceCount: references.length,
    },
  }
}

function extractPublicationDirectives(body: string): PublicationDirectiveIR[] {
  const directives: PublicationDirectiveIR[] = []
  const lines = body.split(/\r?\n/)

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()

    const singleMatch = /^::([A-Za-z0-9_-]+)\{([^}]*)\}/.exec(line)
    if (singleMatch) {
      directives.push({
        id: `${singleMatch[1]}-${index + 1}`,
        name: singleMatch[1],
        attributes: parseDirectiveAttributes(singleMatch[2] ?? ''),
        raw: line,
        line: index + 1,
        system: inferDirectiveSystem(singleMatch[1], singleMatch[2] ?? ''),
      })
      return
    }

    const blockMatch = /^:::([A-Za-z0-9_-]+)\b(.*)$/.exec(line)
    if (blockMatch) {
      directives.push({
        id: `${blockMatch[1]}-${index + 1}`,
        name: blockMatch[1],
        attributes: parseDirectiveAttributes(blockMatch[2] ?? ''),
        raw: line,
        line: index + 1,
        system: inferDirectiveSystem(blockMatch[1], blockMatch[2] ?? ''),
      })
    }
  })

  return directives
}

function inferDirectiveSystem(name: string, attributeSource: string) {
  if (name === 'lean' || name === 'proof') {
    const attributes = parseDirectiveAttributes(attributeSource)
    return attributes.system || (name === 'lean' ? 'Lean 4' : 'Proof System')
  }

  return undefined
}

function extractPublicationEquations(body: string): PublicationEquationIR[] {
  const equations: PublicationEquationIR[] = []
  const lines = body.split(/\r?\n/)
  let inBlockMath = false
  let blockStartLine = 0
  let blockLines: string[] = []

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1

    if (rawLine.trim() === '$$') {
      if (inBlockMath) {
        equations.push({
          id: `block-${blockStartLine}`,
          kind: 'block',
          source: blockLines.join('\n').trim(),
          line: blockStartLine,
        })
        inBlockMath = false
        blockStartLine = 0
        blockLines = []
      } else {
        inBlockMath = true
        blockStartLine = lineNumber
        blockLines = []
      }
      return
    }

    if (inBlockMath) {
      blockLines.push(rawLine)
      return
    }

    let match: RegExpExecArray | null
    while ((match = INLINE_MATH_PATTERN.exec(rawLine)) !== null) {
      equations.push({
        id: `inline-${lineNumber}-${match.index}`,
        kind: 'inline',
        source: match[2].trim(),
        line: lineNumber,
      })
    }
    INLINE_MATH_PATTERN.lastIndex = 0
  })

  if (inBlockMath && blockLines.length > 0) {
    equations.push({
      id: `block-${blockStartLine}`,
      kind: 'block',
      source: blockLines.join('\n').trim(),
      line: blockStartLine,
    })
  }

  return equations
}

function extractPublicationSections(body: string, headings: PublicationHeading[]): PublicationSectionIR[] {
  if (headings.length === 0) {
    const plainText = stripPublicationMarkdown(body)
    return plainText
      ? [
          {
            id: 'document-body',
            title: 'Document Body',
            level: 1,
            line: 1,
            text: plainText,
            wordCount: plainText.split(/\s+/).length,
          },
        ]
      : []
  }

  const lines = body.split(/\r?\n/)
  const headingLineMap = new Map<string, number>()
  lines.forEach((rawLine, index) => {
    const match = /^(#{2,4})\s+(.+)$/.exec(rawLine.trim())
    if (!match) {
      return
    }

    const normalizedText = match[2].trim().replace(/\s+#*$/, '').trim()
    if (!headingLineMap.has(normalizedText)) {
      headingLineMap.set(normalizedText, index + 1)
    }
  })

  return headings.map((heading, index) => {
    const currentLine = headingLineMap.get(heading.text) ?? 1
    const nextLine = headingLineMap.get(headings[index + 1]?.text ?? '') ?? lines.length + 1
    const sectionText = lines
      .slice(currentLine, Math.max(currentLine, nextLine - 1))
      .join('\n')
      .trim()
    const plainText = stripPublicationMarkdown(sectionText)

    return {
      id: heading.id,
      title: heading.text,
      level: heading.level,
      line: currentLine,
      text: plainText,
      wordCount: plainText ? plainText.split(/\s+/).length : 0,
    }
  })
}
