# Publication Client Package

Typed client SDK for calling a hosted Publication MCP Studio REST/MCP service.

```bash
npm install @publication-mcp-studio/client
```

## Quick Start

```ts
import { createPublicationClient } from '@publication-mcp-studio/client'

const publication = createPublicationClient({
  origin: 'https://your-publication-service.example',
  token: process.env.PUBLICATION_API_TOKEN,
})

const { articles, total } = await publication.listArticles({
  status: 'published',
  category: 'science',
  tag: 'latex',
  limit: 10,
})
```

`origin` is the preferred v0.3 option. The client appends `/api/publications` by default. For backwards compatibility, `baseUrl` may be either an origin or a full publication API base path:

```ts
createPublicationClient({ baseUrl: 'https://example.com' })
createPublicationClient({ baseUrl: 'https://example.com/api/publications' })
createPublicationClient({ origin: 'https://example.com', pathPrefix: '/custom/publications' })
```

## Typed Metadata

```ts
type BlogMetadata = {
  category?: string
  imageUrl?: string
  excerpt?: string
  tags?: string[]
}

const client = createPublicationClient<BlogMetadata>({
  origin: 'https://example.com',
  token,
})

const article = await client.getArticle('my-post')
article.article.metadata.imageUrl
```

`defineArticleMetadataSchema(schema)` is exported as a tiny helper for hosts that want to keep a runtime schema object beside the generic type.

## v0.3.2 Notes

- Coordinated with `@publication-mcp-studio/platform@0.3.2`.
- `origin` is the preferred constructor option. `baseUrl` is still
  accepted and may be either an origin (e.g. `https://example.com`)
  or a full publication API base path
  (e.g. `https://example.com/api/publications`).
- All token records are now fully camelCase (`issuedAt`, `expiresAt`,
  `revokedAt`, `lastUsedAt`, `lastUsedRoute`, `lastUsedMethod`,
  `tokenType`, `profileId`, `profileLabel`,
  `profileEnabledSkillIds`, `tokenEnabledSkillIds`,
  `allowProfileSkillOverrides`).

## v0.3.0 Additions

- Category/tag filters plus offset and cursor pagination.
- `count`/`total` are real total counts when the server supports `countArticles()`.
- `pageSize` reports the returned page length.
- CamelCase token records (`expiresAt`, `createdAt`, `revokedAt`).
- `PUBLICATION_SCOPES` exported as the canonical scope tuple.
- `PublicationClientError` preserves `status`, `code`, and `details`.
- `listTools()` and `callTool()` helpers wrap JSON-RPC MCP calls.

## Companion Hooks

React apps can install:

```bash
npm install @publication-mcp-studio/react
```

Then use `useArticles()` and `useArticle()` for the common public read path.

## Docs

- [Integration guide](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/publication-integration-guide.md)
- [REST contract](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/publication-rest-contract.md)
- [Metadata conventions](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/metadata-conventions.md)
