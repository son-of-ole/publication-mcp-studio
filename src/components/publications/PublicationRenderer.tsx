import clsx from 'clsx'
import katex from 'katex'
import { Marked, type Token, type Tokens } from 'marked'
import type { CSSProperties, ElementType, ReactNode } from 'react'
import PublicationChartBlock from './PublicationChartBlock'
import {
  createPublicationHeadingAnchor,
  extractPublicationReferences,
  formatPublicationBibliographyHtml,
  formatPublicationCitationLabel,
  getPublicationReferenceAnchor,
  normalizePublicationHeadingText,
  parseDirectiveAttributes,
  parsePublicationCitationKeys,
  type PublicationReference,
} from '@/lib/publications'
import 'katex/dist/katex.min.css'

type MathBlockToken = Tokens.Generic & {
  type: 'mathBlock'
  math: string
}

type DirectiveBlockToken = Tokens.Generic & {
  type: 'directiveBlock'
  name: string
  attributes: Record<string, string>
}

type CalloutBlockToken = Tokens.Generic & {
  type: 'calloutBlock'
  tone: string
  attributes: Record<string, string>
  tokens: Token[]
}

type LegacyImageConfig = {
  alt: string
  width?: number
  float?: 'left' | 'right'
}

const markedInstance = new Marked()

const highlightExtension = {
  name: 'highlight',
  level: 'inline' as const,
  start(src: string) {
    return src.match(/==/)?.index
  },
  tokenizer(this: { lexer: { inlineTokens: (src: string) => Token[] } }, src: string) {
    const match = /^==([^=]+)==/.exec(src)
    if (!match) {
      return undefined
    }

    return {
      type: 'highlight',
      raw: match[0],
      text: match[1],
      tokens: this.lexer.inlineTokens(match[1]),
    }
  },
}

const underlineExtension = {
  name: 'underline',
  level: 'inline' as const,
  start(src: string) {
    return src.match(/\+\+/)?.index
  },
  tokenizer(this: { lexer: { inlineTokens: (src: string) => Token[] } }, src: string) {
    const match = /^\+\+([^+]+)\+\+/.exec(src)
    if (!match) {
      return undefined
    }

    return {
      type: 'underline',
      raw: match[0],
      text: match[1],
      tokens: this.lexer.inlineTokens(match[1]),
    }
  },
}

const mathBlockExtension = {
  name: 'mathBlock',
  level: 'block' as const,
  start(src: string) {
    return src.match(/\$\$/)?.index
  },
  tokenizer(src: string) {
    const match = /^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n+|$)/.exec(src)
    if (!match) {
      return undefined
    }

    return {
      type: 'mathBlock',
      raw: match[0],
      math: match[1].trim(),
    }
  },
}

const directiveBlockExtension = {
  name: 'directiveBlock',
  level: 'block' as const,
  start(src: string) {
    return src.match(/^::(figure|video|interactive|download|bibliography|chart|dataset|notebook|proof|lean)\b/m)?.index
  },
  tokenizer(src: string) {
    const match = /^::(figure|video|interactive|download|bibliography|chart|dataset|notebook|proof|lean)\{([^}]*)\}(?:\n+|$)/.exec(src)
    if (!match) {
      return undefined
    }

    return {
      type: 'directiveBlock',
      raw: match[0],
      name: match[1],
      attributes: parseDirectiveAttributes(match[2] ?? ''),
    }
  },
}

const calloutBlockExtension = {
  name: 'calloutBlock',
  level: 'block' as const,
  childTokens: ['tokens'],
  start(src: string) {
    return src.match(/^:::(note|tip|warning|result|experiment)\b/m)?.index
  },
  tokenizer(
    this: { lexer: { blockTokens: (src: string, tokens?: Token[]) => Token[] } },
    src: string,
  ) {
    const match = /^:::(note|tip|warning|result|experiment)(?:\{([^}]*)\})?\n([\s\S]+?)\n:::(?:\n+|$)/.exec(src)
    if (!match) {
      return undefined
    }

    return {
      type: 'calloutBlock',
      raw: match[0],
      tone: match[1],
      attributes: parseDirectiveAttributes(match[2] ?? ''),
      tokens: this.lexer.blockTokens(match[3].trim()),
    }
  },
}

markedInstance.use({
  gfm: true,
  breaks: false,
  extensions: [highlightExtension, underlineExtension, mathBlockExtension, directiveBlockExtension, calloutBlockExtension],
})

function renderInlineCitation(source: string, key: string, referencesById: Map<string, PublicationReference>) {
  const referenceIds = parsePublicationCitationKeys(source)

  if (referenceIds.length === 0) {
    return <span key={key}>{source}</span>
  }

  return (
    <span key={key} className="whitespace-nowrap">
      (
      {referenceIds.map((referenceId, index) => {
        const reference = referencesById.get(referenceId)
        const label = reference ? formatPublicationCitationLabel(reference) : referenceId

        return (
          <span key={`${key}-${referenceId}`}>
            {index > 0 ? '; ' : null}
            {reference ? (
              <a
                href={`#${getPublicationReferenceAnchor(referenceId)}`}
                className="font-medium text-cyan-700 underline decoration-cyan-300 underline-offset-4 transition-colors hover:text-cyan-900"
              >
                {label}
              </a>
            ) : (
              <span className="text-slate-500">{label}</span>
            )}
          </span>
        )
      })}
      )
    </span>
  )
}

function renderInlineText(text: string, keyPrefix: string, referencesById: Map<string, PublicationReference>) {
  const chunks = text.split(/(\$[^$\n]+\$|\[@[^\]]+\])/g)

  return chunks.map((chunk, index) => {
    const key = `${keyPrefix}-segment-${index}`

    if (!chunk) {
      return null
    }

    if (chunk.startsWith('$') && chunk.endsWith('$')) {
      try {
        return (
          <span
            key={key}
            className="align-middle"
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(chunk.slice(1, -1), {
                throwOnError: false,
                output: 'html',
              }),
            }}
          />
        )
      } catch {
        return <span key={key}>{chunk}</span>
      }
    }

    if (chunk.startsWith('[@') && chunk.endsWith(']')) {
      return renderInlineCitation(chunk, key, referencesById)
    }

    return <span key={key}>{chunk}</span>
  })
}

function parseDelimitedAttribute(value: string | undefined, delimiter = '|') {
  return (value ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseMultilineDirectiveValue(value: string | undefined) {
  return (value ?? '').replace(/\\n/g, '\n').trim()
}

function parseChartSeries(value: string | undefined, labelCount: number) {
  return parseDelimitedAttribute(value, ';')
    .map((entry) => {
      const [rawLabel, rawValues = ''] = entry.split(':')
      const label = rawLabel?.trim()
      const values = rawValues
        .split(',')
        .map((item) => Number.parseFloat(item.trim()))
        .filter((item) => !Number.isNaN(item))

      if (!label || values.length === 0) {
        return null
      }

      return {
        label,
        values: labelCount > 0 ? values.slice(0, labelCount) : values,
      }
    })
    .filter((entry): entry is { label: string; values: number[] } => Boolean(entry))
}

function parseDatasetRows(value: string | undefined) {
  return parseDelimitedAttribute(value, ';').map((row) => parseDelimitedAttribute(row))
}

function parseLegacyImageConfig(rawAlt: string): LegacyImageConfig {
  const width = rawAlt.match(/[wW][:=-]?(\d+)/)?.[1]
  const float =
    rawAlt.includes('float-right') || rawAlt.includes('float=right')
      ? 'right'
      : rawAlt.includes('float-left') || rawAlt.includes('float=left')
        ? 'left'
        : undefined

  let cleanAlt = rawAlt.replace(/,\s*(w=|w:|mt=|mt:|y=|y:|float-right|float=right|float-left|float=left)[^,]*/g, '')
  cleanAlt = cleanAlt.replace(/\|\s*(w=|w:|mt=|mt:|y=|y:|float).*$/g, '').trim()

  return {
    alt: cleanAlt,
    width: width ? Number.parseInt(width, 10) : undefined,
    float,
  }
}

function renderLegacyImage(token: Tokens.Image, key: string, inGallery = false) {
  const config = parseLegacyImageConfig(token.text ?? '')
  const wrapperStyle: CSSProperties = inGallery
    ? {}
    : {
        maxWidth: config.width ? `${config.width}px` : '100%',
        float: config.float,
      }

  return (
    <span
      key={key}
      className={clsx(
        'block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]',
        inGallery ? 'h-full w-full' : config.float ? 'my-2' : 'my-8',
      )}
      style={wrapperStyle}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={token.href}
        alt={config.alt || token.text || ''}
        className={clsx(
          'block w-full bg-slate-50 object-cover',
          inGallery ? 'aspect-[4/3]' : 'h-auto',
        )}
      />
    </span>
  )
}

function renderInlineTokens(
  tokens: Token[] = [],
  keyPrefix: string,
  referencesById: Map<string, PublicationReference>,
): ReactNode {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`

    switch (token.type) {
      case 'text':
        return <span key={key}>{renderInlineText(token.text, key, referencesById)}</span>
      case 'highlight':
        return (
          <mark key={key} className="rounded bg-amber-200/80 px-1 text-slate-950">
            {renderInlineTokens((token as Tokens.Generic).tokens as Token[], key, referencesById)}
          </mark>
        )
      case 'underline':
        return (
          <span key={key} className="underline decoration-1 underline-offset-4">
            {renderInlineTokens((token as Tokens.Generic).tokens as Token[], key, referencesById)}
          </span>
        )
      case 'strong':
        return <strong key={key}>{renderInlineTokens(token.tokens, key, referencesById)}</strong>
      case 'em':
        return <em key={key}>{renderInlineTokens(token.tokens, key, referencesById)}</em>
      case 'del':
        return (
          <del key={key} className="text-slate-500">
            {renderInlineTokens(token.tokens, key, referencesById)}
          </del>
        )
      case 'codespan':
        return (
          <code key={key} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800">
            {token.text}
          </code>
        )
      case 'br':
        return <br key={key} />
      case 'escape':
        return <span key={key}>{token.text}</span>
      case 'link': {
        const isExternal = /^https?:\/\//.test(token.href)
        return (
          <a
            key={key}
            href={token.href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noreferrer' : undefined}
            className="font-medium text-cyan-700 underline decoration-cyan-300 underline-offset-4 transition-colors hover:text-cyan-900"
          >
            {renderInlineTokens(token.tokens, key, referencesById)}
          </a>
        )
      }
      case 'image':
        return renderLegacyImage(token as Tokens.Image, key)
      default:
        return null
    }
  })
}

function renderDirectiveBlock(
  token: DirectiveBlockToken,
  key: string,
  references: PublicationReference[],
) {
  const { attributes } = token
  const caption = attributes.caption
  const credit = attributes.credit
  const title = attributes.title

  if (token.name === 'figure' && attributes.src) {
    const figureImage = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attributes.src}
          alt={attributes.alt ?? caption ?? title ?? ''}
          className="block w-full rounded-[1.35rem] border border-slate-200 bg-slate-50 object-cover shadow-[0_24px_60px_rgba(15,23,42,0.08)]"
        />
        {(caption || credit) && (
          <figcaption className="mt-4 text-sm leading-6 text-slate-500">
            {caption && <span className="font-medium text-slate-700">{caption}</span>}
            {caption && credit && <span className="mx-2 text-slate-300">/</span>}
            {credit && <span>{credit}</span>}
          </figcaption>
        )}
      </>
    )

    return (
      <figure key={key} className="my-10">
        {attributes.href ? (
          <a href={attributes.href} target="_blank" rel="noreferrer">
            {figureImage}
          </a>
        ) : (
          figureImage
        )}
      </figure>
    )
  }

  if (token.name === 'video' && attributes.src) {
    return (
      <figure key={key} className="my-10 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-950/95 shadow-[0_30px_80px_rgba(15,23,42,0.16)]">
        <video
          controls
          playsInline
          preload="metadata"
          poster={attributes.poster}
          className="block aspect-video w-full bg-slate-950"
          src={attributes.src}
        />
        {(caption || credit) && (
          <figcaption className="border-t border-white/10 px-5 py-4 text-sm leading-6 text-slate-300">
            {caption && <span className="font-medium text-white">{caption}</span>}
            {caption && credit && <span className="mx-2 text-white/20">/</span>}
            {credit && <span>{credit}</span>}
          </figcaption>
        )}
      </figure>
    )
  }

  if (token.name === 'interactive') {
    const height = Number.parseInt(attributes.height ?? '560', 10)
    const label = title ?? attributes.kind ?? 'Interactive module'

    return (
      <section
        key={key}
        className="my-10 overflow-hidden rounded-[1.5rem] border border-cyan-200/70 bg-[linear-gradient(135deg,#ecfeff_0%,#f8fafc_55%,#f0fdf4_100%)] shadow-[0_28px_80px_rgba(8,145,178,0.14)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-cyan-200/70 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-700">Interactive Block</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{label}</h3>
          </div>
          {attributes.href && (
            <a
              href={attributes.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-cyan-300 bg-white/80 px-4 py-2 text-sm font-medium text-cyan-800 transition-colors hover:bg-cyan-50"
            >
              Open Source
            </a>
          )}
        </div>
        {attributes.src ? (
          <iframe
            src={attributes.src}
            title={label}
            loading="lazy"
            className="block w-full border-0 bg-white"
            style={{ height: `${height}px` }}
          />
        ) : (
          <div className="px-5 py-8 text-sm leading-7 text-slate-600">
            Add a `src` attribute to load an iframe-backed demo, chart, notebook, or proof viewer here.
          </div>
        )}
      </section>
    )
  }

  if (token.name === 'chart') {
    const labels = parseDelimitedAttribute(attributes.labels)
    const series = parseChartSeries(attributes.series, labels.length)
    const chartType = attributes.type === 'line' || attributes.type === 'radar' ? attributes.type : 'bar'
    const min = Number.parseFloat(attributes.min ?? '')
    const max = Number.parseFloat(attributes.max ?? '')
    const height = Number.parseInt(attributes.height ?? '380', 10)

    if (labels.length === 0 || series.length === 0) {
      return (
        <section key={key} className="my-10 rounded-[1.5rem] border border-dashed border-amber-300 bg-amber-50 px-5 py-6">
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">Chart Block</div>
          <p className="mt-3 text-sm leading-7 text-amber-900">
            Add quoted <code>labels</code> and <code>series</code> attributes to render this chart.
          </p>
        </section>
      )
    }

    return (
      <PublicationChartBlock
        key={key}
        title={title ?? 'Research Chart'}
        subtitle={attributes.caption ?? attributes.summary}
        labels={labels}
        series={series}
        chartType={chartType}
        yLabel={attributes.yLabel ?? attributes.ylabel}
        min={Number.isNaN(min) ? undefined : min}
        max={Number.isNaN(max) ? undefined : max}
        height={Number.isNaN(height) ? undefined : height}
      />
    )
  }

  if (token.name === 'dataset') {
    const columns = parseDelimitedAttribute(attributes.columns)
    const rows = parseDatasetRows(attributes.rows)

    return (
      <section
        key={key}
        className="my-10 overflow-hidden rounded-[1.55rem] border border-slate-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.07)]"
      >
        <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#f0fdf4_100%)] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Dataset Snapshot</div>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title ?? 'Dataset Table'}</h3>
              {attributes.summary ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{attributes.summary}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {attributes.source ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{attributes.source}</span> : null}
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{rows.length} rows</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto px-5 py-5">
          <table className="min-w-full border-collapse text-left text-sm">
            {columns.length > 0 ? (
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  {columns.map((column, index) => (
                    <th key={`${key}-dataset-column-${index}`} className="border-b border-slate-200 px-4 py-3 font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${key}-dataset-row-${rowIndex}`} className="border-b border-slate-100 last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-dataset-cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top text-slate-600">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(attributes.href || attributes.download) ? (
          <div className="border-t border-slate-200 px-5 py-4">
            <a
              href={attributes.href ?? attributes.download}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800"
            >
              {attributes.label ?? 'Open Dataset Resource'}
            </a>
          </div>
        ) : null}
      </section>
    )
  }

  if (token.name === 'notebook') {
    const height = Number.parseInt(attributes.height ?? '620', 10)
    const label = title ?? 'Research Notebook'

    return (
      <section
        key={key}
        className="my-10 overflow-hidden rounded-[1.55rem] border border-indigo-200/70 bg-[linear-gradient(135deg,#eef2ff_0%,#ffffff_55%,#f8fafc_100%)] shadow-[0_28px_80px_rgba(79,70,229,0.12)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-indigo-200/70 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-indigo-700">
              {attributes.badge ?? 'Notebook Embed'}
            </div>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{label}</h3>
            {attributes.summary ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{attributes.summary}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            {attributes.runtime ? <span className="rounded-full border border-indigo-200 bg-white/80 px-3 py-1">{attributes.runtime}</span> : null}
            {attributes.kernel ? <span className="rounded-full border border-indigo-200 bg-white/80 px-3 py-1">{attributes.kernel}</span> : null}
          </div>
        </div>
        {attributes.src ? (
          <iframe
            src={attributes.src}
            title={label}
            loading="lazy"
            className="block w-full border-0 bg-white"
            style={{ height: `${Number.isNaN(height) ? 620 : height}px` }}
          />
        ) : (
          <div className="px-5 py-8 text-sm leading-7 text-slate-600">
            Add a <code>src</code> attribute to embed a Jupyter, Colab, Observable, or other notebook view here.
          </div>
        )}
        {attributes.href ? (
          <div className="border-t border-indigo-200/70 px-5 py-4">
            <a
              href={attributes.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-indigo-300 bg-white/85 px-4 py-2 text-sm font-medium text-indigo-800 transition-colors hover:bg-indigo-50"
            >
              {attributes.label ?? 'Open Notebook'}
            </a>
          </div>
        ) : null}
      </section>
    )
  }

  if (token.name === 'proof' || token.name === 'lean') {
    const code = parseMultilineDirectiveValue(attributes.code)
    const system = attributes.system ?? (token.name === 'lean' ? 'Lean 4' : 'Proof System')
    const status = attributes.status ?? 'draft'
    const height = Number.parseInt(attributes.height ?? '560', 10)

    return (
      <section
        key={key}
        className="my-10 overflow-hidden rounded-[1.55rem] border border-fuchsia-200/70 bg-[linear-gradient(135deg,#fdf4ff_0%,#ffffff_55%,#faf5ff_100%)] shadow-[0_26px_80px_rgba(192,38,211,0.11)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-fuchsia-200/70 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-700">
              {token.name === 'lean' ? 'Lean Block' : 'Proof Block'}
            </div>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title ?? 'Formal Proof'}</h3>
            {attributes.theorem ? <p className="mt-2 text-sm font-medium text-slate-700">Theorem: {attributes.theorem}</p> : null}
            {attributes.summary ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{attributes.summary}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            <span className="rounded-full border border-fuchsia-200 bg-white/85 px-3 py-1">{system}</span>
            <span className="rounded-full border border-fuchsia-200 bg-white/85 px-3 py-1">{status}</span>
          </div>
        </div>

        {attributes.src ? (
          <iframe
            src={attributes.src}
            title={title ?? 'Formal proof'}
            loading="lazy"
            className="block w-full border-0 bg-white"
            style={{ height: `${Number.isNaN(height) ? 560 : height}px` }}
          />
        ) : code ? (
          <div className="bg-slate-950 px-5 py-5">
            <pre className="overflow-x-auto text-sm leading-7 text-slate-100">
              <code>{code}</code>
            </pre>
          </div>
        ) : (
          <div className="px-5 py-8 text-sm leading-7 text-slate-600">
            Add either a <code>src</code> attribute for an embedded proof viewer or a quoted <code>code</code> attribute
            with escaped newlines to render the formal artifact inline.
          </div>
        )}

        {attributes.href ? (
          <div className="border-t border-fuchsia-200/70 px-5 py-4">
            <a
              href={attributes.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border border-fuchsia-300 bg-white/85 px-4 py-2 text-sm font-medium text-fuchsia-800 transition-colors hover:bg-fuchsia-50"
            >
              {attributes.label ?? 'Open Proof Source'}
            </a>
          </div>
        ) : null}
      </section>
    )
  }

  if (token.name === 'download' && attributes.href) {
    return (
      <div key={key} className="my-8 rounded-[1.35rem] border border-slate-200 bg-slate-50 p-5">
        <a
          href={attributes.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
        >
          {attributes.label ?? 'Open Resource'}
        </a>
      </div>
    )
  }

  if (token.name === 'bibliography') {
    return renderBibliographySection(
      key,
      references,
      attributes.title ?? 'References',
      attributes.lead ?? 'Structured reference entries are rendered below in publication format.',
    )
  }

  return null
}

function renderCalloutBlock(
  token: CalloutBlockToken,
  key: string,
  referencesById: Map<string, PublicationReference>,
  references: PublicationReference[],
  seenHeadingIds: Map<string, number>,
) {
  const tone = token.tone
  const toneStyles = {
    note: 'border-cyan-200 bg-cyan-50/80 text-cyan-950',
    tip: 'border-emerald-200 bg-emerald-50/80 text-emerald-950',
    warning: 'border-amber-200 bg-amber-50/85 text-amber-950',
    result: 'border-indigo-200 bg-indigo-50/85 text-indigo-950',
    experiment: 'border-fuchsia-200 bg-fuchsia-50/80 text-fuchsia-950',
  } as const

  const title = token.attributes.title ?? `${tone.charAt(0).toUpperCase()}${tone.slice(1)}`

  return (
    <section
      key={key}
      className={clsx(
        'my-8 rounded-[1.4rem] border px-5 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.05)]',
        toneStyles[tone as keyof typeof toneStyles] ?? toneStyles.note,
      )}
    >
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] opacity-80">{title}</div>
      <div className="prose prose-slate max-w-none prose-p:my-4 prose-strong:text-current">
        {renderBlockTokens(token.tokens, `${key}-callout`, referencesById, references, seenHeadingIds)}
      </div>
    </section>
  )
}

function renderMathBlock(token: MathBlockToken, key: string) {
  return (
    <div
      key={key}
      className="my-8 overflow-x-auto rounded-[1.25rem] border border-slate-200 bg-slate-50 px-5 py-6 text-center"
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(token.math, {
          displayMode: true,
          throwOnError: false,
          output: 'html',
        }),
      }}
    />
  )
}

function renderLegacyGallery(text: string, token: Tokens.Paragraph, key: string) {
  if (!text.startsWith('[gallery')) {
    return null
  }

  const images = ((token.tokens ?? []) as Token[]).filter((child): child is Tokens.Image => child.type === 'image')
  if (images.length === 0) {
    return null
  }

  const galleryClass =
    images.length === 2
      ? 'grid-cols-2'
      : images.length === 3
        ? 'grid-cols-3'
        : images.length >= 4
          ? 'grid-cols-2'
          : 'grid-cols-1'

  return (
    <div key={key} className={clsx('my-10 grid gap-4', galleryClass)}>
      {images.map((image, index) => renderLegacyImage(image, `${key}-img-${index}`, true))}
    </div>
  )
}

function renderParagraph(token: Tokens.Paragraph, key: string, referencesById: Map<string, PublicationReference>) {
  let paragraphText = token.text ?? ''
  let textAlign: CSSProperties['textAlign'] = 'left'
  let dropCap: string | null = null

  const gallery = renderLegacyGallery(paragraphText, token, key)
  if (gallery) {
    return gallery
  }

  if (paragraphText.startsWith('[center]')) {
    textAlign = 'center'
    paragraphText = paragraphText.slice(8).trim()
  } else if (paragraphText.startsWith('[right]')) {
    textAlign = 'right'
    paragraphText = paragraphText.slice(7).trim()
  } else if (paragraphText.startsWith('[justify]')) {
    textAlign = 'justify'
    paragraphText = paragraphText.slice(9).trim()
  }

  if (paragraphText.startsWith('[dropcap]')) {
    paragraphText = paragraphText.slice(9).trim()
    dropCap = paragraphText.charAt(0)
    paragraphText = paragraphText.slice(1).trim()
  }

  const reparsedParagraph = markedInstance.lexer(paragraphText)[0] as Tokens.Paragraph | undefined
  const paragraphTokens = reparsedParagraph?.tokens ?? []

  return (
    <p
      key={key}
      className="my-6 text-[1.05rem] leading-8 text-slate-700"
      style={{ textAlign, textWrap: 'pretty' }}
    >
      {dropCap && (
        <span className="mr-3 float-left font-serif text-6xl font-bold leading-[0.9] text-slate-950">
          {dropCap}
        </span>
      )}
      {renderInlineTokens(paragraphTokens, `${key}-inline`, referencesById)}
    </p>
  )
}

function renderHeading(
  token: Tokens.Heading,
  key: string,
  referencesById: Map<string, PublicationReference>,
  seenHeadingIds: Map<string, number>,
) {
  let headingText = token.text ?? ''
  let textAlign: CSSProperties['textAlign'] = 'left'

  if (headingText.startsWith('[center]')) {
    textAlign = 'center'
    headingText = headingText.slice(8).trim()
  } else if (headingText.startsWith('[right]')) {
    textAlign = 'right'
    headingText = headingText.slice(7).trim()
  }

  headingText = normalizePublicationHeadingText(headingText)

  const reparsedHeading = markedInstance.lexer(headingText)[0] as Tokens.Paragraph | undefined
  const headingTokens = reparsedHeading?.tokens ?? []
  const id = createPublicationHeadingAnchor(headingText, seenHeadingIds)
  const Tag = `h${Math.min(token.depth, 4)}` as ElementType
  const classes = {
    1: 'mt-12 text-4xl font-semibold tracking-tight text-slate-950',
    2: 'mt-14 text-3xl font-semibold tracking-tight text-slate-950',
    3: 'mt-10 text-2xl font-semibold tracking-tight text-slate-950',
    4: 'mt-8 text-xl font-semibold tracking-tight text-slate-950',
  } as const

  return (
    <Tag key={key} id={id} className={classes[Math.min(token.depth, 4) as 1 | 2 | 3 | 4]} style={{ textAlign }}>
      {renderInlineTokens(headingTokens, `${key}-heading`, referencesById)}
    </Tag>
  )
}

function renderList(token: Tokens.List, key: string, referencesById: Map<string, PublicationReference>) {
  const Tag = token.ordered ? 'ol' : 'ul'

  return (
    <Tag
      key={key}
      className={clsx(
        'my-6 space-y-3 pl-6 text-[1.02rem] leading-8 text-slate-700',
        token.ordered ? 'list-decimal' : 'list-disc',
      )}
    >
      {token.items.map((item, index) => (
        <li key={`${key}-item-${index}`}>
          {item.task && (
            <input
              type="checkbox"
              checked={item.checked}
              readOnly
              className="mr-3 inline-block h-4 w-4 rounded border-slate-300 align-middle"
            />
          )}
          {renderInlineTokens(item.tokens ?? [], `${key}-item-inline-${index}`, referencesById)}
        </li>
      ))}
    </Tag>
  )
}

function renderTable(token: Tokens.Table, key: string, referencesById: Map<string, PublicationReference>) {
  return (
    <div key={key} className="my-8 overflow-x-auto rounded-[1.2rem] border border-slate-200">
      <table className="min-w-full border-collapse bg-white text-left text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            {token.header.map((cell, index) => (
              <th key={`${key}-header-${index}`} className="border-b border-slate-200 px-4 py-3 font-semibold">
                {renderInlineTokens(cell.tokens, `${key}-header-inline-${index}`, referencesById)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {token.rows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`} className="border-b border-slate-100 last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={`${key}-cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top text-slate-600">
                  {renderInlineTokens(cell.tokens, `${key}-cell-inline-${rowIndex}-${cellIndex}`, referencesById)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderBibliographySection(
  key: string,
  references: PublicationReference[],
  title = 'References',
  lead?: string,
) {
  if (references.length === 0) {
    return (
      <section key={key} className="my-12 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-6">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{title}</div>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          Add one or more <code>::reference&#123;...&#125;</code> blocks to populate this bibliography.
        </p>
      </section>
    )
  }

  return (
    <section key={key} className="my-12 rounded-[1.6rem] border border-slate-200 bg-slate-50/80 px-5 py-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
      <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700">Scholarly Apparatus</div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      {lead ? <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{lead}</p> : null}
      <div
        className="publication-bibliography mt-6 text-[1.02rem] leading-8 text-slate-700"
        dangerouslySetInnerHTML={{ __html: formatPublicationBibliographyHtml(references) }}
      />
    </section>
  )
}

function renderBlockTokens(
  tokens: Token[],
  keyPrefix: string,
  referencesById: Map<string, PublicationReference>,
  references: PublicationReference[],
  seenHeadingIds: Map<string, number>,
): ReactNode {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`

    switch (token.type) {
      case 'heading':
        return renderHeading(token as Tokens.Heading, key, referencesById, seenHeadingIds)
      case 'paragraph':
        return renderParagraph(token as Tokens.Paragraph, key, referencesById)
      case 'list':
        return renderList(token as Tokens.List, key, referencesById)
      case 'blockquote':
        return (
          <blockquote
            key={key}
            className="my-8 rounded-r-[1.25rem] border-l-4 border-cyan-500 bg-cyan-50/60 px-5 py-4 text-slate-700"
          >
            {renderBlockTokens((token.tokens ?? []) as Token[], `${key}-blockquote`, referencesById, references, seenHeadingIds)}
          </blockquote>
        )
      case 'code':
        return (
          <div key={key} className="my-8 overflow-hidden rounded-[1.25rem] border border-slate-200 bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
            {token.lang && (
              <div className="border-b border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                {token.lang}
              </div>
            )}
            <pre className="overflow-x-auto p-4 text-sm leading-7 text-slate-100">
              <code>{token.text}</code>
            </pre>
          </div>
        )
      case 'table':
        return renderTable(token as Tokens.Table, key, referencesById)
      case 'hr':
        return <hr key={key} className="my-12 border-slate-200" />
      case 'mathBlock':
        return renderMathBlock(token as MathBlockToken, key)
      case 'directiveBlock':
        return renderDirectiveBlock(token as DirectiveBlockToken, key, references)
      case 'calloutBlock':
        return renderCalloutBlock(token as CalloutBlockToken, key, referencesById, references, seenHeadingIds)
      default:
        return null
    }
  })
}

export default function PublicationRenderer({ markdown }: { markdown: string }) {
  const { body, references } = extractPublicationReferences(markdown)
  const tokens = markedInstance.lexer(body) as unknown as Token[]
  const referencesById = new Map(references.map((reference) => [reference.id, reference]))
  const seenHeadingIds = new Map<string, number>()
  const hasBibliographyDirective = tokens.some(
    (token) => token.type === 'directiveBlock' && (token as DirectiveBlockToken).name === 'bibliography',
  )

  return (
    <div>
      {renderBlockTokens(tokens, 'publication', referencesById, references, seenHeadingIds)}
      {!hasBibliographyDirective && references.length > 0
        ? renderBibliographySection(
            'publication-bibliography',
            references,
            'References',
            'Reference entries defined in markdown are compiled into a formatted bibliography for publication.',
          )
        : null}
    </div>
  )
}
