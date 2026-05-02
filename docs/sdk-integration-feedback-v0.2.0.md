# Publication MCP Studio SDK Integration Feedback - 0.2.0

This document captures the Cedar Branch v0.2.0 integration feedback and what v0.3.0 changed.

## Fixed in 0.3.0

| Feedback | v0.3.0 result |
|---|---|
| README led with BYO routes even though a drop-in handler exists. | READMEs now lead with `createPublicationFetchHandler`, `createPublicationExpressHandler`, and `createPublicationNextRouteHandlers`. |
| No Express/Node adapter. | Added `createPublicationExpressHandler()`. |
| No Next route helper. | Added `createPublicationNextRouteHandlers()`. |
| No first-run helper. | Added `platform.ensureSchema()` to the platform interface; Neon runs the idempotent migration. |
| Token bootstrap was hand-rolled. | Added `publication-mcp issue-token` CLI. |
| Category/tags were metadata-only. | Added first-class `category` and `tags` fields plus schema indexes. |
| No category/tag filters or pagination. | Added category, tag, tags, offset, and cursor list options. |
| `count` meant page length. | SDK responses now include real `count`/`total` where `countArticles()` is available, plus `pageSize`. |
| Metadata typing was too loose. | Client supports `createPublicationClient<MyMetadata>()` and exports `defineArticleMetadataSchema()`. |
| No React hooks package. | Added `@publication-mcp-studio/react` with `useArticles()` and `useArticle()`. |
| REST contract was implicit. | Added `docs/publication-rest-contract.md`. |
| `baseUrl` semantics were subtle. | Client now supports `origin` plus `pathPrefix`; `baseUrl` accepts either origin or full API base path. |
| No exported scope tuple. | Added `PUBLICATION_SCOPES` and token read/write scopes. |
| Metadata conventions were unclear. | Added `docs/metadata-conventions.md`. |
| Neon factory ignored `adminAuthStore`. | Neon now honors `options.adminAuthStore`. |
| Audit events could bind empty strings into nullable UUID columns. | Neon audit logging coerces invalid/empty article IDs to `null`. |
| Token record casing was mixed in the client. | Client normalizes token records to camelCase while preserving `raw`. |
| Neon HTTP driver crash on empty result sets leaked to consumers. | Neon `queryRows()` converts the known null-fields empty-result crash into an empty result. |

## Still Explicitly Scoped

- The full Studio app exposes the complete JSON-RPC MCP tool route. The platform drop-in handler exposes the core REST contract and MCP discovery, not the full tool executor.
- External connectors remain scaffolded/read-only in v1 of governed skills.
- BYO route implementations remain supported for hosts that need custom auth/session behavior.
