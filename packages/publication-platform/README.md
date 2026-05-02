# Publication Platform Package

This package contains the stack-agnostic platform boundary for Publication MCP Studio.

Install:

```bash
npm install @publication-mcp-studio/platform
```

Goals:

- keep framework and persistence seams explicit
- make it easy to add new adapters without rewriting app code
- make it practical for outside apps to embed the publication persistence layer

Current public surface:

- `src/index.ts` for adapter selection
- `src/types.ts` for storage and auth contracts
- `src/errors.ts` for shared platform errors
- `src/media-storage.ts` for shared media-storage config helpers
- `src/token-scopes.ts` for shared token scope definitions
- `src/local.ts` for the local filesystem adapter
- `src/neon.ts` for the Neon/Postgres adapter
- `src/supabase.ts` for the Supabase adapter
- `src/template.ts` for scaffolding a new adapter

Published npm package:

- https://www.npmjs.com/package/@publication-mcp-studio/platform

Important boundary:

- this package is intentionally stack-agnostic
- host apps own route handlers, session cookies, and admin auth behavior
- if you need a fetch-based integration SDK for a hosted deployment, use `@publication-mcp-studio/client`

Update guidance:

- prefer expanding the interfaces in `src/types.ts` deliberately instead of reaching around them from app code
- keep app imports pointed at the package entrypoints, not individual app internals
- add new adapters beside `local.ts` and `supabase.ts`, then expose them through `src/index.ts`
- protect adapter changes with `npm run test:platform`

Selection behavior:

- `PUBLICATION_PLATFORM_ADAPTER=local` forces the filesystem adapter
- `PUBLICATION_PLATFORM_ADAPTER=neon` forces the Neon/Postgres adapter
- `PUBLICATION_PLATFORM_ADAPTER=supabase` forces the Supabase adapter
- if no explicit adapter is set, the package auto-selects `supabase` when the required Supabase env vars are present, then `neon` when a Neon database URL is present, and otherwise falls back to `local`
- `PUBLICATION_LOCAL_ROOT_DIR` lets another host app point local persistence at its own project root
- `PUBLICATION_LOCAL_SEED_DEMO_CONTENT=false` disables the seeded demo article
- `PUBLICATION_ADMIN_EMAIL` and `PUBLICATION_ADMIN_PASSWORD` secure the local credential flow used by non-Supabase admin adapters
- `PUBLICATION_MEDIA_DRIVER=s3` enables shared S3-compatible publication media storage for adapters that support it
- `PUBLICATION_MEDIA_PUBLIC_BASE_URL` should point at the public CDN or bucket base URL for uploaded assets

Custom adapter path:

1. Implement the interfaces in `src/types.ts`.
2. Start from `createTemplatePublicationPlatformFactory()` in `src/template.ts`.
3. Register the adapter in `createPublicationPlatformRegistry()` or inject your own registry from the host app.

Host app integration:

1. Choose `local`, `neon`, or `supabase`.
2. Provide `adminAuthStore` from the host stack.
3. Wire your own routes or use this repo as the hosted service.

Neon status:

- `0.2.0` fixes the known Neon HTTP driver issues around `SELECT *`, `RETURNING *`, nullable `text[]` bindings, and first-run migrations
- run `migrateNeonPublicationPlatform()` or apply the packaged `migrations/neon_schema.sql` before first use
- keep a real Neon branch smoke test in the host app before production rollout

See:

- [docs/publication-integration-guide.md](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/publication-integration-guide.md)
- [docs/sdk-integration-feedback-v0.1.0.md](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/sdk-integration-feedback-v0.1.0.md)
- [templates/nextjs-embedded/README.md](https://github.com/son-of-ole/publication-mcp-studio/blob/main/templates/nextjs-embedded/README.md)
