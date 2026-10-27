# MCP publication workflows

The engine owns private content. The website only reads published content.
Use one agent connection for drafting, uploads and explicit publication. It has
`mcp:connect`, `articles:read`, `articles:write`, and `articles:publish`, with no
account administration or deletion authority. Optional separate writer and publisher
connections support organizations that want distinct approval credentials. A writer token cannot publish, withdraw, delete media, or alter a live
article. The engine enforces this on REST, MCP, and version restoration.

## New article

1. `create_article` with title, slug, Markdown/body and status `draft`.
2. `update_article` and `get_article` to refine and inspect the private document.
3. `prepare_publication` to inspect the exact saved article and its digest.
4. Using the agent connection or publisher authority, `publish_article` to approve the initial draft.
5. Read `/publications/<slug>` and `/publications/<slug>.md` on the website.

Initial publishing is an explicit publisher operation. Do not send
`status: published` through a writer token or attempt to edit a live record.

## Change a live article

1. `create_revision` with the original article identifier. This returns a separate
   private draft, preserving the live article and canonical slug.
2. Edit that revision with `update_article`. Upload new media with the revision
   identifier; the engine uses the original article's immutable media namespace.
3. `prepare_publication` with the revision identifier. Review its complete saved
   article and retain the returned digest.
4. `publish_revision` with that identifier and `expectedDigest`, using the agent connection or a publisher
   token. If the revision or live base changed, the engine returns a conflict.
5. Read back the canonical website URL, Markdown and media. The private revision
   remains available for history. Its publication cannot be replayed.

Preparing a draft does not publish it. Changed content requires a fresh digest.
A withdrawal/republication invalidates pending revisions against the old edition.
A conflict requires inspection and a fresh revision; never retry blindly.

`unpublish_article` explicitly withdraws HTML, Markdown, discovery and referenced
local media. Version restoration produces draft content, never implicit public
visibility. To roll back a live article, read `list_article_versions`, create a
private revision, copy the chosen historical Markdown into it, review and publish
that revision through the same workflow.

## Tools and limits

The portable SDK executes article/revision and attachment/chunked-upload MCP tools.
The reference engine also supplies legacy media, history, import/export and
scientific structural checks.
`tools/list` advertises the tools supported by that host and token.

JSON requests are limited to 1 MiB. Multipart media uploads are limited to 8 MiB;
base64 MCP uploads also have to fit inside the JSON limit. Text/Markdown/LaTeX
imports are bounded. Binary PDF/DOCX import and native Lean compilation require a
separate isolated worker and are disabled in this engine. A structural check is
not a machine-checked proof. Interactive embeds run in restricted browser frames.
Optional engine AI generation has an operator model allowlist, output/input
budgets, timeout and concurrency limit; an external AI client can write drafts
through MCP without configuring the engine's AI provider.

## Images, PDFs and supporting data

Use the same MCP connection for every step:

1. Compute the file SHA-256 in the harness. Call `begin_media_upload` with the draft
   `identifier`, simple `fileName`, MIME `contentType`, `sizeBytes`, and hex `sha256`.
2. Use its `uploadId` and `chunkBytes` to send `upload_media_chunk` in zero-based
   index order. Every chunk except the final chunk must have the returned size;
   send canonical base64. Retrying the same index and bytes is safe.
3. Call `complete_media_upload`. The engine verifies total length and checksum.
   Retrying completion returns the same asset while the staging receipt exists.
4. Call `attach_media` with the draft `identifier`, returned `asset.publicUrl` as
   `url`, human-readable `label`, and `description`. Optional `textContent` carries
   text extracted by the harness or a readable data excerpt. The engine never runs
   PDF/DOCX parsers. These fields become public with the article.
5. Inspect `list_attachments` and `prepare_publication`, then explicitly publish.

Upload completion alone does not attach or publish a file. `attach_media` validates
inventory and article ownership. A draft/revision can have up to 30 attachments and
256 KiB of combined attachment metadata/text, with up to 16,000 characters of
supporting text per attachment. For a long PDF, the harness should put the desired
full text in the article body, subject to the document request limit, or provide a
summary plus the original PDF. Never claim an attached PDF was automatically read.

Completed files remain private until their owning live article references them.
The HTML and single-file Markdown include attachment descriptions, download links,
images and supplied text/data. JSON-LD includes associated media. Removing an
attachment in a private revision does not change the live edition until publication.
`detach_media` removes the record, not its stored bytes. If the body also links the
same asset, remove that link to withdraw the file. The harness cannot delete assets;
operator cleanup requires deletion authority.

Files are bounded to 8 MiB, staged for 15 minutes, and bound to the uploading
credential. An engine allows 16 unfinished uploads / 64 MiB of reserved bytes,
plus a bounded completion-receipt cache. Restarting the engine or rotating the
credential requires restarting incomplete uploads. `abort_media_upload` frees an
unfinished slot. These are single-process sessions: route upload calls to one
engine instance until a shared staging adapter is installed. No client-supplied
filesystem paths, executable document parsers or unrestricted remote URLs are used
by this upload flow.

For a typed integration, use `client.uploadMedia`, `attachMedia`, `listAttachments`,
`detachMedia`, `createRevision`, `preparePublication`, and `publishRevision`.
`uploadMedia` computes the digest and sends the chunks; all of these methods use MCP.
Use `@publication-mcp-studio/platform/attachments` in a browser renderer to append
structured attachments to the readable article, as the reference website does.
