import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  buildPublicationDocumentIR,
  type PublicationDocumentIR,
} from '@/lib/publication-document-ir'
import { PublicationApiError } from '@/lib/publication-errors'
import { truncateText } from '@/lib/publications'
import type { PublicationAuthContext } from '@publication-platform/types'
import {
  assertPublicationSkillCapabilityEnabled,
  getPublicationSkillForCapability,
} from '@/lib/publication-skills'

const execFileAsync = promisify(execFile)

export type PublicationVerificationStatus = 'pass' | 'warn' | 'fail' | 'unavailable'

export type PublicationVerificationFinding = {
  severity: 'info' | 'warn' | 'error'
  message: string
  line?: number
  code?: string
}

export type PublicationVerificationResult = {
  verifierId: string
  label: string
  status: PublicationVerificationStatus
  summary: string
  findings: PublicationVerificationFinding[]
  data?: Record<string, unknown>
}

export type PublicationPresetResult = {
  presetId: string
  label: string
  status: PublicationVerificationStatus
  summary: string
  results: PublicationVerificationResult[]
}

type PublicationVerifier = {
  id: string
  label: string
  description: string
  run: (ir: PublicationDocumentIR) => Promise<PublicationVerificationResult> | PublicationVerificationResult
}

type PublicationPreset = {
  id: string
  label: string
  description: string
  verifierIds: string[]
  prompt: string
}

const verifierRegistry: PublicationVerifier[] = [
  {
    id: 'math_sanity',
    label: 'Math Sanity',
    description: 'Checks math delimiters, equation balance, and basic formal structure.',
    run: verifyMathSanity,
  },
  {
    id: 'lean',
    label: 'Lean Verification',
    description: 'Checks Lean/proof blocks and optionally compiles them when Lean is installed.',
    run: verifyLeanArtifacts,
  },
  {
    id: 'journal_structure',
    label: 'Journal Structure',
    description: 'Checks core scientific paper structure, metadata, sections, and references.',
    run: verifyJournalStructure,
  },
  {
    id: 'seo',
    label: 'SEO Review',
    description: 'Checks title, abstract, canonical URL, and heading structure for discoverability.',
    run: verifySeoReadiness,
  },
]

const presetRegistry: PublicationPreset[] = [
  {
    id: 'journal_submission_pass',
    label: 'Journal Submission Pass',
    description: 'Runs structure, citation/reference, and formal-math checks before submission.',
    verifierIds: ['journal_structure', 'math_sanity', 'lean'],
    prompt:
      'Prepare this publication for journal submission. Tighten the abstract, structure the sections for scholarly review, preserve citations, and resolve any warnings from the verification pass.',
  },
  {
    id: 'seo_pass',
    label: 'SEO Pass',
    description: 'Optimizes title, abstract, headings, and canonical metadata for search discovery.',
    verifierIds: ['seo'],
    prompt:
      'Revise this publication for search visibility while preserving scientific accuracy. Improve the title, abstract, metadata, and heading structure without introducing hype.',
  },
  {
    id: 'formal_math_pass',
    label: 'Formal Math Pass',
    description: 'Focuses on equations, proof blocks, and Lean verification scaffolding.',
    verifierIds: ['math_sanity', 'lean'],
    prompt:
      'Focus on formal mathematical correctness. Clarify theorem statements, align equations with prose, and strengthen Lean or proof blocks where possible.',
  },
]

export async function verifyPublicationMarkdown(
  markdown: string,
  verifierId: string,
  fallbackTitle = '',
  auth?: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>
) {
  if (auth) {
    assertPublicationSkillCapabilityEnabled(auth, `verifier:${verifierId}`)
  }

  const verifier = verifierRegistry.find((entry) => entry.id === verifierId)
  if (!verifier) {
    throw new PublicationApiError(404, 'verifier_not_found', `No publication verifier found for "${verifierId}".`)
  }

  const ir = buildPublicationDocumentIR(markdown, fallbackTitle)
  return verifier.run(ir)
}

export async function runPublicationPreset(
  markdown: string,
  presetId: string,
  fallbackTitle = '',
  auth?: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>
): Promise<PublicationPresetResult> {
  if (auth) {
    assertPublicationSkillCapabilityEnabled(auth, `preset:${presetId}`)
  }

  const preset = presetRegistry.find((entry) => entry.id === presetId)
  if (!preset) {
    throw new PublicationApiError(404, 'preset_not_found', `No publication preset found for "${presetId}".`)
  }

  const ir = buildPublicationDocumentIR(markdown, fallbackTitle)
  const results = await Promise.all(
    preset.verifierIds.map(async (verifierId) => {
      const verifier = verifierRegistry.find((entry) => entry.id === verifierId)
      if (!verifier) {
        throw new PublicationApiError(404, 'verifier_not_found', `No publication verifier found for "${verifierId}".`)
      }

      if (auth) {
        assertPublicationSkillCapabilityEnabled(auth, `verifier:${verifierId}`)
      }

      return verifier.run(ir)
    })
  )

  const status = summarizeVerificationStatuses(results.map((result) => result.status))
  return {
    presetId: preset.id,
    label: preset.label,
    status,
    summary: summarizePresetResults(preset.label, results),
    results,
  }
}

export function listPublicationVerifiers(
  auth?: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>
) {
  return verifierRegistry
    .filter((entry) => isCapabilityVisible(auth, `verifier:${entry.id}`))
    .map(({ id, label, description }) => ({
      id,
      label,
      description,
      skillId: getPublicationSkillForCapability(`verifier:${id}`)?.id ?? null,
    }))
}

export function listPublicationPresets(
  auth?: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>
) {
  return presetRegistry
    .filter((entry) => isCapabilityVisible(auth, `preset:${entry.id}`))
    .map(({ id, label, description, verifierIds }) => ({
      id,
      label,
      description,
      verifierIds: verifierIds.filter((verifierId) => isCapabilityVisible(auth, `verifier:${verifierId}`)),
      skillId: getPublicationSkillForCapability(`preset:${id}`)?.id ?? null,
    }))
}

export function listPublicationPrompts(
  auth?: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>
) {
  return presetRegistry
    .filter((entry) => isCapabilityVisible(auth, `prompt:${entry.id}`))
    .map(({ id, label, description }) => ({
      name: id,
      title: label,
      description,
      skillId: getPublicationSkillForCapability(`prompt:${id}`)?.id ?? null,
      arguments: [
        {
          name: 'identifier',
          description: 'Optional publication slug or UUID to load into the workflow prompt.',
          required: false,
        },
      ],
    }))
}

export function getPublicationPrompt(
  name: string,
  args: Record<string, unknown> = {},
  auth?: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'>
) {
  if (auth) {
    assertPublicationSkillCapabilityEnabled(auth, `prompt:${name}`)
  }

  const preset = presetRegistry.find((entry) => entry.id === name)
  if (!preset) {
    throw new PublicationApiError(404, 'prompt_not_found', `No publication prompt found for "${name}".`)
  }

  const identifier = typeof args.identifier === 'string' ? args.identifier.trim() : ''
  const promptText = [
    preset.prompt,
    '',
    'Recommended MCP workflow:',
    '- Read the document IR or fetch the article.',
    `- Run the preset "${preset.id}".`,
    '- Address high-severity findings first.',
    '- Return an updated markdown document or a concise action plan.',
    identifier ? `- Focus article identifier: ${identifier}` : '- Use the current markdown document when no identifier is supplied.',
  ].join('\n')

  return {
    description: preset.description,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: promptText,
        },
      },
    ],
  }
}

function isCapabilityVisible(
  auth: Pick<PublicationAuthContext, 'label' | 'tokenId' | 'profileId' | 'enabledSkillIds'> | undefined,
  capabilityId: string
) {
  if (!auth) {
    return true
  }

  try {
    assertPublicationSkillCapabilityEnabled(auth, capabilityId)
    return true
  } catch (error) {
    if (error instanceof PublicationApiError && error.code === 'skill_not_enabled') {
      return false
    }

    throw error
  }
}

async function verifyMathSanity(ir: PublicationDocumentIR): Promise<PublicationVerificationResult> {
  const findings: PublicationVerificationFinding[] = []
  const singleDollarCount = countSingleDollarDelimiters(ir.markdown)

  if (singleDollarCount % 2 !== 0) {
    findings.push({
      severity: 'error',
      code: 'math_unbalanced_inline_delimiters',
      message: 'Inline math delimiters appear unbalanced. Check unmatched `$` markers.',
    })
  }

  for (const equation of ir.equations) {
    const bracketCheck = checkBalancedBrackets(equation.source)
    if (!bracketCheck.ok) {
      findings.push({
        severity: 'warn',
        code: 'math_unbalanced_brackets',
        line: equation.line,
        message: `Equation appears to have unbalanced ${bracketCheck.symbolLabel}.`,
      })
    }
  }

  if (ir.equations.length > 0 && !ir.sections.some((section) => /result|theorem|proof|method/i.test(section.title))) {
    findings.push({
      severity: 'warn',
      code: 'math_missing_supporting_section',
      message: 'Equations are present, but there is no obvious theorem, proof, methods, or results section heading.',
    })
  }

  if (ir.equations.length === 0) {
    findings.push({
      severity: 'info',
      code: 'math_not_present',
      message: 'No equations were detected in the document.',
    })
  }

  return buildVerificationResult(
    'math_sanity',
    'Math Sanity',
    findings,
    findings.some((finding) => finding.severity === 'error')
      ? 'Math issues need attention before trusting formal notation.'
      : ir.equations.length > 0
        ? 'Mathematical notation looks structurally usable.'
        : 'No formal math content was detected.'
  )
}

async function verifyLeanArtifacts(ir: PublicationDocumentIR): Promise<PublicationVerificationResult> {
  const leanDirectives = ir.directives.filter((directive) => directive.name === 'lean' || directive.name === 'proof')
  const findings: PublicationVerificationFinding[] = []

  if (leanDirectives.length === 0) {
    return {
      verifierId: 'lean',
      label: 'Lean Verification',
      status: ir.equations.length > 0 ? 'warn' : 'pass',
      summary:
        ir.equations.length > 0
          ? 'Formal math exists, but no Lean/proof blocks were found.'
          : 'No Lean artifacts were present, and none appear required for this document.',
      findings:
        ir.equations.length > 0
          ? [
              {
                severity: 'warn',
                code: 'lean_block_missing',
                message: 'Consider adding a `::lean` block for formal math claims that should be machine-checkable.',
              },
            ]
          : [],
    }
  }

  const compiledArtifacts: Array<{ line: number; theorem?: string; status: 'checked' | 'skipped' | 'failed'; output?: string }> = []
  const leanAvailable = await commandExists('lean')

  for (const directive of leanDirectives) {
    const code = directive.attributes.code?.trim() || ''
    const theorem = directive.attributes.theorem?.trim() || undefined

    if (!code) {
      findings.push({
        severity: 'warn',
        code: 'lean_code_missing',
        line: directive.line,
        message: 'Lean/proof block is missing inline `code=` content.',
      })
      compiledArtifacts.push({ line: directive.line, theorem, status: 'skipped' })
      continue
    }

    if (!leanAvailable) {
      compiledArtifacts.push({
        line: directive.line,
        theorem,
        status: 'skipped',
        output: code,
      })
      continue
    }

    const compileResult = await compileLeanSnippet(code)
    compiledArtifacts.push({
      line: directive.line,
      theorem,
      status: compileResult.ok ? 'checked' : 'failed',
      output: compileResult.output,
    })

    if (!compileResult.ok) {
      findings.push({
        severity: 'error',
        code: 'lean_compile_failed',
        line: directive.line,
        message: `Lean reported an error: ${truncateText(compileResult.output, 180)}`,
      })
    }
  }

  if (!leanAvailable) {
    findings.push({
      severity: 'info',
      code: 'lean_cli_unavailable',
      message: 'Lean CLI is not installed in this environment, so proof blocks were analyzed but not compiled.',
    })
  }

  return {
    verifierId: 'lean',
    label: 'Lean Verification',
    status: findings.some((finding) => finding.severity === 'error')
      ? 'fail'
      : leanAvailable
        ? 'pass'
        : 'unavailable',
    summary: leanAvailable
      ? 'Lean proof artifacts were checked against the local Lean toolchain.'
      : 'Lean proof artifacts were discovered, but the local Lean toolchain is unavailable.',
    findings,
    data: {
      artifacts: compiledArtifacts,
    },
  }
}

async function verifyJournalStructure(ir: PublicationDocumentIR): Promise<PublicationVerificationResult> {
  const findings: PublicationVerificationFinding[] = []
  const { metadata } = ir.document
  const sectionTitles = ir.sections.map((section) => section.title.toLowerCase())

  if (!metadata.title.trim()) {
    findings.push({
      severity: 'error',
      code: 'journal_title_missing',
      message: 'The document is missing a publication title.',
    })
  }
  if (!metadata.abstract.trim()) {
    findings.push({
      severity: 'warn',
      code: 'journal_abstract_missing',
      message: 'A scientific abstract is recommended for journal-oriented workflows.',
    })
  }
  if (metadata.authors.length === 0) {
    findings.push({
      severity: 'warn',
      code: 'journal_authors_missing',
      message: 'No authors are declared in frontmatter.',
    })
  }
  if (!metadata.journal.trim()) {
    findings.push({
      severity: 'info',
      code: 'journal_name_missing',
      message: 'No journal or venue name is set yet.',
    })
  }
  if (!sectionTitles.some((title) => title.includes('introduction'))) {
    findings.push({
      severity: 'warn',
      code: 'journal_introduction_missing',
      message: 'An introduction section is recommended.',
    })
  }
  if (!sectionTitles.some((title) => /(conclusion|discussion|summary)/.test(title))) {
    findings.push({
      severity: 'warn',
      code: 'journal_conclusion_missing',
      message: 'A conclusion, discussion, or summary section is recommended.',
    })
  }
  if (ir.citations.length > 0 && ir.references.length === 0) {
    findings.push({
      severity: 'error',
      code: 'journal_references_missing',
      message: 'Inline citations are present, but no `::reference` entries were found.',
    })
  }

  return buildVerificationResult(
    'journal_structure',
    'Journal Structure',
    findings,
    findings.some((finding) => finding.severity === 'error')
      ? 'Journal structure has blockers to address.'
      : 'Journal-oriented structure looks workable, with some optional improvements.'
  )
}

async function verifySeoReadiness(ir: PublicationDocumentIR): Promise<PublicationVerificationResult> {
  const findings: PublicationVerificationFinding[] = []
  const { metadata } = ir.document
  const titleLength = metadata.title.trim().length
  const abstractLength = metadata.abstract.trim().length

  if (titleLength === 0) {
    findings.push({
      severity: 'error',
      code: 'seo_title_missing',
      message: 'The title is missing, which blocks search discoverability.',
    })
  } else if (titleLength < 30 || titleLength > 70) {
    findings.push({
      severity: 'warn',
      code: 'seo_title_length',
      message: `Title length is ${titleLength} characters. A search-friendly title is usually between 30 and 70 characters.`,
    })
  }

  if (abstractLength === 0) {
    findings.push({
      severity: 'warn',
      code: 'seo_description_missing',
      message: 'The abstract is missing; it often serves as the best meta-description source.',
    })
  } else if (abstractLength < 120 || abstractLength > 180) {
    findings.push({
      severity: 'info',
      code: 'seo_description_length',
      message: `Abstract length is ${abstractLength} characters. Search snippets often work best around 120 to 180 characters.`,
    })
  }

  if (!metadata.canonicalUrl.trim()) {
    findings.push({
      severity: 'warn',
      code: 'seo_canonical_missing',
      message: 'No canonical URL is set in frontmatter.',
    })
  }

  if (ir.headings.length < 2) {
    findings.push({
      severity: 'info',
      code: 'seo_heading_depth',
      message: 'The document has very few section headings, which can make it harder to scan and index.',
    })
  }

  return buildVerificationResult(
    'seo',
    'SEO Review',
    findings,
    findings.some((finding) => finding.severity === 'error')
      ? 'SEO blockers need attention.'
      : 'SEO metadata is usable, with a few recommended improvements.'
  )
}

function buildVerificationResult(
  verifierId: string,
  label: string,
  findings: PublicationVerificationFinding[],
  summary: string
): PublicationVerificationResult {
  return {
    verifierId,
    label,
    status: summarizeVerificationStatuses(
      findings.map((finding) => {
        if (finding.severity === 'error') return 'fail'
        if (finding.severity === 'warn') return 'warn'
        return 'pass'
      })
    ),
    summary,
    findings,
  }
}

function summarizeVerificationStatuses(statuses: PublicationVerificationStatus[]) {
  if (statuses.includes('fail')) return 'fail'
  if (statuses.includes('warn')) return 'warn'
  if (statuses.includes('unavailable')) return 'unavailable'
  return 'pass'
}

function summarizePresetResults(label: string, results: PublicationVerificationResult[]) {
  const counts = results.reduce(
    (acc, result) => {
      acc[result.status] += 1
      return acc
    },
    { pass: 0, warn: 0, fail: 0, unavailable: 0 }
  )

  return `${label}: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.unavailable} unavailable.`
}

function countSingleDollarDelimiters(markdown: string) {
  return (markdown.match(/(^|[^$])\$(?!\$)/g) ?? []).length
}

function checkBalancedBrackets(source: string) {
  const pairs: Array<{ open: string; close: string; symbolLabel: string }> = [
    { open: '(', close: ')', symbolLabel: 'parentheses' },
    { open: '[', close: ']', symbolLabel: 'brackets' },
    { open: '{', close: '}', symbolLabel: 'braces' },
  ]

  for (const pair of pairs) {
    let balance = 0
    for (const char of source) {
      if (char === pair.open) balance += 1
      if (char === pair.close) balance -= 1
      if (balance < 0) {
        return { ok: false, symbolLabel: pair.symbolLabel }
      }
    }
    if (balance !== 0) {
      return { ok: false, symbolLabel: pair.symbolLabel }
    }
  }

  return { ok: true, symbolLabel: '' }
}

async function commandExists(command: string) {
  try {
    await execFileAsync('which', [command])
    return true
  } catch {
    return false
  }
}

async function compileLeanSnippet(code: string) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'publication-lean-'))
  const filePath = path.join(tempDir, 'PublicationCheck.lean')

  try {
    await writeFile(filePath, code, 'utf8')
    const result = await execFileAsync('lean', [filePath], { timeout: 15_000 })
    return {
      ok: true,
      output: `${result.stdout}\n${result.stderr}`.trim(),
    }
  } catch (error) {
    const output =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: string }).stderr ?? '')
        : error instanceof Error
          ? error.message
          : 'Unknown Lean execution error.'

    return {
      ok: false,
      output,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
