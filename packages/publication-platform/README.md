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

## Public HTML, Markdown and crawler discovery

The public delivery handler is separate from the authenticated editing API:

```ts
import { createPublicPublicationFetchHandler } from '@publication-mcp-studio/platform/public'

const publicPages = createPublicPublicationFetchHandler({
  store: platform.publicationStore,
  mediaStore: platform.mediaStore, // private media gated by publication status
  siteUrl: 'https://publications.example.com',
  siteName: 'My Publications',
})

// In a Fetch-compatible host, call publicPages(request); null means no public
// route matched, so the host can continue routing other requests.
```

It serves `/publications`, `/publications/<slug>`, `/publications/<slug>.md`,
`/publications/<slug>/raw`, `/sitemap.xml` and `/robots.txt` with GET/HEAD support.
The HTML includes per-article metadata, canonical and Markdown discovery links,
social metadata and Article JSON-LD. Markdown includes canonical metadata and
absolute media links. The default HTML presents escaped article text; supply
`renderArticle` and `renderDirectory` callbacks for a richer server renderer,
as the Studio reference host does. `headHtml` accepts trusted stylesheet/script
tags from the host, never user-authored article markup.

The handler enforces `status === 'published'` independently of cookies or API
tokens. Drafts and missing articles have the same 404 response. Listings and
sitemaps use the store's offset pagination and filter for publication status.
Public responses are not cached, so edits and unpublishing take effect without
a rebuild. Canonical site origin is required explicitly; request Host headers
cannot change sitemap, canonical, structured-data or Markdown URLs.

For a separate reader website, keep the publication store and credentials in the
engine and expose only a published feed on its own listener:

```ts
import { createPublishedPublicationFetchHandler } from '@publication-mcp-studio/platform/public'
const publishedFeed = createPublishedPublicationFetchHandler(platform.publicationStore)
// publishedFeed(request) serves GET/HEAD /articles and /articles/<canonical-slug>.
// Unknown routes return 404; writes return 405. Credentials never expose drafts.
```

The website should use an anonymous remote store reader against that feed when
constructing its public HTML handler. Do not mount the authenticated editing API
or proxy it through the website. See the repository README for the reference
engine/feed/website arrangement and MCP connection bootstrap.

Also exported: `getPublicPublicationMetadata`, `getPublicPublicationMarkdown`,
`escapePublicationHtml`, and `serializePublicPublicationData`.

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

The CLI selects the configured local, Neon or Supabase adapter, ensures its schema
where supported, registers a scoped expiring token and prints its payload. Treat
that output as a secret. With no explicit scopes, it issues ordinary agent authority
(read/write/publish/MCP) without deletion or token administration. Supabase table
provisioning and private provider policies remain operator setup steps.

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

## v0.3.2 Notes

- `PublicationTokenInventoryRecord` is fully camelCase, matching the rest
  of the public surface. Hosts no longer need a separate
  `tokenInventoryToResponse` mapping helper — the record returned by
  `tokenStore.listTokens()` matches the wire format.
- With 0.3.2 installed, the three legacy host-side workarounds can be
  retired: the `safeGetArticleByIdentifier` wrapper, the hard-coded
  `PUBLICATION_SCOPES` array (import the export instead), and the
  `try/catch` around `auditStore.recordEvent` for non-article events.

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

## Private revisions and portable MCP

The generic Fetch/Express/Next handler now implements core MCP initialization,
discovery and article/revision execution. Discovery advertises only implemented
tools permitted by the token. Scientific/media tools remain in the reference
engine. Ordinary live edits return a conflict; draft-writing tokens cannot bypass
publish permission via create, PATCH or status aliases.

The root export provides `createPublicationRevision`, `preparePublication`,
`publishPublicationRevision`, `publicationContentDigest` and
`updatePublicationIfUnchanged`. Revisions are separate private records. Publication
requires the reviewed digest and atomically matches all live content fields. Each
publication transition rotates an edition nonce, invalidating stale/replayed
approvals without relying on database timestamp precision. Custom stores must
implement `updateArticleIfMatches`; the operation fails closed without it.

Privileged store APIs intentionally bypass HTTP authorization and belong only in
trusted engine code. Keep private revisions out of all public queries. The SDK's
published feed and public page helpers already enforce published-only delivery.

`backupLocalPublications` and `restoreLocalPublications` support encrypted local
recovery into a new directory; restored tokens are revoked. These small-store
helpers do not back up cloud providers. See the repository's secure operations
and agent workflow documents for the complete reference arrangement.

## Complete harness workflow (0.4)

`createPublicationFetchHandler` supplies article/revision and attachment upload MCP
tools on its `/mcp` route. Use a registered scoped token with MCP/read/write/publish
permissions for one agent connection. The portable SDK supports the same attachment
protocol as the reference engine: `begin_media_upload`, `upload_media_chunk`,
`complete_media_upload`, `abort_media_upload`, `attach_media`, `detach_media`, and
`list_attachments`. The typed client implements this protocol in `uploadMedia` and
its attachment methods. Files are bounded to 8 MiB and staged in memory for 15
minutes with bounded concurrency/capacity. A completed file must still be attached
and the draft explicitly published. Single-process staging requires sticky routing
when scaling a host. See the repository workflow guide for exact limits.

`@publication-mcp-studio/platform/attachments` exports browser-safe
`getPublicationAttachments` and `publicationMarkdownWithAttachments`. A custom
`renderArticle` callback should render the latter so supporting descriptions,
images, download links and author-supplied text appear without JavaScript.
The public Markdown helper does this automatically. The default HTML is escaped
readable text; production hosts can supply a richer server renderer.

`createPublishedMediaFetchHandler(platform)`, exported from the root and `/assets`,
serves publication-gated local/cloud media independently of authoring credentials.
Supply `mediaStore` to the public HTML handler to mount it there, or mount this
handler on the dedicated published feed. The website must forward only the fixed
media path pattern, never arbitrary provider URLs or engine paths.

S3 uploads require a private bucket with all four Block Public Access flags;
Supabase uploads require a private `article-assets` bucket. The operator SQL export
`SUPABASE_PRIVATE_ENGINE_SQL` provisions the private bucket and restrictive RLS
for existing engine tables and storage objects. Apply it after table provisioning,
then verify anonymously against the live provider. The storage-only subset is
`SUPABASE_PRIVATE_MEDIA_SQL`. Existing external public URLs need migration.

For stdio harnesses connected to an HTTP engine, save an HTTP MCP configuration
privately with `mcpServers.publicationEngine.url` and `headers.Authorization`, then:

```sh
publication-mcp stdio --connection-file /private/path/to/connection.json
```

The bridge keeps stdout JSON-RPC-only, reads credentials from the file per request,
and requires HTTPS except on loopback. Remote tokens need secret-manager rotation.
The reference repository also generates a local stdio bridge that automatically
renews its scoped token using the owner's private local configuration. That helper
is for a trusted engine host, not an untrusted remote client.

Release verification packs both SDKs, installs them into a separate temporary
consumer, checks runtime publication/attachment/revision flow and compiles a
TypeScript consumer. Run `pnpm verify:sdk` from the repository after building.
