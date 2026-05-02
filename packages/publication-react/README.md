# Publication React Package

Lightweight React hooks for hosted Publication MCP Studio read integrations.

```bash
npm install @publication-mcp-studio/react @publication-mcp-studio/client
```

```tsx
'use client'

import { useArticles } from '@publication-mcp-studio/react'

export function BlogIndex() {
  const { data, isLoading, error } = useArticles({
    origin: 'https://publication.example.com',
    token: process.env.NEXT_PUBLIC_PUBLICATION_TOKEN,
    status: 'published',
    tag: 'seo',
    limit: 12,
  })

  if (isLoading) return <p>Loading...</p>
  if (error) return <p>{error.message}</p>

  return (
    <ul>
      {data?.articles.map((article) => (
        <li key={article.id}>{article.title}</li>
      ))}
    </ul>
  )
}
```

Exports:

- `useArticles(options)`
- `useArticle(identifier, options)`
- `PublicationHookState<T>`

The package intentionally stays small. It does not impose React Query, SWR, routing, styling, or admin UI choices on host apps.
