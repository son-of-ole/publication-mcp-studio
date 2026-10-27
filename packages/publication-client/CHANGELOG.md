# Changelog

## 0.4.0

- Headless MCP publication workflow with scoped agent connections and explicit publication.
- Private revisions with content-digest review and atomic conditional publication.
- Structured image/document/data attachments, author-supplied supporting text, and
  bounded 8 MiB chunked uploads with SHA-256, retry receipts, identity binding and expiry.
- Public HTML without JavaScript, complete Markdown, metadata and discovery helpers.
- Private cloud media through publication-gated URLs; old public URLs require migration.
- Typed client lifecycle/upload/attachment methods, stdio transport for harnesses,
  and clean tarball consumer/type verification. Requires Node.js 24 for server/CLI use.


## 0.3.2

- Coordinated release with `@publication-mcp-studio/platform@0.3.2`.
- Constructor JSDoc clarifies `origin` / `pathPrefix` / legacy `baseUrl`
  semantics. `origin` is the preferred option; `baseUrl` may be an
  origin or a full publication API base path.
- `PublicationTokenRecord` aligned with the platform's now-fully
  camelCase `PublicationTokenInventoryRecord`. The defensive
  snake_case fallbacks in `normalizeTokenRecord` remain in place for
  one more minor version to absorb older server responses during the
  upgrade window.

## 0.3.1

- **Issue #5 fix:** `createPublicationClient` now accepts both `baseUrl`
  (legacy; may be either an origin or a full publication API base path) and
  `origin` (preferred v0.3 option). The client appends the configured
  `pathPrefix` (default `/api/publications`) when needed, and avoids
  double-appending when `baseUrl` already ends with the prefix. The resolved
  `baseUrl`, `origin`, and `pathPrefix` are exposed on the returned client for
  downstream wiring.
- **Issue #3 alignment:** all public response and request types are now
  consistently camelCase (`createdAt`, `updatedAt`, `contentMarkdown`,
  `revokedAt`, `expiresAt`, `issuedAt`, `lastUsedAt`). The token normalizer
  still reads legacy snake_case fallbacks defensively for older servers.

## 0.3.0

- Initial typed REST + MCP client SDK with `listArticles`, `getArticle`,
  `createArticle`, `updateArticle`, `publishArticle`, `unpublishArticle`,
  `deleteArticle`, `verifyDocument`, `mcpRequest`, `listTools`, `callTool`,
  `listSkills`, `runSkillWorkflow`, admin login, and token inventory helpers.
