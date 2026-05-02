# Publication Integration Guide

This repo now supports two realistic integration modes for other software teams.

## 1. Hosted Mode

Use hosted mode when another website or product just needs publication authoring, REST, and MCP capabilities without embedding the full persistence layer into its own backend.

Recommended pieces:

- deploy this repo as its own service
- expose `/api/publications/*` and `/api/publications/mcp`
- use `@publication-mcp-studio/client` from the external app

Good fit for:

- SaaS products that want publication workflows fast
- external websites that want to embed links, dashboards, or agent workflows
- teams that prefer REST/MCP integration over shared database ownership

## 2. Embedded Mode

Use embedded mode when another stack wants to own persistence and auth locally.

Recommended pieces:

- install `@publication-mcp-studio/platform`
- choose `local`, `neon`, or `supabase`
- provide a host-owned `adminAuthStore`
- mount the drop-in Fetch, Express, or Next route handler
- use BYO routes only when the host needs custom auth/session behavior

Good fit for:

- existing Next.js apps
- internal tools that already own auth/session logic
- teams that want direct control over storage adapters

## Package Roles

- `@publication-mcp-studio/platform`
  - storage contracts
  - adapter selection
  - local, Neon, and Supabase adapters
  - shared token/media/platform types
  - drop-in Fetch, Express, and Next route handlers
  - `publication-mcp issue-token` bootstrap CLI
- `@publication-mcp-studio/client`
  - fetch-based integration SDK for hosted deployments
  - article CRUD helpers
  - verification helpers
  - MCP JSON-RPC helper methods
- `@publication-mcp-studio/react`
  - `useArticles()` and `useArticle()` for lightweight public read integration

Install from npm:

```bash
npm install @publication-mcp-studio/client
npm install @publication-mcp-studio/platform
npm install @publication-mcp-studio/react
```

Package pages:

- [`@publication-mcp-studio/client`](https://www.npmjs.com/package/@publication-mcp-studio/client)
- [`@publication-mcp-studio/platform`](https://www.npmjs.com/package/@publication-mcp-studio/platform)
- [`@publication-mcp-studio/react`](https://www.npmjs.com/package/@publication-mcp-studio/react)

## Fastest Paths

### Fastest hosted setup

1. `npm run bootstrap`
2. set `PUBLICATION_PLATFORM_ADAPTER=local`
3. set `PUBLICATION_ADMIN_EMAIL`, `PUBLICATION_ADMIN_PASSWORD`, and `PUBLICATION_API_SECRET`
4. `npm run dev` or `docker compose up --build`
5. use `@publication-mcp-studio/client` from the external app

### Fastest embedded setup

1. install `@publication-mcp-studio/platform`
2. start with the local adapter
3. call `platform.ensureSchema()` at boot
4. mount `createPublicationExpressHandler()`, `createPublicationFetchHandler()`, or `createPublicationNextRouteHandlers()`
5. issue the first token with `npx publication-mcp issue-token --label "My App" --scopes mcp:connect,articles:read --json`
6. move to Neon or Supabase when shared persistence is needed

Note: `@publication-mcp-studio/platform@0.3.0` includes the Neon HTTP fixes from integration testing, first-class category/tags, `platform.ensureSchema()`, and `migrateNeonPublicationPlatform()`. Run the migration before first use and keep a real Neon branch smoke test in your host CI.

## Templates

- [templates/nextjs-embedded/README.md](../templates/nextjs-embedded/README.md)
- [templates/hosted-client/README.md](../templates/hosted-client/README.md)
