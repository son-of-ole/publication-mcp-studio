# Publication MCP Studio 0.4.0

This release contains the headless publication engine, the separate read-only
website, and version 0.4.0 of `@publication-mcp-studio/platform` and
`@publication-mcp-studio/client`. Website and engine deployment remain internal;
shipping source and SDK packages does not deploy either service.

## Included behavior

One scoped MCP agent connection can create/edit private articles, upload images,
PDFs and data, attach supporting descriptions/text, review, explicitly publish,
create private revisions and withdraw content. Normal agent scopes do not permit
deletion or credential management. The local stdio bridge renews its connection
using private owner configuration; remote HTTP harnesses need secret-manager
rotation. Optional separate writer and publisher roles remain available.

The website serves initial HTML without JavaScript, single-file Markdown with
supporting text and absolute file links, canonical/social metadata, associated-media
structured data, sitemap and robots discovery. Files stay private until referenced
by their owning published article. Publication and withdrawal take effect on the
next request without rebuilding. External indexing timing is controlled by crawlers.
The engine does not execute PDF/DOCX parsers; supporting text is supplied by the
harness.

The SDKs include the article lifecycle, structured attachments, bounded chunked
uploads with SHA-256 verification, publication-gated media, public-delivery helpers,
typed client methods and an HTTP-to-stdio MCP bridge. Structured business errors
retain their JSON-RPC request IDs through the bridge, including HTTP conflicts.
Private S3/Supabase objects use publication-gated paths. Legacy public provider
objects require migration before draft privacy can be guaranteed for those files.

## Qualification

The full build/type checks, 90 automated tests, SDK export validation, and clean
packed-package consumer/TypeScript/CLI checks form the release validation pipeline.
The dependency audit is run against the release lockfile rather than relying on a
previous result. October 27 release preparation updates the affected request-parser,
upload, schema-validation and transitive HTTP dependencies to patched versions.

The [October 22 internal harness report](internal-harness-verification.md) records
29 acceptance checks using two real NASA photographs, an original nine-page PDF,
a transcribed dataset, a private revision with a replacement dataset, stale-review
and replay rejection, and complete withdrawal. The final sample publication is
retained privately. These are local receipts, not cloud deployment qualification.

GitHub Actions runs frozen installation, build/type checks, tests, package export
checks, a clean tarball consumer and dependency audit. Registry publication is
verified independently after a successful publish; a build or dry run is not a
publication receipt.

## Operations and artifacts

See [agent workflows](publications-agent-workflows.md) and
[secure operations](secure-operations.md) for connection setup, file limits,
credential handling, private cloud policies and recovery requirements.

Local `output/releases/v0.4.0/` contains generated package archives, SHA256SUMS and
verification logs. Local data, credentials, harness configuration, acceptance
assets and the preserved handoff backup are excluded from Git and npm packages.

Production hosting remains deferred. Any later deployment needs selected hosts
and canonical domains, HTTPS, durable storage, network/filesystem isolation,
qualified live cloud policies and provider recovery. Public SDK publication does
not grant the website access to private engine credentials.
