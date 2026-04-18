# Publication MCP Studio

A standalone, markdown-first scientific publication system with:

- polished public article rendering
- admin editing workspace
- Supabase-backed article storage and media
- token-authenticated REST API
- always-on MCP server for external agents
- version history, audit logging, and token inventory

## What This Repo Contains

- `src/app/publications` for the public-facing publication library and article pages
- `src/app/admin` for the publication admin/editor UI
- `src/app/api/publications` for REST, MCP, token, media, audit, and agent routes
- `src/lib/publication-*` for the publication service layer
- `docs/publications-authoring.md` for markdown/frontmatter authoring
- `docs/publications-api-mcp.md` for the external API and MCP contract

## Environment

Copy `.env.example` to `.env.local` and fill in the required values.

Key variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLICATION_API_SECRET`
- `NEXT_PUBLIC_SITE_URL`

Optional:

- `PUBLICATION_API_TOKEN`
- `OPENROUTER_API_KEY`
- `PUBLICATION_AGENT_MODEL`

## Development

```bash
npm install
npm run dev
```

## Production

- apply `supabase_schema.sql` to your Supabase project
- configure Vercel environment variables
- deploy to Vercel

The MCP endpoint will be available at:

```text
https://your-domain.example/api/publications/mcp
```
