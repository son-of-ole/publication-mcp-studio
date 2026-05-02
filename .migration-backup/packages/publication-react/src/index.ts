'use client'
/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createPublicationClient,
  type PublicationArticleResponse,
  type PublicationClientOptions,
  type PublicationDefaultArticleMetadata,
  type PublicationListArticlesOptions,
} from '@publication-mcp-studio/client'

export type PublicationHookState<TData> = {
  data: TData | null
  error: Error | null
  isLoading: boolean
  refetch(): Promise<void>
}

export type UsePublicationOptions = PublicationClientOptions & {
  enabled?: boolean
}

export function useArticles<TMetadata extends Record<string, unknown> = PublicationDefaultArticleMetadata>(
  options: UsePublicationOptions & PublicationListArticlesOptions
): PublicationHookState<{
  articles: PublicationArticleResponse<TMetadata>[]
  count: number
  total?: number
  pageSize?: number
  nextCursor?: string
}> {
  const { enabled = true, ...rest } = options
  const restKey = stableKey(rest)
  const { clientOptions, listOptions } = useMemo(() => splitArticleOptions(rest), [restKey])
  const listKey = stableKey(listOptions)
  const loadArticles = useCallback(
    (client: ReturnType<typeof createPublicationClient<TMetadata>>, signal: AbortSignal) =>
      client.listArticles({ ...listOptions, signal }),
    [listKey, listOptions]
  )
  return usePublicationRequest<{
    articles: PublicationArticleResponse<TMetadata>[]
    count: number
    total?: number
    pageSize?: number
    nextCursor?: string
  }, TMetadata>(
    enabled,
    { clientOptions, listOptions },
    clientOptions,
    loadArticles
  )
}

export function useArticle<TMetadata extends Record<string, unknown> = PublicationDefaultArticleMetadata>(
  identifier: string | null | undefined,
  options: UsePublicationOptions & { includeContent?: boolean } = {}
): PublicationHookState<{ article: PublicationArticleResponse<TMetadata> }> {
  const { enabled = true, includeContent = true, ...clientOptions } = options
  const clientOptionsKey = stableKey(clientOptions)
  const stableClientOptions = useMemo(() => clientOptions, [clientOptionsKey])
  const loadArticle = useCallback(
    (client: ReturnType<typeof createPublicationClient<TMetadata>>, signal: AbortSignal) =>
      client.getArticle(String(identifier), includeContent, { signal }),
    [identifier, includeContent]
  )
  return usePublicationRequest<{ article: PublicationArticleResponse<TMetadata> }, TMetadata>(
    Boolean(enabled && identifier),
    { ...stableClientOptions, identifier, includeContent },
    stableClientOptions,
    loadArticle
  )
}

function usePublicationRequest<TData, TMetadata extends Record<string, unknown> = PublicationDefaultArticleMetadata>(
  enabled: boolean,
  requestKey: unknown,
  clientOptions: PublicationClientOptions,
  load: (client: ReturnType<typeof createPublicationClient<TMetadata>>, signal: AbortSignal) => Promise<TData>
): PublicationHookState<TData> {
  const [data, setData] = useState<TData | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(enabled))
  const key = stableKey(requestKey)

  async function refetch() {
    if (!enabled) {
      return
    }

    const abortController = new AbortController()
    setIsLoading(true)
    setError(null)
    try {
      const client = createPublicationClient<TMetadata>(clientOptions)
      setData(await load(client, abortController.signal))
    } catch (nextError) {
      if (!abortController.signal.aborted) {
        setError(nextError instanceof Error ? nextError : new Error('Publication request failed.'))
      }
    } finally {
      if (!abortController.signal.aborted) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!enabled) return undefined

    const abortController = new AbortController()
    setIsLoading(true)
    setError(null)
    const client = createPublicationClient<TMetadata>(clientOptions)

    load(client, abortController.signal)
      .then((nextData) => {
        if (!abortController.signal.aborted) {
          setData(nextData)
        }
      })
      .catch((nextError) => {
        if (!abortController.signal.aborted) {
          setError(nextError instanceof Error ? nextError : new Error('Publication request failed.'))
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoading(false)
        }
      })

    return () => abortController.abort()
  }, [clientOptions, enabled, key, load])

  return { data, error, isLoading: enabled ? isLoading : false, refetch }
}

function stableKey(value: unknown) {
  return JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'function') {
      return '[function]'
    }
    return entry
  })
}

function splitArticleOptions(options: UsePublicationOptions & PublicationListArticlesOptions) {
  const {
    baseUrl,
    origin,
    pathPrefix,
    token,
    fetch,
    headers,
    status,
    search,
    category,
    tag,
    tags,
    limit,
    offset,
    cursor,
    includeContent,
  } = options

  return {
    clientOptions: { baseUrl, origin, pathPrefix, token, fetch, headers },
    listOptions: { status, search, category, tag, tags, limit, offset, cursor, includeContent },
  }
}
