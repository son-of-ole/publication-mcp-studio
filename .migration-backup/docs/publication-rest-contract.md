# Publication REST Contract

Default base path: `/api/publications`. The platform package can also mount the same contract at a custom path with `createPublicationFetchHandler`, `createPublicationExpressHandler`, or `createPublicationNextRouteHandlers`.

All protected routes accept `Authorization: Bearer <token>` or `x-publication-token: <token>`.

## Routes

| Method | Path | Scope | Response |
|---|---|---|---|
| `GET` | `/health` | none | `{ ok, adapter }` |
| `GET` | `/admin` | none | Tiny static admin login page |
| `POST` | `/admin/login` | admin password | `{ user, token, tokenRecord? }` |
| `GET` | `/tokens` | `tokens:read` | `{ tokens }` |
| `POST` | `/tokens/:id/revoke` | `tokens:write` | `{ token }` |
| `GET` | `/articles` | `articles:read` | `{ articles, count, total, pageSize, nextCursor? }` |
| `POST` | `/articles` | `articles:write` | `{ article }` |
| `GET` | `/articles/:identifier` | `articles:read` | `{ article }` |
| `PATCH` | `/articles/:identifier` | `articles:write` | `{ article }` |
| `DELETE` | `/articles/:identifier` | `articles:delete` | `{ deleted: true, article }` |
| `POST` | `/articles/:identifier/publish` | `articles:publish` | `{ article }` |
| `POST` | `/articles/:identifier/unpublish` | `articles:publish` | `{ article }` |
| `POST` | `/mcp` | `mcp:connect` | JSON-RPC MCP payload |

The full Studio app adds media, import/export, verify, audit, versions, and agent routes under the same prefix. The platform drop-in handler intentionally covers the core SDK integration contract.

## List Articles Query

`GET /articles` accepts:

- `status=draft|published|all`
- `search=term`
- `category=science`
- `tag=latex`
- `tags=latex,lean` or repeated `tags=latex&tags=lean`
- `limit=50`
- `offset=0`
- `cursor=2026-05-02T12:00:00.000Z`
- `includeContent=true`

`count` and `total` are total matching records when the adapter supports `countArticles()`. `pageSize` is the number of returned rows.

## Article Shape

```ts
type PublicationArticleResponse = {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
  createdAt: string
  updatedAt: string
  category: string | null
  tags: string[]
  metadata: Record<string, unknown>
  contentMarkdown?: string
  document?: unknown
  presentation?: unknown
}
```

Storage adapters use snake_case internally (`content_markdown`, `created_at`) and public client responses use camelCase.

## Error Shape

```ts
type PublicationError = {
  error: string
  code: string
  details?: unknown
}
```

The client throws `PublicationClientError` with `status`, `code`, and `details`.

## MCP Notes

The hosted route accepts JSON-RPC `initialize`, `tools/list`, and `tools/call` payloads. The v0.3 platform handler exposes discovery; the full Studio route exposes the complete tool set including governed skills.
