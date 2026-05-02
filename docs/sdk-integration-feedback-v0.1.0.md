# SDK Integration Feedback for v0.1.0

This document captures live integration feedback for the published npm SDKs:

- [`@publication-mcp-studio/platform@0.1.0`](https://www.npmjs.com/package/@publication-mcp-studio/platform)
- [`@publication-mcp-studio/client@0.1.0`](https://www.npmjs.com/package/@publication-mcp-studio/client)

The goal is to keep the repo honest about what works today, what blocked an outside integration, and what should ship next so other stacks can integrate Publication MCP Studio with much less custom glue.

## Summary

The SDK direction is right: a hosted client package plus an embedded platform/adapter package is the correct integration model. The v0.1.0 release also proved that external consumers can install the packages from npm.

The biggest gap is productization. A host still has to write too much route, auth, migration, and metadata glue. The highest-impact next release is `v0.1.1`, focused on making Neon reliable, shipping migrations, making metadata explicit, and providing reference auth/routes.

## Blockers

### A. Neon Adapter Bugs

The published `createNeonPublicationPlatform` adapter is not reliable against stock Neon HTTP/Postgres in v0.1.0.

Observed failures:

- `SELECT *` returns unusable decoded values for some UUID, timestamp, and array columns through the Neon HTTP driver.
- `INSERT ... RETURNING *` can report success but return an empty `rows` array.
- Binding `null` for nullable `text[]` parameters can be serialized as an empty string and rejected by Postgres.
- Mixed scalar/array parameter binding is fragile unless arrays are normalized consistently.

Required fix:

- Replace `SELECT *` with explicit projections that cast UUIDs, timestamps, and arrays to text.
- Avoid `RETURNING *`; generate IDs client-side or re-select rows after write.
- Never bind `null` for `text[]`; omit nullable array columns or use explicit empty arrays/defaults.
- Add a real Neon HTTP smoke test in CI.

Until this is fixed, the README should treat Neon as experimental rather than production-supported.

### B. Missing Migration Surface

`createNeonPublicationPlatform` does not create or migrate schema. Fresh Neon databases fail with missing relation errors unless the host manually applies `neon_schema.sql`.

Required fix:

- Export `migrateNeonPublicationPlatform({ databaseUrl })` or a similarly named idempotent migration helper.
- Ship the canonical SQL migration in the package tarball.
- Document the exact table/column/default/constraint contract.

### C. Article Metadata Ambiguity

The client accepts `metadata` and `customFrontmatter`, but `PublicationArticleRecord` and the database schema do not include a metadata field.

Required decision:

- Add `metadata: Record<string, unknown>` to `PublicationArticleRecord` and a `jsonb metadata` column, or
- Document a canonical frontmatter contract and export helpers such as `parseArticleFrontmatter()` and `formatArticleFrontmatter()`.

This should be decided before more integrators invent incompatible metadata conventions.

### D. Auth Is Half-Wired

The platform package exposes token storage and token scope constants, but hosts still have to invent token issuance, verification, request auth, revocation checks, scope checks, and touch tracking.

Required fix:

- Export `issuePublicationToken()` and `verifyPublicationToken()`.
- Export `authenticatePublicationRequest({ headers, requiredScopes, platform })`.
- Export `PUBLICATION_MCP_TOOL_SCOPES`.
- Provide Express and generic Fetch/Request helpers.

### E. No Reference HTTP Server or Tiny Admin UI

Most integrators need the same routes:

- `POST /publications/admin/login`
- `GET /publications/tokens`
- `GET/POST/PATCH/DELETE /publications/articles[/:id]`
- `POST /publications/articles/:id/publish`
- `POST /publications/articles/:id/unpublish`
- `POST /publications/mcp`
- `GET /publications/health`

Required fix:

- Ship `@publication-mcp-studio/express`, `@publication-mcp-studio/hono`, or a framework-neutral fetch handler package.
- Ship a tiny static admin login/token UI so developers do not need to use curl for first setup.
- Document the JSON-RPC contract for the MCP route.

## Client SDK Rough Edges

Priority improvements for `@publication-mcp-studio/client`:

- Return typed promises instead of `Promise<unknown>`.
- Re-export shared platform response types where useful.
- Add `adminLogin()`, `listTokens()`, and `revokeToken()`.
- Support `AbortSignal`.
- Support same-origin or relative base paths.
- Preserve server error codes via `PublicationClientError`.
- Add `listTools()` and `callTool()` wrappers around `mcpRequest()`.

## Documentation Gaps

Priority README/docs fixes:

- Keep GitHub links relative, not local absolute filesystem paths.
- Add a 30-line Express or Fetch integration example.
- Add an env-var reference table, including `DATABASE_URL`, `NEON_DATABASE_URL`, and `POSTGRES_URL`.
- Add a maintained `CHANGELOG.md` policy.
- Document each `PublicationTokenScope` and which tools/routes it unlocks.
- Explain the snake_case storage shape versus camelCase client mutation shape.

## Nice-To-Haves

- Consider widening `PublicationAuditAction` to allow host-specific audit events.
- Prefer `tokenEnabledSkillIds?: string[]` over `string[] | null` for easier partial updates and safer array binding.
- Make `PublicationArticleStatus | 'all'` explicit everywhere list filters are accepted.
- Add `PublicationApiError` factory helpers.
- Configure package builds so stack traces use named chunks instead of opaque `chunk-*.js` filenames.

## One-Week Priority Plan

1. Fix the Neon adapter: no `SELECT *`, no `RETURNING *`, no nullable `text[]` bindings, plus real Neon HTTP CI smoke coverage.
2. Ship migrations: `migrateNeonPublicationPlatform()` plus canonical SQL included in the package.
3. Decide and implement the metadata contract.
4. Ship canonical auth helpers, `PUBLICATION_MCP_TOOL_SCOPES`, and a reference route package.
5. Type the client return values and add a tiny admin login/token UI.

If items 1 through 4 land, an outside host should be able to integrate Publication MCP Studio in roughly 100 lines of glue code instead of writing a parallel adapter and route layer.
