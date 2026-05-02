# Publication MCP Studio

A standalone, markdown-first scientific publication system with:

- polished public article rendering
- admin editing workspace
- pluggable article, token, media, audit, and version storage
- token-authenticated REST API
- always-on MCP server for external agents
- governed SEO and Scientific skill bundles for MCP agents
- version history, audit logging, and token inventory

It supports both:

- hosted integration through REST/MCP plus `@publication-mcp-studio/client`
- embedded integration through `@publication-mcp-studio/platform`

## NPM SDK

The integration SDK is published on npm under the `@publication-mcp-studio` scope:

```bash
npm install @publication-mcp-studio/client
npm install @publication-mcp-studio/platform
```

- [`@publication-mcp-studio/client`](https://www.npmjs.com/package/@publication-mcp-studio/client) is the fetch-based SDK for apps that call a hosted Publication MCP Studio service over REST and MCP.
- [`@publication-mcp-studio/platform`](https://www.npmjs.com/package/@publication-mcp-studio/platform) is the adapter/platform SDK for apps that want to embed publication persistence directly into their own backend.

For outside stacks, start with [docs/publication-integration-guide.md](./docs/publication-integration-guide.md). Current v0.1.0 integration feedback and v0.1.1 priorities are tracked in [docs/sdk-integration-feedback-v0.1.0.md](./docs/sdk-integration-feedback-v0.1.0.md).

## What This Repo Contains

- `src/app/publications` for the public-facing publication library and article pages
- `src/app/admin` for the publication admin/editor UI
- `src/app/api/publications` for REST, MCP, token, media, audit, and agent routes
- `src/lib/publication-*` for the publication service layer
- `packages/publication-platform` for the installable adapter/platform package
- `packages/publication-client` for the installable hosted-service client package
- `docs/publications-authoring.md` for markdown/frontmatter authoring
- `docs/publications-api-mcp.md` for the external API and MCP contract
- `docs/publication-integration-guide.md` for integration into outside stacks

## Environment

Copy `.env.example` to `.env.local` and fill in the required values.

Production variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLICATION_API_SECRET`
- `NEXT_PUBLIC_SITE_URL`

Optional:

- `NEON_DATABASE_URL`
- `DATABASE_URL`
- `POSTGRES_URL`
- `PUBLICATION_API_TOKEN`
- `PUBLICATION_PLATFORM_ADAPTER`
- `PUBLICATION_LOCAL_ROOT_DIR`
- `PUBLICATION_LOCAL_SEED_DEMO_CONTENT`
- `PUBLICATION_ADMIN_EMAIL`
- `PUBLICATION_ADMIN_PASSWORD`
- `OPENROUTER_API_KEY`
- `PUBLICATION_AGENT_MODEL`

## Local Mode

If the Supabase variables are not configured, the app now falls back to a persistent local adapter automatically.

Local mode provides:

- a filesystem-backed publication store
- local media storage under `public/__publication-local`
- local token inventory, audit log, and version history
- a seeded demo article so `/publications` works immediately
- local admin login via `/api/auth/local-login`

Local data is stored under `.publication-mcp-studio/` and is gitignored.

You can also force the adapter explicitly:

- `PUBLICATION_PLATFORM_ADAPTER=local`
- `PUBLICATION_PLATFORM_ADAPTER=supabase`

And tune local mode for another host app:

- `PUBLICATION_LOCAL_ROOT_DIR=/absolute/path/to/host-app`
- `PUBLICATION_LOCAL_SEED_DEMO_CONTENT=false`

## Integration Surface

The portability seam lives in `packages/publication-platform/`.

It defines installable interfaces for:

- `PublicationStore`
- `MediaStore`
- `TokenStore`
- `AuditStore`
- `PublicationVersionStore`
- `AdminAuthStore`

Current adapters:

- `supabase`
- `local`
- `neon` (experimental in v0.1.0; see [Neon v0.1.0 caveat](#neon-v010-caveat))

To integrate this into another stack later, add a new adapter that satisfies those interfaces and update the platform selection logic in `packages/publication-platform/src/index.ts`.

There is also a scaffold helper in `packages/publication-platform/src/template.ts` for standing up a new adapter without starting from scratch.

For hosted-service consumers, install `@publication-mcp-studio/client` and call the deployed REST/MCP endpoints instead of embedding the storage layer.

## Governed Skills

The MCP layer now includes a governed skill registry on top of core MCP primitives.

- Core article/media/import/export/document tools remain the only mutation path.
- Skills are advisory and non-mutating.
- V1 ships with `seo` and `scientific` bundles.
- Tokens now carry profile defaults plus optional token-level skill restrictions.
- MCP discovery filters prompts, workflows, verifiers, and skill resources by the caller's enabled skills.

New MCP surfaces include:

- `list_skills`
- `get_skill`
- `list_enabled_skills`
- `run_skill_workflow`
- `publication://skills`
- `publication://skills/enabled`
- `publication://skills/{skillId}`

## Development

```bash
npm install
npm run bootstrap
npm run dev
```

For a full repo safety pass:

```bash
npm run check
```

Integration examples:

- [docs/publication-integration-guide.md](./docs/publication-integration-guide.md)
- [docs/sdk-integration-feedback-v0.1.0.md](./docs/sdk-integration-feedback-v0.1.0.md)
- [templates/nextjs-embedded/README.md](./templates/nextjs-embedded/README.md)
- [templates/hosted-client/README.md](./templates/hosted-client/README.md)

## Neon

### Neon v0.1.0 Caveat

The `@publication-mcp-studio/platform@0.1.0` Neon adapter is experimental. Live testing against stock Neon HTTP/Postgres environments found blocking adapter bugs around `SELECT *` type decoding, `RETURNING *`, nullable `text[]` bindings, and missing first-run migration helpers. Until v0.1.1 lands, prefer the `local` or `supabase` adapter for production integrations, or use a host-owned custom Neon adapter that applies the workarounds documented in [docs/sdk-integration-feedback-v0.1.0.md](./docs/sdk-integration-feedback-v0.1.0.md).

The Neon adapter uses Postgres for articles, versions, tokens, audit events, and media metadata.

Setup:

1. Run [neon_schema.sql](./neon_schema.sql) in your Neon SQL editor.
2. Set `NEON_DATABASE_URL` to your Neon connection string.
3. Set `PUBLICATION_PLATFORM_ADAPTER=neon` if you want to force Neon instead of auto-detection.
4. Set `PUBLICATION_ADMIN_EMAIL` and `PUBLICATION_ADMIN_PASSWORD` for admin sign-in.

Notes:

- By default, the Neon adapter keeps uploaded file bytes on the app filesystem under `public/__publication-local`.
- For multi-instance production, configure shared S3-compatible media storage with:
- `PUBLICATION_MEDIA_DRIVER=s3`
- `PUBLICATION_MEDIA_S3_BUCKET=...`
- `PUBLICATION_MEDIA_S3_REGION=...`
- `PUBLICATION_MEDIA_S3_ACCESS_KEY_ID=...`
- `PUBLICATION_MEDIA_S3_SECRET_ACCESS_KEY=...`
- `PUBLICATION_MEDIA_PUBLIC_BASE_URL=https://cdn.example.com/publication-assets`
- Optional extras: `PUBLICATION_MEDIA_S3_ENDPOINT`, `PUBLICATION_MEDIA_S3_SESSION_TOKEN`, `PUBLICATION_MEDIA_PREFIX`, `PUBLICATION_MEDIA_S3_FORCE_PATH_STYLE=true`

## Production

- apply `supabase_schema.sql` to your Supabase project
- or apply `neon_schema.sql` to your Neon project
- configure Vercel environment variables
- deploy to Vercel

The MCP endpoint will be available at:

```text
https://your-domain.example/api/publications/mcp
```

Quick hosted smoke test:

```bash
docker compose up --build
```
