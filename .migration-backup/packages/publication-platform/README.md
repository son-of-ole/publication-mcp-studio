# Publication Platform Package

Stack-agnostic publication persistence, auth, migration, and HTTP adapters for embedding Publication MCP Studio into another backend.

```bash
npm install @publication-mcp-studio/platform
```

## Quick Start

Most hosts should start with the drop-in handler:

```ts
import express from 'express'
import {
  createNeonPublicationPlatform,
  createPublicationExpressHandler,
} from '@publication-mcp-studio/platform'

const platform = createNeonPublicationPlatform({
  databaseUrl: process.env.DATABASE_URL,
})

await platform.ensureSchema()

const app = express()
app.use('/publications', createPublicationExpressHandler({
  platform,
  tokenSecrets: [process.env.PUBLICATION_TOKEN_SECRET!],
}))
```

Available handler surfaces:

- `createPublicationFetchHandler()` for Web Fetch runtimes.
- `createPublicationExpressHandler()` for Express and Node `IncomingMessage`/`ServerResponse`.
- `createPublicationNextRouteHandlers()` for Next.js App Router route files.

BYO routes are still supported, but they are now the advanced path. If you write custom routes, keep using `authenticatePublicationRequest()`, `PUBLICATION_MCP_TOOL_SCOPES`, and the platform stores so behavior stays compatible with the SDK client.

## First Token

The package ships a bootstrap CLI:

```bash
DATABASE_URL="postgresql://..." \
PUBLICATION_TOKEN_SECRET="change-me" \
npx publication-mcp issue-token \
  --label "Website Integration" \
  --scopes mcp:connect,articles:read,articles:write \
  --json
```

The CLI applies the Neon migration defensively, creates a registered token record, signs the token, and prints the token payload.

## Adapters

Current adapters:

- `local`: filesystem-backed development adapter.
- `neon`: Postgres/Neon adapter with idempotent schema migration.
- `supabase`: Supabase table/storage adapter.

Selection helpers:

- `PUBLICATION_PLATFORM_ADAPTER=local|neon|supabase`
- `NEON_DATABASE_URL`, `DATABASE_URL`, `POSTGRES_URL`, or `POSTGRES_PRISMA_URL`
- `PUBLICATION_LOCAL_ROOT_DIR`
- `PUBLICATION_LOCAL_SEED_DEMO_CONTENT=false`
- `PUBLICATION_ADMIN_EMAIL`
- `PUBLICATION_ADMIN_PASSWORD`

## v0.3.0 Additions

- `platform.ensureSchema()` for first-run boot checks.
- First-class `category text` and `tags text[]` article fields.
- Category, tag, offset, and cursor list filters.
- `countArticles()` for real total counts instead of page-length-only counts.
- Express and Next route wrappers.
- `PUBLICATION_SCOPES` and token read/write scopes.
- CLI token bootstrap via `publication-mcp issue-token`.
- Neon fixes for custom `adminAuthStore`, nullable audit UUIDs, and empty-result Neon driver crashes.

## Neon Notes

`migrateNeonPublicationPlatform()` and `platform.ensureSchema()` apply the canonical schema in `migrations/neon_schema.sql`. The Neon adapter avoids `SELECT *`, avoids `RETURNING *`, casts UUID/timestamp/array fields explicitly, and omits null array binds that the Neon HTTP driver serializes poorly.

## Docs

- [Integration guide](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/publication-integration-guide.md)
- [REST contract](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/publication-rest-contract.md)
- [Metadata conventions](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/metadata-conventions.md)
- [v0.2.0 integration feedback](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/sdk-integration-feedback-v0.2.0.md)
