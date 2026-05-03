# Changelog

## 0.3.1

- **Issue #3 fix:** all public types and adapter contracts are now consistently
  camelCase (`contentMarkdown`, `createdAt`, `updatedAt`, `articleId`,
  `articleSlug`, `versionNumber`, `sourceAction`, `actorLabel`, `actorType`,
  `tokenType`, `profileId`, `profileLabel`, `profileEnabledSkillIds`,
  `tokenEnabledSkillIds`, `allowProfileSkillOverrides`, `issuedAt`,
  `expiresAt`, `revokedAt`, `lastUsedAt`, `lastUsedRoute`, `lastUsedMethod`).
  The Neon and Supabase adapters keep snake_case database columns and
  translate to camelCase via dedicated `normalize*Row`/`*ToColumns` helpers.
  The local adapter persists camelCase records on disk; legacy snake_case
  state files must be removed before first boot.
- **Critical publish fix (issue #0):** `package.json#exports` now permanently
  points at the bundled `./dist/*.js` and `./dist/*.d.ts` outputs that ship in
  the tarball. The previous 0.3.0 publish left `exports` pointing at
  `./src/*.ts` files that were excluded by the `files` field, so any consumer
  who installed `@publication-mcp-studio/platform@0.3.0` got
  `ERR_MODULE_NOT_FOUND` on first import. (`publishConfig.exports` is not
  honored by npm, so the override approach used in 0.3.0 silently failed.)
- Added `scripts/verify-tarball.mjs`, run from `prepublishOnly`, that fails the
  publish if any `main` / `types` / `bin` / `exports` target is missing on disk
  or sits outside the `files` allowlist. This makes a future repeat of issue #0
  impossible.
- Added a `dev` script (`tsup ... --watch`) for iterating on the SDK against a
  live consumer.
- **Issue #2 fix:** the Neon adapter's `auditStore.recordEvent` now inlines
  `NULL` into the SQL when `article_id` is null/missing/non-uuid instead of
  binding `$N::uuid` against a null value. The Neon serverless driver was
  serializing those nulls as the empty string, which Postgres rejected with
  `invalid input syntax for type uuid: ""`. Added a regression unit test
  asserting that a `null` `article_id` produces a `NULL` parameter.

## 0.3.0

- Added `platform.ensureSchema()` and wired the Neon adapter to run the idempotent migration from the platform object.
- Added first-class `category` and `tags` article fields, SQL indexes, list filters, offset/cursor pagination, and `countArticles()`.
- Added `createPublicationExpressHandler()` and `createPublicationNextRouteHandlers()` on top of the existing Fetch handler.
- Added the `publication-mcp issue-token` CLI for first integration token bootstrap.
- Added `PUBLICATION_SCOPES`, `tokens:read`, and `tokens:write`.
- Fixed Neon `adminAuthStore` option handling, nullable audit UUID binding, and the known Neon empty-result driver crash.
- Updated docs for the REST contract, metadata conventions, and v0.2.0 integration feedback.

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
