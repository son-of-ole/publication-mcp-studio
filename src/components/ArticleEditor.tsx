/* eslint-disable @typescript-eslint/no-explicit-any */

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { ArrowLeft, Braces, Eye, FileText, Image as ImageIcon, Save, Sparkles, Upload } from 'lucide-react'
import CopyMarkdownButton from './CopyMarkdownButton'
import PretextRenderer from './PretextRenderer'
import PublicationHero from './publications/PublicationHero'
import PublicationRenderer from './publications/PublicationRenderer'
import PublicationVersionPanel from './publications/PublicationVersionPanel'
import {
  type PublicationMetadata,
  composePublicationMarkdown,
  createEmptyPublicationMetadata,
  extractPublicationDocument,
  formatPublicationDate,
  parseAuthorProfilesEditorInput,
  parseFrontmatterEditorInput,
  splitEditorListInput,
  stringifyFrontmatterForEditor,
} from '@/lib/publications'

export type Article = {
  id?: string
  title: string
  slug: string
  content_markdown: string
  status: 'draft' | 'published'
  created_at?: string
  updated_at?: string
}

type PreviewMode = 'publication' | 'layout' | 'source'
type MetadataListField = 'authors' | 'authorProfiles' | 'affiliations' | 'tags'
type RestoredArticlePayload = {
  id?: string
  title: string
  slug: string
  status: 'draft' | 'published'
  contentMarkdown?: string
}

const RESEARCH_SCAFFOLD = `## Abstract

Summarize the purpose, method, results, and conclusion.

## Introduction

Introduce the motivation, framing, and context.

## Methods

Describe the setup, dataset, and evaluation strategy.

## Results

Present the outcomes, figures, and comparisons.

## Discussion

Interpret the results and explain implications.

## Conclusion

Close with the main takeaway and next questions.
`

const QUICK_SNIPPETS = [
  { label: 'Figure', snippet: '\n::figure{src="https://example.com/figure.png" alt="Figure alt" caption="Figure caption"}\n' },
  { label: 'Video', snippet: '\n::video{src="https://example.com/video.mp4" poster="https://example.com/poster.jpg" caption="Video caption"}\n' },
  { label: 'Interactive', snippet: '\n::interactive{src="https://example.com" title="Interactive module" height=560}\n' },
  {
    label: 'Chart',
    snippet:
      '\n::chart{type="line" title="Reliability by Condition" labels="Baseline|Calibrated|Replicated" series="Run A:0.81,0.88,0.91; Run B:0.78,0.85,0.89" yLabel="Score" min="0" max="1"}\n',
  },
  {
    label: 'Dataset',
    snippet:
      '\n::dataset{title="Evaluation Slice" columns="Metric|Mean|StdErr" rows="Accuracy|0.91|0.02; Recall|0.88|0.03; F1|0.89|0.02" source="Held-out set"}\n',
  },
  {
    label: 'Notebook',
    snippet:
      '\n::notebook{title="Exploration Notebook" src="https://example.com/notebook" runtime="Python" kernel="Jupyter" summary="Interactive exploratory notebook for this experiment." height="620"}\n',
  },
  {
    label: 'Lean Proof',
    snippet:
      '\n::lean{title="Stability Theorem" theorem="stability_bound" status="checked" summary="Machine-checked formal statement for the main bound." code="theorem stability_bound : True := by\\n  trivial"}\n',
  },
  { label: 'Citation', snippet: '[@smith2024]' },
  {
    label: 'Reference Entry',
    snippet:
      '\n::reference{id="smith2024" title="Article title" authors="Smith, John; Doe, Jane" journal="Journal Name" year="2024" doi="10.xxxx/example" url="https://example.com"}\n',
  },
  { label: 'Bibliography', snippet: '\n::bibliography{title="References"}\n' },
  { label: 'Equation', snippet: '\n$$\n\\alpha = \\frac{k}{k-1}\\left(1 - \\frac{\\sum \\sigma_i^2}{\\sigma_T^2}\\right)\n$$\n' },
  { label: 'Callout', snippet: '\n:::note{title="Key point"}\nState the important result here.\n:::\n' },
  { label: 'Result', snippet: '\n:::result{title="Primary finding"}\nExplain the outcome and why it matters.\n:::\n' },
]

function createInitialEditorState(initialArticle?: Article) {
  if (!initialArticle) {
    return {
      article: { title: '', slug: '', content_markdown: '', status: 'draft' as const },
      metadata: createEmptyPublicationMetadata(''),
      customFrontmatterInput: '',
      body: '',
    }
  }

  const extracted = extractPublicationDocument(initialArticle.content_markdown, initialArticle.title)
  const title = initialArticle.title || extracted.metadata.title

  return {
    article: { ...initialArticle, title },
    metadata: { ...extracted.metadata, title },
    customFrontmatterInput: stringifyFrontmatterForEditor(extracted.customFrontmatter),
    body: extracted.body,
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseMarkdownImageAlt(rawAlt: string) {
  const normalized = rawAlt.trim()
  const pipeParts = normalized
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)

  const label = pipeParts[0] ?? ''
  const metadata: Record<string, string> = {}

  for (const part of pipeParts.slice(1)) {
    const keyValueMatch = /^([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/.exec(part)

    if (keyValueMatch) {
      metadata[keyValueMatch[1]] = keyValueMatch[2].trim()
      continue
    }

    if (part === 'float-right') {
      metadata.float = 'right'
    } else if (part === 'float-left') {
      metadata.float = 'left'
    }
  }

  return { label, metadata }
}

function serializeMarkdownImageAlt(label: string, metadata: Record<string, string>) {
  const orderedKeys = ['w', 'float', 'y', 'mt']
  const emittedKeys = new Set<string>()
  const parts = [label.trim()].filter(Boolean)

  for (const key of orderedKeys) {
    const value = metadata[key]?.trim()
    if (value) {
      parts.push(`${key}=${value}`)
      emittedKeys.add(key)
    }
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (!emittedKeys.has(key) && value.trim()) {
      parts.push(`${key}=${value.trim()}`)
    }
  }

  return parts.join(' | ')
}

function updateImageMarkdown(
  markdown: string,
  imageUrl: string,
  transform: (current: { label: string; metadata: Record<string, string> }) => { label: string; metadata: Record<string, string> }
) {
  const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(imageUrl)}\\)`)

  return markdown.replace(imagePattern, (_match, rawAlt: string) => {
    const current = parseMarkdownImageAlt(rawAlt)
    const next = transform(current)
    return `![${serializeMarkdownImageAlt(next.label, next.metadata)}](${imageUrl})`
  })
}

function createListInputState(metadata: PublicationMetadata) {
  return {
    authors: metadata.authors.join('\n'),
    authorProfiles: metadata.authorProfiles.join('\n'),
    affiliations: metadata.affiliations.join('\n'),
    tags: metadata.tags.join('\n'),
  }
}

export default function ArticleEditor({ initialArticle }: { initialArticle?: Article }) {
  const initialState = useMemo(
    () => createInitialEditorState(initialArticle),
    [initialArticle]
  )
  const [article, setArticle] = useState<Article>(initialState.article)
  const [metadata, setMetadata] = useState<PublicationMetadata>(initialState.metadata)
  const [metadataListInputs, setMetadataListInputs] = useState(createListInputState(initialState.metadata))
  const [customFrontmatterInput, setCustomFrontmatterInput] = useState(initialState.customFrontmatterInput)
  const [bodyMarkdown, setBodyMarkdown] = useState(initialState.body)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('publication')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [layoutLabWidth, setLayoutLabWidth] = useState(720)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const layoutLabFrameRef = useRef<HTMLDivElement>(null)

  const router = useRouter()

  useEffect(() => {
    const frame = layoutLabFrameRef.current
    if (!frame) {
      return
    }

    const updateWidth = () => {
      const nextWidth = Math.max(320, Math.floor(frame.clientWidth - 48))
      setLayoutLabWidth(nextWidth)
    }

    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(frame)

    return () => {
      resizeObserver.disconnect()
    }
  }, [isFullscreen, previewMode])

  const parsedCustomFrontmatter = useMemo(() => parseFrontmatterEditorInput(customFrontmatterInput), [customFrontmatterInput])

  const composedMarkdown = useMemo(
    () =>
      composePublicationMarkdown(
        {
          ...metadata,
          title: article.title,
        },
        bodyMarkdown,
        parsedCustomFrontmatter
      ),
    [article.title, bodyMarkdown, metadata, parsedCustomFrontmatter]
  )

  const publishedLabel = useMemo(
    () => formatPublicationDate(metadata.published, article.created_at),
    [article.created_at, metadata.published]
  )

  const revisedLabel = useMemo(
    () => (metadata.revised ? formatPublicationDate(metadata.revised) : ''),
    [metadata.revised]
  )

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = event.target.value
    setArticle((prev) => ({
      ...prev,
      title: newTitle,
      slug:
        prev.slug === '' || prev.slug === prev.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          ? newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
          : prev.slug,
    }))
    setMetadata((prev) => ({ ...prev, title: newTitle }))
  }

  const updateMetadataField = <K extends keyof PublicationMetadata>(field: K, value: PublicationMetadata[K]) => {
    setMetadata((prev) => ({ ...prev, [field]: value }))
  }

  const updateMetadataListField = (field: MetadataListField, rawValue: string) => {
    setMetadataListInputs((prev) => ({ ...prev, [field]: rawValue }))
    setMetadata((prev) => ({
      ...prev,
      [field]: field === 'authorProfiles'
        ? parseAuthorProfilesEditorInput(rawValue, prev.authors.length)
        : splitEditorListInput(rawValue),
    }))
  }

  const toggleImageSelection = (imageUrl: string) => {
    setSelectedImages((prev) =>
      prev.includes(imageUrl) ? prev.filter((entry) => entry !== imageUrl) : [...prev, imageUrl],
    )
  }

  const handleLayoutLabImageAction = (imageUrl: string, action: Record<string, any>) => {
    if (!imageUrl || imageUrl === 'GALLERY') {
      return
    }

    setBodyMarkdown((previousMarkdown) =>
      updateImageMarkdown(previousMarkdown, imageUrl, ({ label, metadata: currentMetadata }) => {
        const metadataDraft = { ...currentMetadata }

        if (action.type === 'width' && typeof action.value === 'number') {
          metadataDraft.w = `${Math.max(100, Math.round(action.value / 10) * 10)}`
        }

        if (action.type === 'align' && typeof action.value === 'string') {
          if (action.value === 'center') {
            delete metadataDraft.float
          } else {
            metadataDraft.float = action.value
          }
        }

        if (action.type === 'drag') {
          const dragDeltaY = typeof action.dragDeltaY === 'number' ? action.dragDeltaY : 0
          const dragDeltaX = typeof action.dragDeltaX === 'number' ? action.dragDeltaX : 0
          const initialAbsY = typeof action.initialAbsY === 'number' ? action.initialAbsY : 0
          const currentY = Number.parseInt(metadataDraft.y ?? '', 10)
          const baseY = Number.isNaN(currentY) ? initialAbsY : currentY

          if (Math.abs(dragDeltaY) > 8) {
            metadataDraft.y = `${Math.max(0, Math.round((baseY + dragDeltaY) / 10) * 10)}`
          }

          if (Math.abs(dragDeltaX) > 40) {
            metadataDraft.float = dragDeltaX > 0 ? 'right' : 'left'
          }
        }

        return {
          label,
          metadata: metadataDraft,
        }
      }),
    )
  }

  const insertAtSelection = (prefix: string, suffix = '') => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = bodyMarkdown.slice(start, end)
    const replacement = prefix + selectedText + suffix
    const nextMarkdown = bodyMarkdown.slice(0, start) + replacement + bodyMarkdown.slice(end)

    setBodyMarkdown(nextMarkdown)

    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + prefix.length, end + prefix.length)
    }, 10)
  }

  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setBodyMarkdown((prev) => `${prev}${prev.trim() ? '\n\n' : ''}${snippet.trim()}\n`)
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const nextMarkdown = bodyMarkdown.slice(0, start) + snippet + bodyMarkdown.slice(end)
    setBodyMarkdown(nextMarkdown)

    setTimeout(() => {
      textarea.focus()
      const caret = start + snippet.length
      textarea.setSelectionRange(caret, caret)
    }, 10)
  }

  const insertScaffold = () => {
    if (!bodyMarkdown.trim()) {
      setBodyMarkdown(RESEARCH_SCAFFOLD)
      return
    }

    insertSnippet(`\n\n${RESEARCH_SCAFFOLD}`)
  }

  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return
    }

    const file = event.target.files[0]
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/extract-text', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract text')
      }

      setBodyMarkdown((prev) => `${prev}${prev.trim() ? '\n\n' : ''}${data.text}`.trim())
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleMediaUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return
    }

    const file = event.target.files[0]
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (article.id) {
        formData.append('articleIdentifier', article.id)
      } else if (article.slug.trim()) {
        formData.append('articleSlug', article.slug.trim())
      }

      const response = await fetch('/api/publications/media', {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload media')
      }

      const embedMarkdown =
        typeof data.asset?.embedMarkdown === 'string'
          ? data.asset.embedMarkdown
          : typeof data.asset?.publicUrl === 'string'
            ? `![${file.name}](${data.asset.publicUrl})`
            : ''

      if (!embedMarkdown) {
        throw new Error('Media uploaded, but no embed snippet was returned.')
      }

      setBodyMarkdown((prev) => `${prev}${prev.trim() ? '\n\n' : ''}${embedMarkdown}\n`)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
      if (mediaInputRef.current) {
        mediaInputRef.current.value = ''
      }
    }
  }

  const handleSave = async () => {
    setLoading(true)
    setError(null)
    setRestoreNotice(null)

    try {
      const payload = {
        title: article.title,
        slug: article.slug,
        content_markdown: composedMarkdown,
        status: article.status,
      }

      if (article.id) {
        const response = await fetch(`/api/admin/articles/${article.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to save article')
        }
      } else {
        const response = await fetch('/api/admin/articles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to save article')
        }

        if (data.article?.id) {
          router.replace(`/admin/articles/${data.article.id}/edit`)
        }
      }

      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const handleVersionRestore = (restoredArticle: RestoredArticlePayload, restoredFromVersionNumber: number) => {
    const nextState = createInitialEditorState({
      ...restoredArticle,
      content_markdown: restoredArticle.contentMarkdown ?? '',
    })

    setArticle(nextState.article)
    setMetadata(nextState.metadata)
    setMetadataListInputs(createListInputState(nextState.metadata))
    setCustomFrontmatterInput(nextState.customFrontmatterInput)
    setBodyMarkdown(nextState.body)
    setRestoreNotice(`Restored from version ${restoredFromVersionNumber}. Review the content and save again if you want to keep editing from this snapshot.`)
    router.refresh()
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[#f4f8fb] px-6 pb-6 pt-6 text-slate-900" suppressHydrationWarning>
      <div className="mx-auto flex h-full min-h-0 max-w-[1700px] flex-col">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/admin/articles" className="text-slate-500 transition-colors hover:text-slate-900">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700">Publication Workspace</div>
              <h1 className="mt-1 text-xl font-bold">{article.id ? 'Edit Article' : 'New Article'}</h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {error ? <span className="text-sm text-red-600">{error}</span> : null}
            <CopyMarkdownButton markdown={composedMarkdown} />
            <button
              onClick={handleSave}
              disabled={loading || !article.title || !article.slug}
              className="inline-flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="mb-5 grid gap-4 rounded-[1.4rem] border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Title</label>
            <input
              type="text"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-medium text-slate-900 outline-none transition-colors focus:border-cyan-400"
              placeholder="Article title"
              value={article.title}
              onChange={handleTitleChange}
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">
              The top title is also written into publication frontmatter so the markdown stays self-describing.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Slug</label>
            <input
              type="text"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg font-medium text-slate-900 outline-none transition-colors focus:border-cyan-400"
              placeholder="article-slug"
              value={article.slug}
              onChange={(event) => setArticle((prev) => ({ ...prev, slug: event.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Status</label>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-cyan-400"
              value={article.status}
              onChange={(event) =>
                setArticle((prev) => ({ ...prev, status: event.target.value as Article['status'] }))
              }
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>

        {article.id ? (
          <div className="mb-5">
            <PublicationVersionPanel
              identifier={article.id}
              currentMarkdown={composedMarkdown}
              onRestore={handleVersionRestore}
            />
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto pr-1">
            {restoreNotice ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                {restoreNotice}
              </div>
            ) : null}

            <section className="rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-700" />
                  <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-600">Publication Metadata</h2>
                </div>
              </div>
              <div className="grid gap-5 p-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Publication Label</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Scientific Publication"
                    value={metadata.publicationLabel}
                    onChange={(event) => updateMetadataField('publicationLabel', event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    This controls the small heading above the publication title in the public-facing hero.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Subtitle</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Optional subtitle or deck"
                    value={metadata.subtitle}
                    onChange={(event) => updateMetadataField('subtitle', event.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Abstract</label>
                  <textarea
                    className="h-28 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="High-level abstract shown in the public header and listings"
                    value={metadata.abstract}
                    onChange={(event) => updateMetadataField('abstract', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Authors</label>
                  <textarea
                    className="h-24 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Separate authors with commas or new lines"
                    value={metadataListInputs.authors}
                    onChange={(event) => updateMetadataListField('authors', event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">Examples: `Ada Lovelace, Alan Turing` or one author per line.</p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Author Emails / Links</label>
                  <textarea
                    className="h-24 w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-sm outline-none transition-colors focus:border-cyan-400"
                    placeholder={'Gordon Olson | email=gordon@sonofol.org | social=https://linkedin.com/in/gordon-sonofol | github=son-of-ole\nemail=jane@example.com | orcid=0000-0000-0000-0000 | url=example.com/jane'}
                    value={metadataListInputs.authorProfiles}
                    onChange={(event) => updateMetadataListField('authorProfiles', event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    One author per line. Use either <code>Name | email=... | orcid=... | social=... | url=...</code> or keep the same line order as the
                    authors field and omit the name. Supported keys: <code>name</code>, <code>email</code>, <code>orcid</code>, <code>social</code>, <code>github</code>, and <code>url</code>.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Affiliations</label>
                  <textarea
                    className="h-24 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Separate affiliations with commas or new lines"
                    value={metadataListInputs.affiliations}
                    onChange={(event) => updateMetadataListField('affiliations', event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">You can keep one affiliation per line or paste a comma-separated list.</p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Tags</label>
                  <textarea
                    className="h-24 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Comma-separated or one tag per line"
                    value={metadataListInputs.tags}
                    onChange={(event) => updateMetadataListField('tags', event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">Tags now accept both `psychometrics, llm` and multi-line entry.</p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Journal / Venue</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Journal or venue"
                    value={metadata.journal}
                    onChange={(event) => updateMetadataField('journal', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Repository URL</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="https://github.com/owner/repo"
                    value={metadata.repositoryUrl}
                    onChange={(event) => updateMetadataField('repositoryUrl', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Repository Label</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="GitHub Repository or Data Repository"
                    value={metadata.repositoryLabel}
                    onChange={(event) => updateMetadataField('repositoryLabel', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">DOI</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="10.xxxx/identifier"
                    value={metadata.doi}
                    onChange={(event) => updateMetadataField('doi', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Published Date</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="2026-04-09 or April 9, 2026"
                    value={metadata.published}
                    onChange={(event) => updateMetadataField('published', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Revised Date</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Optional revised date"
                    value={metadata.revised}
                    onChange={(event) => updateMetadataField('revised', event.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Canonical URL</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="https://..."
                    value={metadata.canonicalUrl}
                    onChange={(event) => updateMetadataField('canonicalUrl', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Hero Image</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="https://.../hero.png"
                    value={metadata.heroImage}
                    onChange={(event) => updateMetadataField('heroImage', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Hero Video</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="https://.../hero.mp4"
                    value={metadata.heroVideo}
                    onChange={(event) => updateMetadataField('heroVideo', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Hero Poster</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Optional poster image for hero video"
                    value={metadata.heroPoster}
                    onChange={(event) => updateMetadataField('heroPoster', event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Hero Caption</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition-colors focus:border-cyan-400"
                    placeholder="Caption for hero media"
                    value={metadata.heroCaption}
                    onChange={(event) => updateMetadataField('heroCaption', event.target.value)}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Additional Frontmatter</label>
                  <textarea
                    className="h-28 w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-sm outline-none transition-colors focus:border-cyan-400"
                    placeholder={'featureFlag: true\nlicense: "CC-BY-4.0"'}
                    value={customFrontmatterInput}
                    onChange={(event) => setCustomFrontmatterInput(event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Extra keys here are preserved alongside the structured metadata fields above.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-cyan-700" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-600">Markdown Studio</h2>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <input
                      type="file"
                      className="hidden"
                      ref={fileInputRef}
                      accept=".pdf,.docx"
                      onChange={handleDocumentUpload}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:text-cyan-800"
                    >
                      <Upload className="h-4 w-4" />
                      Extract DOC/PDF
                    </button>

                    <input
                      type="file"
                      className="hidden"
                      ref={mediaInputRef}
                      accept="image/*,video/*,.pdf"
                      onChange={handleMediaUpload}
                    />
                    <button
                      onClick={() => mediaInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800"
                    >
                      <ImageIcon className="h-4 w-4" />
                      Upload Media
                    </button>

                    <button
                      onClick={insertScaffold}
                      className="inline-flex items-center gap-2 rounded-full bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-800"
                    >
                      <Sparkles className="h-4 w-4" />
                      Insert Research Scaffold
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-b border-slate-200 px-5 py-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Quick Blocks</div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_SNIPPETS.map((snippet) => (
                    <button
                      key={snippet.label}
                      onClick={() => insertSnippet(snippet.snippet)}
                      className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:text-cyan-800"
                    >
                      {snippet.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 max-w-3xl text-xs leading-6 text-slate-500">
                  References now support structured entries in markdown. Cite them inline with <code>[@id]</code>, define
                  them with <code>::reference&#123;...&#125;</code>, and optionally place <code>::bibliography&#123;...&#125;</code>{' '}
                  where you want the formatted references section to appear.
                </p>
                <p className="mt-2 max-w-3xl text-xs leading-6 text-slate-500">
                  Interactive publication blocks now include <code>::chart</code>, <code>::dataset</code>, <code>::notebook</code>,
                  and <code>::lean</code> / <code>::proof</code> so the same markdown source can power polished scientific artifacts.
                </p>
              </div>

              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => insertAtSelection('**', '**')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50">B</button>
                  <button onClick={() => insertAtSelection('*', '*')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs italic text-slate-700 transition-colors hover:bg-slate-50">I</button>
                  <button onClick={() => insertAtSelection('++', '++')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs underline text-slate-700 transition-colors hover:bg-slate-50">U</button>
                  <button onClick={() => insertAtSelection('~~', '~~')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs line-through text-slate-700 transition-colors hover:bg-slate-50">S</button>
                  <button onClick={() => insertAtSelection('==', '==')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">Highlight</button>
                  <button onClick={() => {
                    const url = window.prompt('Enter hyperlink URL (e.g. https://example.com):')
                    if (url) insertAtSelection('[', `](${url})`)
                  }} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">Link</button>
                  <button onClick={() => insertAtSelection('[center] ')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">Center</button>
                  <button onClick={() => insertAtSelection('[right] ')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">Right</button>
                  <button onClick={() => insertAtSelection('[justify] ')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">Justify</button>
                  <button onClick={() => insertAtSelection('[dropcap] ')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">Dropcap</button>
                  <button onClick={() => insertAtSelection('\n[gallery]\n')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">Gallery</button>
                </div>
              </div>

              <div className="min-h-[460px] p-5">
                <textarea
                  ref={textareaRef}
                  id="markdown-editor"
                  className="h-full min-h-[460px] w-full resize-none rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-7 text-slate-800 outline-none transition-colors focus:border-cyan-400"
                  placeholder="Write the body of the publication here..."
                  value={bodyMarkdown}
                  onChange={(event) => setBodyMarkdown(event.target.value)}
                />
              </div>
            </section>
          </div>

          <div className={clsx('min-h-0 overflow-hidden', isFullscreen && 'fixed inset-4 z-50')}>
            <section className="flex h-full min-h-[760px] flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-cyan-700" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-600">Preview</h2>
                  </div>

                  <button
                    onClick={() => setIsFullscreen((prev) => !prev)}
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:border-cyan-300 hover:text-cyan-800"
                  >
                    {isFullscreen ? 'Exit Focus' : 'Focus'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    { id: 'publication', label: 'Publication', icon: FileText },
                    { id: 'layout', label: 'Layout Lab', icon: Sparkles },
                    { id: 'source', label: 'Source', icon: Braces },
                  ].map((tab) => {
                    const Icon = tab.icon
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setPreviewMode(tab.id as PreviewMode)}
                        className={clsx(
                          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                          previewMode === tab.id
                            ? 'border-cyan-300 bg-cyan-50 text-cyan-900'
                            : 'border-slate-300 text-slate-600 hover:border-cyan-300 hover:text-cyan-800'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-[#f8fbfd] p-5">
                {previewMode === 'publication' ? (
                  <div className="space-y-8">
                    <PublicationHero
                      title={article.title || 'Untitled Publication'}
                      publicationLabel={metadata.publicationLabel}
                      subtitle={metadata.subtitle}
                      abstract={metadata.abstract}
                      authors={metadata.authors}
                      authorProfiles={metadata.authorProfiles}
                      affiliations={metadata.affiliations}
                      tags={metadata.tags}
                      doi={metadata.doi}
                      journal={metadata.journal}
                      repositoryUrl={metadata.repositoryUrl}
                      repositoryLabel={metadata.repositoryLabel}
                      publishedLabel={publishedLabel}
                      revisedLabel={revisedLabel}
                      heroImage={metadata.heroImage}
                      heroVideo={metadata.heroVideo}
                      heroPoster={metadata.heroPoster}
                      heroCaption={metadata.heroCaption}
                    />

                    <div className="rounded-[1.8rem] border border-slate-200 bg-white px-6 py-8 shadow-[0_24px_80px_rgba(15,23,42,0.07)]">
                      <PublicationRenderer markdown={composedMarkdown} />
                    </div>
                  </div>
                ) : previewMode === 'layout' ? (
                  <div
                    ref={layoutLabFrameRef}
                    className="overflow-x-auto rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.07)]"
                  >
                    <PretextRenderer
                      markdown={bodyMarkdown}
                      maxWidth={layoutLabWidth}
                      onImageAction={handleLayoutLabImageAction}
                      selectedImages={selectedImages}
                      onSelectionToggle={toggleImageSelection}
                    />
                  </div>
                ) : (
                  <div className="rounded-[1.6rem] border border-slate-200 bg-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
                    <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                      Composed Markdown
                    </div>
                    <pre className="overflow-x-auto p-4 text-sm leading-7 text-slate-100">
                      <code>{composedMarkdown}</code>
                    </pre>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
