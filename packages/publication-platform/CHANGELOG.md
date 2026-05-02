# Changelog

## 0.2.0

- Fixed the Neon adapter implementation to avoid `SELECT *`, avoid `RETURNING *`, explicitly cast decoded UUID/timestamp/array/json fields, and avoid binding nullable `text[]` values.
- Added `migrateNeonPublicationPlatform()` and shipped the canonical Neon SQL migration in the npm package.
- Added `metadata` to the article storage contract and SQL schemas.
- Added frontmatter helpers, token issue/verify/auth helpers, canonical MCP tool scope metadata, and a framework-neutral reference fetch handler with a tiny admin token UI.
- Typed the client SDK response shapes, added `PublicationClientError`, `AbortSignal` support, relative base URL support, token helpers, and `listTools()` / `callTool()`.

## 0.1.2

- Clarified that the Neon adapter remains experimental until a future Neon-fix release, rather than implying the documentation-only `0.1.1` release fixed it.

## 0.1.1

- Documented that `@publication-mcp-studio/platform@0.1.0` is experimental for Neon HTTP integrations until the adapter avoids `SELECT *`, `RETURNING *`, and nullable `text[]` bindings.
- Added a public integration feedback tracker for v0.1.0 with the v0.1.1 SDK priorities.

## 0.1.0

- introduced a framework-facing publication platform package boundary
- added built-in `local` and `supabase` adapters behind shared contracts
- added adapter registry helpers and explicit env-based selection
- added a template adapter scaffold for future integrations
- added package-level tests for adapter selection and local persistence
- added a Neon/Postgres adapter for shared relational persistence outside Supabase
- added shared S3-compatible media storage support for the Neon adapter
