# Internal Codex MCP acceptance run

Verified 2026-10-22, America/Denver. All publication activity stayed on local
loopback. No production deployment, Git push, npm publication or external
distribution occurred.

## Connection

`pnpm engine:connect:codex` installed the `publication_engine` stdio server in the
trusted project's Git-ignored `.codex/config.toml`. Global Codex configuration was
preserved. The connection points at `scripts/mcp-harness.mjs`; the bridge uses the
private scoped agent credential and its existing local renewal mechanism. No
password or bearer token is written to the project MCP configuration.

The server appeared as actual callable tools in the active Codex harness. Draft
creation, editing, preparation, publication, revision creation/publication,
withdrawal and the final private read were performed through those tools. The
real Codex app-server MCP router also performed every chunked file upload and
attachment operation. Its verification sessions were ephemeral, without model
turns or persistent chats. Sixteen ordinary publishing tools were discovered;
deletion and credential-management tools were unavailable to the agent.

The configuration follows the official [Codex MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
The broken shell `codex` launcher was bypassed with the desktop app's working
bundled binary for router verification; no global executable was replaced.

## Publication and materials

The original article is **Apollo samples: why evidence needs more than a
photograph**, a substantive source-backed internal demonstration. It connects
visual evidence, the original technical source, and a reusable table transcription.
It does not claim to be a new scientific result or a NASA-authored article.

| Material | Bytes | Provenance |
| --- | ---: | --- |
| Photograph AS11-40-5948 | 1,096,254 | NASA / Neil Armstrong, NASA Scientific Visualization Studio |
| Photograph AS11-40-5949 | 1,245,346 | NASA / Neil Armstrong, NASA Scientific Visualization Studio |
| Original technical PDF | 1,895,431 | J. H. Allton (2009), NTRS document 20090011852; nine valid pages, no PDF JavaScript |
| Original dataset CSV | 114 | Five rows manually transcribed from page 1, Table 1 |
| Revised dataset CSV | 540 | Same five observations with table/page/source URL on every row |

The [NASA photograph source](https://svs.gsfc.nasa.gov/4185/) supplies the two
original JPEGs. The [original NASA technical PDF](https://ntrs.nasa.gov/api/citations/20090011852/downloads/20090011852.pdf)
is attached unchanged. The table was checked visually against the rendered PDF.
Dataset percentages were preserved as printed, including totals of 101; the
revision explains this and adds per-row provenance. PDF extraction happened in
the local verification environment, never inside the publishing engine.

## Verified lifecycle

| Stage | Observed result |
| --- | --- |
| Draft | HTML, Markdown, raw, public JSON and published feed returned 404, including HEAD and valid agent credentials. The response matched an unknown article. Directory/sitemap excluded it. |
| Upload and attach | Both photographs, PDF and CSV remained inaccessible on both the website and feed before publication. |
| Publish | Canonical article HTML, Markdown, structured metadata and sitemap appeared without rebuilding. Download SHA-256 matched the original bytes for every file. |
| Browser without JavaScript | Readable article, six table rows including header, both 2349-pixel photographs, PDF link/description and CSV data were present. Hero and attachment images loaded. No browser errors were recorded. |
| Private revision | Live Markdown remained byte-for-byte unchanged. The replacement CSV and revision URL stayed private; the first CSV remained accessible. |
| Conflict checks | A digest reviewed before a subsequent edit was rejected. Direct editing of the live article was rejected. |
| Publish revision | Original ID, slug and canonical URL remained stable. New prose/provenance appeared. Replacement CSV became public and the superseded CSV returned 404. |
| Withdraw | HTML, Markdown, raw, JSON, directory/sitemap and all five uploaded URLs became inaccessible, including HEAD and requests carrying valid agent credentials. |
| Replay | Republishing the already-used revision after withdrawal was rejected. |
| Retention | Article and its four current attachments remain available privately through MCP. The revision and original files remain for review/history. The pre-existing user article is unchanged. |

The fixture records **29 aggregate acceptance checks**, with underlying URL,
header, checksum and lifecycle assertions. The article ID is
`3b6178e7-8fbe-4ec6-8657-004a0284e1dc`; its slug is
`apollo-samples-evidence-internal-2026-10-22`. Its final status is `draft`.

## Defect found and corrected

The stdio bridge discarded structured JSON-RPC conflict errors carried by HTTP
409, and the reference MCP error handler lost the request ID. The harness then
reported a generic connection problem for a valid stale-review conflict.

The bridge now forwards bounded, correlated JSON-RPC errors on non-2xx responses.
The reference handler preserves the request ID and returns a stable code/status
without internal error details. Mismatched response IDs still fail closed.
Fresh Codex MCP connections returned actionable stale-review/live-edit/replay
messages. Long-running MCP server processes should be restarted after SDK
transport upgrades, as with other Node module updates.

## Regression and evidence

Full build/type checks and **90 automated tests** passed: platform 49, client 1,
engine 25, production website 15. Regression checks cover correlated forbidden
responses and stdio conflict forwarding, including rejection of wrong IDs.
The clean tarball consumer/TypeScript/CLI verification also passed after the fix.

Evidence is retained under the Git-ignored `output/internal-publication/` folder:

- `state.json`: check receipts, source hashes and private fixture identifiers.
- `sources.json` and `assets/`: original source files, dataset and provenance.
- `published.md`, `revised.md`: single-file public editions captured while live.
- `published.html`, `revised.html`: initial HTML responses captured while live.
- `published-no-js.png`, `revised-no-js.png`, `revised-cover.png`,
  `withdrawn-no-js.png`: browser verification.
- `final-private-article.json`: saved final draft read back through MCP.
- Build, regression and SDK consumer logs.

The public URLs now return 404 by design. Inspect the saved screenshots/Markdown
or use the connected MCP tools to read the retained draft. The original
`/publications/local-stabilization-verification` page remains available.
