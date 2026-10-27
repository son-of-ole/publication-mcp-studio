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

## Agent harness publishing (0.4)

Use a private, registered token with `PUBLICATION_AGENT_SCOPES` (read, write,
publish and MCP). Never ship an authoring token to a website browser bundle.

```ts
const { article } = await publication.createArticle({
  title: 'Research results', slug: 'research-results', body: '## Results\n\nThe article.',
})
const { asset } = await publication.uploadMedia({
  identifier: article.id, fileName: 'supporting-report.pdf',
  contentType: 'application/pdf', data: pdfBytes, // Uint8Array, at most 8 MiB
})
await publication.attachMedia(article.id, {
  url: asset.publicUrl, label: 'Supporting report',
  description: 'The methods and supporting evidence.',
  textContent: 'Optional text extracted or summarized by the harness.',
})
const review = await publication.preparePublication(article.id)
// Explicitly authorize publishing through your harness workflow.
await publication.publishArticle(article.id)

// Updating live content preserves its canonical URL and uses a private revision.
const { article: revision } = await publication.createRevision(article.id)
await publication.updateArticle(revision.id, { body: 'Revised article.' })
const reviewed = await publication.preparePublication(revision.id)
await publication.publishRevision(revision.id, reviewed.digest)
```

`uploadMedia` computes SHA-256 and sends bounded MCP chunks; no filesystem path or
REST upload escape hatch is required. `attachMedia`, `detachMedia`, `listAttachments`,
`createRevision`, `preparePublication`, and `publishRevision` use MCP. HTTP errors,
JSON-RPC errors and MCP tool failures reject with `PublicationClientError`.
An upload does not attach or publish the file until those explicit operations.
The JSON request limit still applies to article content. The public Markdown
contains supporting text supplied by the harness; the engine does not parse PDFs.
See the repository workflow/operations guides for limits, privacy and deployment.
