# Publications Agent Workflows

This publication system is designed to be MCP-first.

That means the primary integration surface for agents is:

- MCP tools
- MCP resources
- MCP prompts
- JSON API routes that mirror the same operations

## Core Agent Loop

1. Read the article or document IR.
2. Run one or more verifiers.
3. Apply revisions to markdown.
4. Export into the target delivery format when needed.

## Canonical Source of Truth

The canonical source is markdown plus frontmatter.

Other formats are adapters:

- `docx`
- `pdf`
- `latex`
- JSON document IR

## Recommended MCP Workflows

### Journal Submission

- `get_document_ir`
- `run_publication_preset` with `journal_submission_pass`
- `update_article`
- `export_document` with `docx` or `pdf`

### SEO Pass

- `get_document_ir`
- `run_publication_preset` with `seo_pass`
- `update_article`

### Formal Math Pass

- `get_document_ir`
- `verify_document` with `math_sanity`
- `verify_document` with `lean`
- `update_article`

## Verifier Philosophy

Verifiers should be:

- agent-readable
- deterministic where possible
- safe to run repeatedly
- composable into presets

## Lean

Lean is treated as a verifier and proof artifact layer.

Use it for:

- theorem statements
- proof sketches
- machine-checkable formal blocks

Do not treat Lean as the source format for the entire paper.

## Lightweight Human UI

The browser editor is intentionally lightweight.

Heavy workflows should live in:

- MCP prompts
- verifiers
- import/export adapters
- machine-oriented presets
