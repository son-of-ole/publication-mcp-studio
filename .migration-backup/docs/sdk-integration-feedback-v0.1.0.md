# SDK Integration Feedback for v0.1.0

This document captures live integration feedback for the published npm SDKs:

- [`@publication-mcp-studio/platform@0.1.0`](https://www.npmjs.com/package/@publication-mcp-studio/platform)
- [`@publication-mcp-studio/client@0.1.0`](https://www.npmjs.com/package/@publication-mcp-studio/client)

The goal is to keep the repo honest about what works today, what blocked an outside integration, and what should ship next so other stacks can integrate Publication MCP Studio with much less custom glue.

## Summary

The SDK direction is right: a hosted client package plus an embedded platform/adapter package is the correct integration model. The v0.1.0 release also proved that external consumers can install the packages from npm.

The biggest gap was productization. The `0.2.0` implementation release addresses the first tranche directly: Neon reliability, migrations, explicit article metadata, reusable auth helpers, typed client responses, MCP tool scopes, and a reference fetch handler/admin token surface.

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

Status: addressed in `@publication-mcp-studio/platform@0.2.0` with explicit projections, write-then-select behavior, nullable-array normalization, and regression tests. Hosts should still keep a real Neon HTTP smoke test in their own CI.

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

1. Fixed in `0.2.0`: Neon adapter avoids `SELECT *`, avoids `RETURNING *`, avoids nullable `text[]` bindings, and has static regression coverage.
2. Fixed in `0.2.0`: migrations ship through `migrateNeonPublicationPlatform()` plus packaged SQL.
3. Fixed in `0.2.0`: article records now have an explicit `metadata` contract.
4. Partially fixed in `0.2.0`: canonical auth helpers, `PUBLICATION_MCP_TOOL_SCOPES`, and a framework-neutral reference handler are shipped; framework-specific Express/Hono packages can still be added later.
5. Partially fixed in `0.2.0`: client return values, errors, token helpers, and MCP helpers are typed; a richer admin UI can still be added later.

If items 1 through 4 land, an outside host should be able to integrate Publication MCP Studio in roughly 100 lines of glue code instead of writing a parallel adapter and route layer.
