# Publication MCP Studio

An embeddable publication SDK, a private MCP authoring engine, and a separate
read-only publication website. The SDK packages live under `packages/`; the
reference engine and website live under `artifacts/`.

## Architecture

```text
AI client -- authenticated MCP --> private engine :8080 --> publication store
                                        |
                              published-only feed :8081
                                        |
                              reader website :5180
                           HTML / Markdown / sitemap
```

Drafting, editing, media uploads, version history, token management and publishing
stay in the engine. The website has no login, editor, generation endpoint or MCP
endpoint. Its only upstream is the dedicated GET/HEAD published feed. It receives
no database credentials, admin password, signing secret or engine API token.
The old browser authoring UI is preserved in `.migration-backup/studio-authoring-ui/`
and is excluded from the active website source and build.

The engine and feed are separate HTTP listeners in the engine process. The feed
has no authoring router or authentication middleware: credentials never expand
its capabilities. The website makes fixed, anonymous read requests and never
forwards visitor cookies, bearer tokens, write methods or arbitrary API paths.
`/api`, `/admin` and `/mcp` on the website return 404. Website writes return 405.

## Local development

Use Node.js 24 or newer and pnpm 10.13.1:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [the publication website](http://127.0.0.1:5180/publications).
All three local listeners bind to IPv4 loopback. Configure `PUBLICATION_WEB_PORT`,
`PUBLICATION_API_PORT` and `PUBLICATION_FEED_PORT` in `.env.local` to change ports.

On first start, the runner generates a private, Git-ignored `.env.local` with
local engine credentials and signing secret. These are passed only to the engine.
The website child receives an explicit environment allowlist. The runner builds
SDK exports before starting either application; after SDK edits, rebuild the SDK
and restart the runner. Ctrl-C stops the development services.

Local data lives under `.publication-local-dev/`, separate from older
`.publication-mcp-studio/` data and handoff backups. No cloud database is required.
Tests use temporary storage and do not alter existing local articles.

## Connect an AI client to the engine

With `pnpm dev` running:

```sh
pnpm engine:connect
```

This provisions one scoped **agent** connection: read, draft, upload and explicitly
publish, without deletion or account/token administration. No browser login is
needed for normal publishing. The private HTTP credential is saved as
`.publication-local-dev/mcp-agent-connection.json` (0600, seven-day expiry).

For a harness on this computer, use the generated
`.publication-local-dev/mcp-harness.json` stdio configuration. Its bridge renews
the scoped credential automatically from the local owner's private configuration;
the engine must be running. The configuration contains no password or token.
The bridge can access `.env.local`, so run it only on the trusted engine host.
It is a convenience for the owner, not a sandbox for untrusted local code.

Optional `--role writer` and `--role publisher` preserve separate approval
credentials; `--role owner` is for trusted operators. Re-running `engine:connect`
rotates that role's token and revokes its previous token. Owner bootstrap sessions
are signed out after issuance. Remote HTTP harnesses use their secret manager for
credential rotation; local automatic renewal does not extend to a remote harness.

Use the connection URL and Authorization header in your client's remote MCP
configuration. The default endpoint is `http://127.0.0.1:8080/api/publications/mcp`.
A remote/cloud AI client cannot reach your computer's loopback address; deploy
or securely connect the engine separately before configuring such a client.

For this project's Codex harness, run `pnpm engine:connect:codex`. It writes a
Git-ignored, project-scoped `.codex/config.toml` entry with the 16 ordinary
publication tools. It preserves global Codex configuration and keeps credentials
in the private bridge. The project must be trusted. Codex loads this connection
as `publication_engine`; use its MCP tools directly for normal authoring.
See [the real internal acceptance run](docs/internal-harness-verification.md).

The reference MCP engine supports `create_article`, `update_article`,
`get_article`, `publish_article`, `unpublish_article`, media tools and version
operations. Create a draft, edit it, and explicitly publish it when ready.
`unpublish_article` returns it to a private draft. Editing live content now requires
`create_revision`; edits stay private until `prepare_publication` and an explicit
`publish_revision` with the reviewed digest. Concurrent changes, stale reviews,
withdrawal/republication and publication replay are rejected. The original slug
remains canonical. Version restoration always produces draft content.

The portable SDK executes the core article and revision MCP lifecycle, structured
attachments and bounded chunked uploads.
The portable SDK also executes structured attachments and bounded, checksum-verified
chunked uploads. The reference engine adds history and scientific/document tools. See
[the AI authoring workflow](docs/publications-agent-workflows.md) and
[secure operation and deployment gates](docs/secure-operations.md).

## Public delivery and privacy

- `/publications/<slug>` contains the full article in initial HTML, including
  figures, references, readable chart tables, canonical URL, description,
  Open Graph/Twitter metadata and Article JSON-LD. JavaScript is optional for reading.
- `/publications/<slug>.md` is a complete Markdown document with canonical,
  author/date frontmatter and absolute media links. `/publications/<slug>/raw`
  returns the same document. HTML advertises the Markdown alternative.
- `/publications`, `/sitemap.xml` and `/robots.txt` expose published discovery.
  Directory and sitemap generation paginate beyond the first 100 records.
- `/content/articles` and `/content/articles/<slug>` provide read-only published
  JSON for browser navigation. Status/private selectors are ignored. ID aliases,
  versions, tokens, audit logs and all other engine routes are unavailable.
- Local uploaded media is served only while its owning article is published and
  references that asset. Unreferenced uploads and draft attachments return 404.
  New S3/Supabase uploads use private provider objects and publication-gated
  website URLs. Existing external links retain their provider access policy; migrate
  previously public files before claiming draft privacy for them.

Drafts, missing records, unpublished records and deleted records return the same
public 404, even with valid engine credentials. Public responses use `no-store`,
so approved publications and withdrawal take effect on the next request without a rebuild.
Robots rules guide discovery; publication status is enforced independently.
Markdown identifies the canonical HTML page and uses `X-Robots-Tag: noindex`.

The portable `@publication-mcp-studio/platform/public` export includes
`createPublicPublicationFetchHandler` for HTML/Markdown/discovery and
`createPublishedPublicationFetchHandler` for a separate read-only JSON feed.
Hosts can supply their own renderers or remote store readers.

## Verification

```sh
pnpm build
pnpm test
node packages/publication-platform/scripts/verify-tarball.mjs
pnpm verify:sdk
```

The tests cover admin-session forgery, expiry and revocation; real HTTP/SDK/MCP
operations; separate engine/feed/production website listeners; draft privacy;
MCP create/edit/publish/private-revision/review/conditional-publication/unpublish; media privacy; write rejection with
valid owner credentials; crawler HTML and metadata; Markdown; paginated discovery;
and immediate removal after unpublishing. Browser checks also exercise reading
without JavaScript. Local verification does not qualify cloud adapters or a live
deployment.

## Independent production services

After `pnpm build`, start the engine with its private adapter/credentials and
HTTPS `PUBLICATION_ENGINE_ORIGIN` using a private `.env.production` based on the
example. It defaults to loopback, even in production:

```sh
PORT=8080 PUBLICATION_FEED_PORT=8081 NODE_ENV=production \
node --env-file=.env.production artifacts/api-server/dist/index.mjs
```

Start the website with only reader configuration:

```sh
PUBLICATION_SITE_URL=https://publications.example.com \
PUBLICATION_PUBLISHED_ORIGIN=http://127.0.0.1:8081 \
PORT=19344 NODE_ENV=production \
pnpm --filter @workspace/publication-studio start
```

Run the website as its own process/container, without engine secrets or a mount
of the engine store. Permit website egress only to the published feed; permit AI
clients to the separately secured engine origin. Bind `HOST` and
`PUBLICATION_FEED_HOST` explicitly when separate containers require it. Do not
reverse-proxy the engine through the website's `/api` paths. Configure remote
engine access with HTTPS and scoped tokens.

`PUBLICATION_SITE_URL` must be the canonical bare HTTP(S) website origin; Host
headers cannot change it. Serving only Vite's static shell loses server rendering;
use the Node website server. The Replit shared `/api` registration and private-port
public mappings have been removed; deploy the engine separately. Only the website
port is mapped publicly. These configurations have been verified locally, not deployed.

The engine's local/Neon admin bootstrap sessions use opaque 256-bit IDs, HttpOnly,
SameSite=Lax cookies and an eight-hour expiry. Login rotates the session, logout
revokes it and credential changes invalidate it. Sessions are bounded and process
local; restarts revoke sessions and multi-instance hosts need a shared session
store. Production cookies require HTTPS. Configure `PUBLICATION_ADMIN_ORIGIN` for
the separate engine origin when cookie-based access is behind a proxy.

## Secure system foundation

The engine now enforces publication authority across REST, MCP, generic SDK
handlers and historical restores. It includes bounded requests/uploads/downloads,
login/request limits, safe production startup checks, readiness endpoints and
single-owner filesystem locking. The reader has CSP and sandboxed embeds.
Native Lean compilation and binary PDF/DOCX imports require a separate isolated
worker; structural checks and text/Markdown imports remain available.

Encrypted local backup and restore commands, scoped connection rotation, and CI
checks are included. See [secure operations](docs/secure-operations.md) for their
limits, recovery procedure and the remaining deployment qualification gates.
