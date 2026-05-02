import { randomUUID } from 'node:crypto'
import path from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { buildPublicationDocumentIR, type PublicationDocumentIR } from './publication-document-ir'
import { PublicationApiError } from './publication-errors'
import {
  composePublicationMarkdown,
  createEmptyPublicationMetadata,
  extractPublicationDocument,
  stripPublicationMarkdown,
  type PublicationDocument,
} from './publications'

export type PublicationImportFormat = 'markdown' | 'text' | 'docx' | 'pdf' | 'latex'
export type PublicationExportFormat = 'markdown' | 'json' | 'latex' | 'docx' | 'pdf'

export type PublicationImportResult = {
  format: PublicationImportFormat
  fileName: string
  markdown: string
  document: PublicationDocument
  ir: PublicationDocumentIR
  warnings: string[]
}

export type PublicationExportResult = {
  format: PublicationExportFormat
  fileName: string
  mimeType: string
  dataBase64: string
  sizeBytes: number
  warnings: string[]
  engine: 'native-markdown' | 'json-ir' | 'latex-scaffold' | 'docx-js' | 'pdf-lib'
}

export const SUPPORTED_IMPORT_FORMATS: PublicationImportFormat[] = ['markdown', 'text', 'docx', 'pdf', 'latex']
export const SUPPORTED_EXPORT_FORMATS: PublicationExportFormat[] = ['markdown', 'json', 'latex', 'docx', 'pdf']

export async function importPublicationDocument(input: {
  fileName: string
  mimeType?: string
  data: Uint8Array
}): Promise<PublicationImportResult> {
  const format = detectPublicationImportFormat(input.fileName, input.mimeType)
  const warnings: string[] = []
  let markdown = ''

  switch (format) {
    case 'markdown':
      markdown = decodeUtf8(input.data)
      break
    case 'text':
      markdown = buildMarkdownFromImportedText(decodeUtf8(input.data), derivePublicationTitleFromFileName(input.fileName))
      warnings.push('Plain text import uses a lightweight markdown scaffold.')
      break
    case 'latex':
      markdown = buildMarkdownFromImportedText(stripLatexCommands(decodeUtf8(input.data)), derivePublicationTitleFromFileName(input.fileName))
      warnings.push('LaTeX import currently extracts text and equations into a markdown scaffold.')
      break
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(input.data) })
      markdown = buildMarkdownFromImportedText(result.value, derivePublicationTitleFromFileName(input.fileName))
      warnings.push('DOCX import currently preserves text content more reliably than rich styling.')
      break
    }
    case 'pdf': {
      const parser = new PDFParse({ data: Buffer.from(input.data) })
      const parsed = await parser.getText()
      markdown = buildMarkdownFromImportedText(parsed.text, derivePublicationTitleFromFileName(input.fileName))
      await parser.destroy()
      warnings.push('PDF import is text-first and may lose layout fidelity.')
      break
    }
  }

  const document = extractPublicationDocument(markdown, derivePublicationTitleFromFileName(input.fileName))
  const ir = buildPublicationDocumentIR(markdown, document.metadata.title)

  return {
    format,
    fileName: input.fileName,
    markdown,
    document,
    ir,
    warnings,
  }
}

export async function exportPublicationDocument(input: {
  markdown: string
  format: PublicationExportFormat
  fileName?: string
  fallbackTitle?: string
}): Promise<PublicationExportResult> {
  const document = extractPublicationDocument(input.markdown, input.fallbackTitle?.trim() || '')
  const ir = buildPublicationDocumentIR(input.markdown, document.metadata.title)
  const baseName = sanitizeFileBaseName(input.fileName || document.metadata.title || input.fallbackTitle || 'publication')
  const warnings: string[] = []

  switch (input.format) {
    case 'markdown':
      return buildExportResult(input.format, `${baseName}.md`, 'text/markdown', Buffer.from(input.markdown, 'utf8'), warnings, 'native-markdown')
    case 'json':
      return buildExportResult(input.format, `${baseName}.json`, 'application/json', Buffer.from(JSON.stringify(ir, null, 2), 'utf8'), warnings, 'json-ir')
    case 'latex':
      warnings.push('LaTeX export uses a lightweight article scaffold for agent portability.')
      return buildExportResult(input.format, `${baseName}.tex`, 'application/x-latex', Buffer.from(renderPublicationLatex(ir), 'utf8'), warnings, 'latex-scaffold')
    case 'docx':
      warnings.push('DOCX export is generated from the canonical document IR and focuses on structure over pixel-perfect styling.')
      return buildExportResult(input.format, `${baseName}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await renderPublicationDocx(ir), warnings, 'docx-js')
    case 'pdf':
      warnings.push('PDF export currently uses a lightweight text-first renderer suitable for agents and review workflows.')
      return buildExportResult(input.format, `${baseName}.pdf`, 'application/pdf', await renderPublicationPdf(ir), warnings, 'pdf-lib')
    default:
      throw new PublicationApiError(400, 'unsupported_export_format', `Unsupported export format "${input.format}".`)
  }
}

export function detectPublicationImportFormat(fileName: string, mimeType?: string): PublicationImportFormat {
  const lowerFileName = fileName.trim().toLowerCase()
  const normalizedMimeType = (mimeType || '').trim().toLowerCase()

  if (lowerFileName.endsWith('.md') || lowerFileName.endsWith('.markdown') || normalizedMimeType === 'text/markdown') {
    return 'markdown'
  }
  if (lowerFileName.endsWith('.tex') || normalizedMimeType === 'application/x-latex' || normalizedMimeType === 'text/x-tex') {
    return 'latex'
  }
  if (
    lowerFileName.endsWith('.docx') ||
    normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }
  if (lowerFileName.endsWith('.pdf') || normalizedMimeType === 'application/pdf') {
    return 'pdf'
  }
  return 'text'
}

function buildMarkdownFromImportedText(text: string, fallbackTitle: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
  const title = deriveTitleFromImportedText(normalized) || fallbackTitle
  const body = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.replace(/\n+/g, ' '))
    .join('\n\n')

  return composePublicationMarkdown(
    {
      ...createEmptyPublicationMetadata(title),
      title,
      abstract: normalized.split(/\n+/).slice(0, 2).join(' ').slice(0, 320).trim(),
    },
    body
  )
}

function deriveTitleFromImportedText(text: string) {
  const firstMeaningfulLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 12)

  return firstMeaningfulLine?.replace(/^#+\s*/, '').slice(0, 140).trim() || ''
}

function derivePublicationTitleFromFileName(fileName: string) {
  return path.basename(fileName, path.extname(fileName)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || `Imported Publication ${randomUUID().slice(0, 8)}`
}

function sanitizeFileBaseName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'publication'
}

function decodeUtf8(data: Uint8Array) {
  return Buffer.from(data).toString('utf8')
}

function stripLatexCommands(source: string) {
  return source
    .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\begin\{document\}/g, '')
    .replace(/\\end\{document\}/g, '')
    .replace(/\\(section|subsection|subsubsection)\{([^}]*)\}/g, '\n\n## $2\n\n')
    .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
    .replace(/\\emph\{([^}]*)\}/g, '*$1*')
    .replace(/\\item\s+/g, '- ')
    .replace(/\\begin\{itemize\}|\n?\\end\{itemize\}/g, '\n')
    .replace(/\\begin\{enumerate\}|\n?\\end\{enumerate\}/g, '\n')
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?\{([^}]*)\}/g, '$1')
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderPublicationLatex(ir: PublicationDocumentIR) {
  const { metadata } = ir.document
  const authors = metadata.authors.length > 0 ? metadata.authors.join(' \\and ') : 'Publication MCP Studio'
  const abstract = escapeLatex(metadata.abstract || stripPublicationMarkdown(ir.document.body).slice(0, 500))
  const body = ir.document.body
    .split(/\n+/)
    .map((line) => renderMarkdownLineAsLatex(line))
    .join('\n')

  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[margin=1in]{geometry}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\title{' + escapeLatex(metadata.title || 'Untitled Publication') + '}',
    '\\author{' + escapeLatex(authors) + '}',
    metadata.published ? '\\date{' + escapeLatex(metadata.published) + '}' : '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    abstract ? '\\begin{abstract}\n' + abstract + '\n\\end{abstract}' : '',
    body,
    '\\end{document}',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function renderMarkdownLineAsLatex(line: string) {
  const trimmed = line.trim()
  if (!trimmed) {
    return ''
  }
  if (/^##\s+/.test(trimmed)) {
    return `\\section{${escapeLatex(trimmed.replace(/^##\s+/, ''))}}`
  }
  if (/^###\s+/.test(trimmed)) {
    return `\\subsection{${escapeLatex(trimmed.replace(/^###\s+/, ''))}}`
  }
  if (/^####\s+/.test(trimmed)) {
    return `\\subsubsection{${escapeLatex(trimmed.replace(/^####\s+/, ''))}}`
  }
  if (/^- /.test(trimmed)) {
    return `\\begin{itemize}\n\\item ${escapeLatex(trimmed.replace(/^- /, ''))}\n\\end{itemize}`
  }
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
    return `\\[\n${trimmed.slice(2, -2).trim()}\n\\]`
  }
  if (trimmed.startsWith('::')) {
    return `% ${trimmed}`
  }

  return escapeLatex(trimmed)
}

function escapeLatex(value: string) {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}_#%&$])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
}

async function renderPublicationDocx(ir: PublicationDocumentIR) {
  const children: Paragraph[] = []
  const { metadata } = ir.document

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: metadata.title || 'Untitled Publication', bold: true })],
    })
  )

  if (metadata.authors.length > 0) {
    children.push(new Paragraph({ children: [new TextRun(metadata.authors.join(', '))] }))
  }

  if (metadata.abstract) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Abstract' }))
    children.push(new Paragraph({ children: [new TextRun(metadata.abstract)] }))
  }

  for (const line of ir.document.body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      children.push(new Paragraph({ text: '' }))
      continue
    }

    if (/^##\s+/.test(trimmed)) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: trimmed.replace(/^##\s+/, '') }))
      continue
    }
    if (/^###\s+/.test(trimmed)) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: trimmed.replace(/^###\s+/, '') }))
      continue
    }
    if (/^####\s+/.test(trimmed)) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, text: trimmed.replace(/^####\s+/, '') }))
      continue
    }
    if (/^- /.test(trimmed)) {
      children.push(new Paragraph({ text: trimmed.replace(/^- /, '• ') }))
      continue
    }
    if (trimmed.startsWith('::')) {
      children.push(new Paragraph({ children: [new TextRun({ text: trimmed, italics: true, color: '666666' })] }))
      continue
    }

    children.push(new Paragraph({ text: trimmed }))
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  })

  return Packer.toBuffer(doc)
}

async function renderPublicationPdf(ir: PublicationDocumentIR) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  let page = pdfDoc.addPage([612, 792])
  let y = 740

  const drawParagraph = (text: string, size = 11, bold = false) => {
    const lines = wrapText(text, 88)
    const activeFont = bold ? boldFont : font

    for (const line of lines) {
      if (y < 60) {
        page = pdfDoc.addPage([612, 792])
        y = 740
      }

      page.drawText(line, {
        x: 50,
        y,
        size,
        font: activeFont,
        color: rgb(0.1, 0.1, 0.1),
      })
      y -= size + 5
    }
    y -= 8
  }

  drawParagraph(ir.document.metadata.title || 'Untitled Publication', 20, true)
  if (ir.document.metadata.authors.length > 0) {
    drawParagraph(ir.document.metadata.authors.join(', '), 12)
  }
  if (ir.document.metadata.abstract) {
    drawParagraph('Abstract', 14, true)
    drawParagraph(ir.document.metadata.abstract)
  }

  for (const line of ir.document.body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      y -= 6
      continue
    }

    if (/^##\s+/.test(trimmed)) {
      drawParagraph(trimmed.replace(/^##\s+/, ''), 16, true)
      continue
    }
    if (/^###\s+/.test(trimmed)) {
      drawParagraph(trimmed.replace(/^###\s+/, ''), 13, true)
      continue
    }

    drawParagraph(trimmed.startsWith('::') ? `[Directive] ${trimmed}` : trimmed)
  }

  return Buffer.from(await pdfDoc.save())
}

function wrapText(text: string, maxLineLength: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxLineLength) {
      current = candidate
      continue
    }

    if (current) {
      lines.push(current)
    }
    current = word
  }

  if (current) {
    lines.push(current)
  }

  return lines.length > 0 ? lines : ['']
}

function buildExportResult(
  format: PublicationExportFormat,
  fileName: string,
  mimeType: string,
  data: Uint8Array,
  warnings: string[],
  engine: PublicationExportResult['engine']
): PublicationExportResult {
  const buffer = Buffer.from(data)

  return {
    format,
    fileName,
    mimeType,
    dataBase64: buffer.toString('base64'),
    sizeBytes: buffer.byteLength,
    warnings,
    engine,
  }
}
