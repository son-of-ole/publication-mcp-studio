import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPublicationDocumentIR } from '@/lib/publication-document-ir'

test('buildPublicationDocumentIR extracts sections, directives, equations, citations, and references', () => {
  const markdown = `---
title: "Structured Publication"
authors:
  - "Ada Lovelace"
abstract: "A compact abstract."
---

## Introduction

This is a paragraph with inline math $a+b=c$ and a citation [@smith2024].

## Methods

$$
f(x)=x^2
$$

::lean{title="Sample Theorem" theorem="sample" code="theorem sample : True := by\\n  trivial"}

::reference{id="smith2024" title="Reference title" authors="Smith, John" journal="Journal" year="2024"}`

  const ir = buildPublicationDocumentIR(markdown, 'Fallback')

  assert.equal(ir.document.metadata.title, 'Structured Publication')
  assert.equal(ir.sections.length, 2)
  assert.equal(ir.equations.length, 2)
  assert.equal(ir.directives.some((directive) => directive.name === 'lean'), true)
  assert.deepEqual(ir.citations, ['smith2024'])
  assert.equal(ir.references.length, 1)
  assert.equal(ir.stats.headingCount, 2)
})
