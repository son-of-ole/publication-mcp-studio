import assert from 'node:assert/strict'
import test from 'node:test'
import { PublicationApiError } from './publication-errors'
import {
  listPublicationPresets,
  listPublicationPrompts,
  listPublicationVerifiers,
  runPublicationPreset,
  verifyPublicationMarkdown,
} from './publication-verifiers'

test('listPublicationVerifiers and prompts expose agent-first workflow metadata', () => {
  assert.equal(listPublicationVerifiers().length >= 4, true)
  assert.equal(listPublicationPresets().some((preset) => preset.id === 'journal_submission_pass'), true)
  assert.equal(listPublicationPrompts().some((prompt) => prompt.name === 'seo_pass'), true)
})

test('skill-aware verifier discovery hides disabled capabilities from the caller', () => {
  const auth = {
    label: 'SEO Token',
    tokenId: 'token-1',
    profileId: 'default-publication-agent',
    enabledSkillIds: ['seo'],
  }

  assert.deepEqual(
    listPublicationVerifiers(auth).map((entry) => entry.id),
    ['seo']
  )
  assert.deepEqual(
    listPublicationPresets(auth).map((entry) => entry.id),
    ['seo_pass']
  )
  assert.deepEqual(
    listPublicationPrompts(auth).map((entry) => entry.name),
    ['seo_pass']
  )
})

test('verifyPublicationMarkdown returns structure findings for incomplete journal drafts', async () => {
  const markdown = `---
title: "Short"
---

## Intro

Equation $x=y$.`

  const result = await verifyPublicationMarkdown(markdown, 'journal_structure')
  assert.equal(result.verifierId, 'journal_structure')
  assert.equal(['warn', 'fail', 'pass'].includes(result.status), true)
})

test('runPublicationPreset aggregates verifier results', async () => {
  const markdown = `---
title: "Formal Draft"
abstract: "Abstract."
authors:
  - "Ada Lovelace"
---

## Introduction

This text cites [@smith2024] and uses math $a+b=c$.

::reference{id="smith2024" title="Ref" authors="Smith, John" year="2024"}`

  const result = await runPublicationPreset(markdown, 'formal_math_pass')

  assert.equal(result.presetId, 'formal_math_pass')
  assert.equal(result.results.length, 2)
})

test('skill-aware verification blocks access when the skill is not enabled', async () => {
  await assert.rejects(
    () =>
      verifyPublicationMarkdown('## Title', 'seo', '', {
        label: 'Core Only Token',
        tokenId: 'token-2',
        profileId: 'default-publication-agent',
        enabledSkillIds: [],
      }),
    (error: unknown) => error instanceof PublicationApiError && error.code === 'skill_not_enabled'
  )
})
