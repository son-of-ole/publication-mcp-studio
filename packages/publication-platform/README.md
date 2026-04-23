# Publication Platform Package

This internal package contains the platform boundary for Publication MCP Studio.

Goals:

- keep framework and persistence seams explicit
- make it easy to add new adapters without rewriting app code
- give the repo a clean extraction path if this becomes a standalone package later

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

Update guidance:

- prefer expanding the interfaces in `src/types.ts` deliberately instead of reaching around them from app code
- keep app imports pointed at the package entrypoints, not individual app internals
- add new adapters beside `local.ts` and `supabase.ts`, then expose them through `src/index.ts`
- protect adapter changes with `npm run test:platform`

Selection behavior:

- `PUBLICATION_PLATFORM_ADAPTER=local` forces the filesystem adapter
- `PUBLICATION_PLATFORM_ADAPTER=neon` forces the Neon adapter
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
