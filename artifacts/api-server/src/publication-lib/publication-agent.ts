import {
  composePublicationMarkdown,
  createEmptyPublicationMetadata,
  extractPublicationDocument,
  normalizePublicationMetadata,
  type PublicationFrontmatter,
  type PublicationMetadata,
} from './publications.js'
import { PublicationApiError } from './publication-errors.js'

export type PublicationAgentRequest = {
  instruction: string
  currentMarkdown?: string
  articleTitle?: string
  metadata?: Partial<PublicationMetadata>
  body?: string
  customFrontmatter?: PublicationFrontmatter
  model?: string
  temperature?: number
}

export type PublicationAgentResult = {
  markdown: string
  document: ReturnType<typeof extractPublicationDocument>
  model: string
  provider: 'openrouter'
}

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5-mini'
const PUBLICATION_BLOCK_GUIDE = [
  'Use YAML frontmatter for publication metadata.',
  'Supported media blocks include ::figure{...}, ::video{...}, ::interactive{...}, ::download{...}, :::note{...}...:::, :::result{...}...:::, ::chart{...}, ::dataset{...}, ::notebook{...}, and ::lean{...}.',
  'Use GitHub-flavored markdown for headings, lists, links, tables, and code fences.',
  'Use KaTeX-compatible math for inline and block equations.',
  'Use citations like [@smith2024], references as ::reference{...}, and bibliography as ::bibliography{title="References"}.',
  'Return one complete markdown document only, with no surrounding commentary or code fences.',
].join('\n')

async function generateDraft(input: PublicationAgentRequest): Promise<PublicationAgentResult> {
  const instruction = input.instruction.trim()

  if (!instruction) {
    throw new PublicationApiError(400, 'instruction_missing', 'An instruction is required for publication drafting.')
  }

  const model = input.model?.trim() || process.env.PUBLICATION_AGENT_MODEL || DEFAULT_OPENROUTER_MODEL
  const markdownContext = resolveMarkdownContext(input)
  if (instruction.length > 8000 || Buffer.byteLength(markdownContext) > 256 * 1024) throw new PublicationApiError(413, 'generation_context_too_large', 'Drafting context exceeds the configured input budget.')
  const allowed = (process.env.PUBLICATION_AGENT_ALLOWED_MODELS || process.env.PUBLICATION_AGENT_MODEL || DEFAULT_OPENROUTER_MODEL).split(',').map(value => value.trim())
  if (!allowed.includes(model)) throw new PublicationApiError(403, 'generation_model_not_allowed', 'This model is not enabled by the engine operator.')
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new PublicationApiError(
      500,
      'openrouter_api_key_missing',
      'OPENROUTER_API_KEY must be configured before using the publication agent.'
    )
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || 'https://your-domain.example',
    'X-Title': 'Publication MCP Studio',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: typeof input.temperature === 'number' ? input.temperature : 0.2,
      messages: [
        {
          role: 'system',
          content: [
    'You are a scientific publication formatter for a markdown-first publication platform.',
            'Rewrite or extend documents into polished publication markdown that matches the site renderer.',
            PUBLICATION_BLOCK_GUIDE,
          ].join('\n\n'),
        },
        {
          role: 'user',
          content: [
            `Instruction:\n${instruction}`,
            markdownContext ? `Current document:\n\n${markdownContext}` : 'Current document:\n\n(Empty document)',
          ].join('\n\n'),
        },
      ],
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new PublicationApiError(response.status, 'openrouter_request_failed', `Draft provider request failed (${response.status}).`)
  }

  const markdown = stripMarkdownFences(extractAssistantText(payload).trim())

  if (!markdown) {
    throw new PublicationApiError(502, 'empty_agent_response', 'The publication agent returned an empty markdown response.')
  }

  return {
    markdown,
    document: extractPublicationDocument(markdown, input.articleTitle?.trim() || ''),
    model,
    provider: 'openrouter',
  }
}

function resolveMarkdownContext(input: PublicationAgentRequest) {
  if (input.currentMarkdown?.trim()) {
    return input.currentMarkdown.trim()
  }

  if (input.metadata || input.body || input.customFrontmatter) {
    const metadata = normalizePublicationMetadata({
      ...createEmptyPublicationMetadata(input.articleTitle?.trim() || ''),
      ...(input.metadata ?? {}),
      title: input.articleTitle?.trim() || input.metadata?.title?.trim() || '',
    })

    return composePublicationMarkdown(metadata, input.body ?? '', input.customFrontmatter ?? {})
  }

  return ''
}

function extractAssistantText(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('choices' in payload) || !Array.isArray(payload.choices)) {
    return ''
  }

  const firstChoice = payload.choices[0]
  const message = firstChoice && typeof firstChoice === 'object' ? firstChoice.message : null

  if (!message || typeof message !== 'object' || !('content' in message)) {
    return ''
  }

  const content = message.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return ''
        }

        if ('text' in part && typeof part.text === 'string') {
          return part.text
        }

        return ''
      })
      .join('\n')
  }

  return ''
}

function stripMarkdownFences(value: string) {
  return value.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function stringifyProviderError(errorValue: unknown) {
  if (typeof errorValue === 'string') {
    return errorValue
  }

  if (errorValue && typeof errorValue === 'object' && 'message' in errorValue && typeof errorValue.message === 'string') {
    return errorValue.message
  }

  return 'The OpenRouter request failed.'
}

let activeGenerations = 0
export async function generatePublicationDraft(input: PublicationAgentRequest): Promise<PublicationAgentResult> {
  if (activeGenerations >= 2) throw new PublicationApiError(429, 'generation_busy', 'Draft generation capacity is currently full.')
  activeGenerations++
  try { return await generateDraft(input) } finally { activeGenerations-- }
}
