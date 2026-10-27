# Secure operation and deployment gates

## Service boundaries

Run the private engine and reader as separate service accounts or containers.
Only the reader gets public website traffic. It receives a canonical website
origin and published-feed origin; it must have no database/signing/admin/provider
secrets and no mount of the engine state. Both supported reader launchers scrub
the child environment, but environment scrubbing is not an operating-system
sandbox. Enforce filesystem/process/network isolation in the deployment.

The published feed is a distinct GET/HEAD listener in the engine process, not a
separate security sandbox. Permit reader egress to that feed and deny access to
the private engine port. Use separate network policy, a narrow feed relay, or an
independently hosted read-only service to enforce that rule. Never proxy `/api`
through the website. Remote MCP clients need a separately secured HTTPS engine
origin and scoped registered bearer tokens.

A production engine requires a bare HTTPS `PUBLICATION_ENGINE_ORIGIN`, a signing
secret of at least 32 characters, scoped tokens, and a long owner password when
password login is enabled. Static wildcard tokens are rejected at startup.
Supabase deployments additionally require `PUBLICATION_ADMIN_USER_IDS`, containing
verified immutable provider user IDs. Empty or unlisted IDs fail closed; ordinary
provider authentication and editable user metadata cannot grant admin access.

Copy `.env.production.example` privately and configure the intended adapter and
provider credentials. Production startup does not prove provider access, database
policy, TLS or network isolation. Apply and qualify provider schema separately.
Conditional publication uses a single content-matching storage update in the
local, Neon and Supabase adapters, without rounded database timestamps. Custom
adapters must implement `updateArticleIfMatches`; mutation fails closed otherwise.
Cloud database transactions and storage policies still require live qualification.
Article updates and history/audit persistence are separate operations; the
adapter alone does not provide a cross-store transaction guarantee.

## Local filesystem mode

One engine process may own a local data root. Startup acquires an exclusive lock
at `<root>/.publication-mcp-studio/engine.lock`; normal shutdown releases it.
Atomic initial creation prevents concurrent readers from reseeding existing state.
State files are written as 0600 and state/media directories are restricted.
New uploaded filenames contain random UUIDs and are immutable.

If a process is forcibly killed, a stale lock can remain. Read its PID, verify
that process is gone and that no process has this store open, then remove only
that lock. Do not delete a live lock or run two filesystem engines against one
root. Production filesystem mode requires explicit
`PUBLICATION_ALLOW_LOCAL_PRODUCTION=true` and durable single-owner storage;
shared production requires a database adapter and shared sessions/ingress limits.

## Authentication and load controls

The reference engine bounds login attempts and total requests with a process-local
IP limiter; it does not trust forwarded client-IP headers. Put fleet-wide limits
at the trusted TLS ingress before scaling. Request/header deadlines and graceful
shutdown bound draining. Owner cookie sessions are bounded, process-local,
credential-bound, expiring and revocable. Multiple engine instances need a shared
session implementation or token-only operational access.

Default `pnpm engine:connect` issues a seven-day scoped agent token for reading,
authoring, uploads and explicit publication. It cannot delete or administer accounts.
The generated local stdio bridge renews this connection automatically using the
owner configuration on the trusted local engine host. It can read `.env.local`;
do not distribute that bridge configuration to untrusted hosts. Remote HTTP tokens
require secret-manager rotation. Optional `--role writer` and `--role publisher`
provide separate drafting and publication credentials.
`--role owner` grants full authority and should be reserved for trusted operators.
Connection files are 0600 and Git-ignored. Rotation revokes the previous token in
that role's connection file. Never put these files into the website environment,
repository, public storage, logs or AI context that does not need the credential.

Uploads authenticate before buffering. The engine accepts bounded JSON and
multipart requests, counts remote streamed bytes, restricts remote destinations
and redirects, and uses download timeouts. Binary document parsing and native
proof compilation are deliberately unavailable until a separately isolated
worker exists. Do not re-enable host execution with an environment flag.

The production reader uses CSP, referrer/permissions headers and sandboxed embeds.
Approved Google Fonts origins are permitted; scripts stay restricted to the
reader origin. Bibliography metadata is formatted as escaped text rather than
trusting generated HTML. Published provider URLs remain governed by their external
storage policies. Confidential draft objects require private provider storage;
unpublishing cannot revoke an already-public external URL or downloaded copies.

## Backups and recovery

Set `PUBLICATION_BACKUP_PASSPHRASE` privately to a strong passphrase of at least
20 characters, using a secret manager rather than shell history. Then:

```sh
pnpm engine:backup ./recovery.publication-backup
pnpm engine:restore ./recovery.publication-backup /absolute/path/to/a-new-data-root
```

Backups encrypt an atomic state-file snapshot and inventory-backed local media
with AES-256-GCM, a random salt/IV and a scrypt-derived key. They exclude environment
files, MCP client credentials and process locks. Output must be a new file; restore
must use a new root. Keep the key separately and test recovery. Concurrent media
deletion can make backup fail; pause authoring for a coordinated recovery point.
The bounded local backup helper is for small local stores (64 MiB raw data budget),
not a replacement for production database/volume backups.

Restore authenticates the archive before creating the destination, validates media
paths, and revokes all restored tokens so an old backup cannot resurrect credentials
revoked later. Existing data cannot be overwritten by restore. Reissue scoped tokens
for the recovered engine. Cloud adapters need provider-native database backups and
separately coordinated object storage recovery; the local helper does not export them.

## Health, CI and launch qualification

- Engine `/api/healthz`: process liveness; `/api/readyz`: selected store read check.
- Feed `/healthz`: published-store read check.
- Website `/healthz`: end-to-end feed readiness, without disclosing content.
- `.github/workflows/verify.yml`: frozen dependency installation, build/type checks,
  tests, SDK tarball/export verification and dependency audit on pushes/PRs.
  A committed workflow is not evidence that GitHub has run it.

Before public launch, verify the selected cloud adapter and schema, least-privilege
DB/storage policy, private engine origin, TLS, network and filesystem separation,
shared limits/session behavior where applicable, restore drill, and live crawler
HTML/Markdown/sitemap withdrawal. Deployment and provider configuration were not
performed by the local implementation pass. Maintain current dependency audits;
zero reported advisories is not proof of absence of vulnerabilities. The bounded
source review also leaves broader historical/generated code and provider/runtime
internals outside its completed coverage.

## Private cloud media and upgrading from 0.3

New cloud media URLs are relative `/__publication-assets/<slug>/<immutable-name>`
paths. Mount `createPublishedMediaFetchHandler(platform)` on the published feed,
or supply `mediaStore` to `createPublicPublicationFetchHandler`. The reference feed
and website already do this. Never expose a provider bucket URL as a draft URL.
The adapters use private provider reads after the owning article is checked.

For Neon with AWS S3, use a dedicated private bucket, enable all four Block Public
Access flags, and grant the engine only the required object operations and
`s3:GetBucketPublicAccessBlock`. Uploads verify those flags and fail closed without
them. Do not add public bucket policies, public access points, or CDN origins that
bypass the engine. Custom S3 providers must support equivalent block-public-access
verification; unsupported providers fail closed. `publicBaseUrl` is no longer used
for new uploads. Verify database roles and durable provider backups independently.

For Supabase, apply the operator setup exported as `SUPABASE_PRIVATE_ENGINE_SQL`
from the platform SDK to provision `article-assets` as private with an 8 MiB limit
and a restrictive policy denying direct anon/authenticated object access. This
policy also blocks old permissive storage policies from granting draft access.
Keep the service-role key only in the engine. Uploads and reads reject a public or
missing bucket. This setup enables restrictive RLS on existing engine tables, denying direct
provider-client access to drafts, versions, tokens and audit entries, even if old
permissive policies exist. Apply it after provisioning the tables and review any
exposed views/functions separately. `SUPABASE_PRIVATE_MEDIA_SQL` is the storage-only
subset for hosts managing database policy elsewhere.
The website uses only the engine's published feed, never a Supabase browser key.
These contracts have provider-mocked tests; live cloud policy qualification has
not been performed by the local verification.

Old public provider URLs cannot be made private by changing their article status.
Migrate those objects and references before launch, revoke old public ACL/policies,
and verify an anonymous request to the original object URL fails. Do not mutate an
existing provider bucket from a runtime upload request. Apply policy changes as
an operator-controlled deployment step and test a draft, published file and
withdrawal both through the website and directly against the provider.

Attachment revisions preserve structured metadata in reference-engine history.
History/audit writes remain separate from article mutation. Staged upload receipts
are process-local and expire; completed private objects are durable. Interrupted
or detached uploads may leave unreferenced private objects for operator cleanup.
