import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectPublicationImportFormat,
  exportPublicationDocument,
  importPublicationDocument,
} from './publication-import-export'

test('detectPublicationImportFormat recognizes markdown and latex inputs', () => {
  assert.equal(detectPublicationImportFormat('paper.md'), 'markdown')
  assert.equal(detectPublicationImportFormat('paper.tex'), 'latex')
  assert.equal(detectPublicationImportFormat('paper.docx'), 'docx')
})

test('importPublicationDocument builds markdown from plain text', async () => {
  const result = await importPublicationDocument({
    fileName: 'sample.txt',
    mimeType: 'text/plain',
    data: Buffer.from('Sample publication title\n\nThis is the body.', 'utf8'),
  })

  assert.equal(result.format, 'text')
  assert.match(result.markdown, /Sample publication title/)
  assert.equal(result.document.metadata.title.length > 0, true)
})

test('exportPublicationDocument can emit json and latex', async () => {
  const markdown = `---
title: "Export Test"
abstract: "Short abstract for export."
---

## Intro

Body text.`

  const jsonExport = await exportPublicationDocument({ markdown, format: 'json' })
  const latexExport = await exportPublicationDocument({ markdown, format: 'latex' })

  assert.equal(jsonExport.mimeType, 'application/json')
  assert.equal(latexExport.mimeType, 'application/x-latex')
  assert.match(Buffer.from(latexExport.dataBase64, 'base64').toString('utf8'), /\\documentclass/)
})
