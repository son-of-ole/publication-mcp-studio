# Publications API and MCP

The publication system now exposes a token-authenticated service layer so external agents can draft, update, and publish articles without touching the browser editor.

## Required Environment Variables

Add these to your deployment environment:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PUBLICATION_API_TOKEN=...
PUBLICATION_API_SECRET=...
PUBLICATION_API_SECRETS=...
OPENROUTER_API_KEY=...
PUBLICATION_AGENT_MODEL=openai/gpt-5-mini
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is required because the MCP/API layer writes directly to the `articles` table.
- `PUBLICATION_API_TOKEN` is an optional static bearer token.
- `PUBLICATION_API_SECRET` enables signed tokens that can be minted from the admin UI.
- `PUBLICATION_API_SECRETS` is optional and lets you keep previous signing secrets during token rotation.
- `OPENROUTER_API_KEY` is only required for AI drafting tools and routes.

## Scoped Tokens

Signed tokens now support scopes. Available scopes are:

- `mcp:connect`
- `articles:read`
- `articles:write`
- `articles:publish`
- `articles:delete`
- `agent:generate`
- `audit:read`

Recommended defaults for drafting agents:

- `mcp:connect`
- `articles:read`
- `articles:write`
- `articles:publish`
- `agent:generate`

Use `articles:delete` only for trusted maintenance clients.

## Always-On MCP

The MCP endpoint is always live once the site is deployed:

```text
https://your-domain.example/api/publications/mcp
```

External agents connect directly to that endpoint. The admin UI does not need to stay open.

The in-app access panel is just for:

- viewing the endpoint URL
- minting a signed token
- copying a ready-to-paste MCP config

## REST Endpoints

All publication service endpoints expect:

```http
Authorization: Bearer <PUBLICATION_API_TOKEN>
Content-Type: application/json
```

### List Articles

```http
GET /api/publications/articles?status=all&limit=25&search=alignment&includeContent=false
```

### Get One Article

```http
GET /api/publications/articles/<slug-or-uuid>
```

### Create Article

```http
POST /api/publications/articles
```

```json
{
  "title": "Reliability Under SICWA",
  "slug": "reliability-under-sicwa",
  "status": "draft",
  "metadata": {
    "publicationLabel": "Research Brief",
    "authors": ["Gordon Olson"],
    "authorProfiles": [
      "Gordon Olson | email=gordon@sonofol.org | social=https://linkedin.com/in/gordon-sonofol",
      "email=jane@example.com | orcid=0000-0000-0000-0000 | github=jane-lab"
    ],
    "tags": ["psychometrics", "llm"],
    "repositoryUrl": "https://github.com/owner/repo",
    "repositoryLabel": "GitHub Repository"
  },
  "body": "## Abstract\n\nDraft text here."
}
```

You can send either:

- `contentMarkdown` as a full raw markdown document, or
- `metadata` + `body` + optional `customFrontmatter`

For `authorProfiles`, the safest format is one string per author in the shape `Name | email=... | orcid=... | social=... | github=... | url=...`. If the `authorProfiles` array is in the same order as `authors`, the `Name |` prefix can be omitted and the system will pair profiles by position.

### Update Article

```http
PATCH /api/publications/articles/<slug-or-uuid>
```

```json
{
  "metadata": {
    "journal": "Publication MCP Studio Notes"
  },
  "body": "## Abstract\n\nUpdated body content."
}
```

### Publish Article

```http
POST /api/publications/articles/<slug-or-uuid>/publish
```

Publishing automatically sets `status` to `published` and adds a `published` frontmatter date if one is missing.

### Delete Article

```http
DELETE /api/publications/articles/<slug-or-uuid>
```

### Upload Media

```http
POST /api/publications/media
```

Use either `multipart/form-data` with a `file` field or JSON with `dataBase64` / `sourceUrl`. The response includes:

- storage path
- public URL
- ready-to-paste embed markdown for figures, videos, and downloads

Example JSON:

```json
{
  "articleSlug": "calibration-stability-study",
  "fileName": "stability-chart.png",
  "contentType": "image/png",
  "dataBase64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### List Media

```http
GET /api/publications/media?articleSlug=calibration-stability-study&limit=25
```

### Delete Media

```http
DELETE /api/publications/media
```

```json
{
  "path": "publications/calibration-stability-study/1776530000000-stability-chart.png"
}
```

### AI Drafting

```http
POST /api/publications/agent
```

```json
{
  "instruction": "Turn these notes into a polished publication draft with a figure block, a results table, and a references section.",
  "articleTitle": "Calibration Stability Study",
  "body": "Raw notes or seed markdown here.",
  "model": "openai/gpt-5-mini"
}
```

The AI route returns publication-ready markdown using the frontmatter and directive system already supported by the renderer.

## MCP Endpoint

Endpoint:

```text
/api/publications/mcp
```

Lightweight health check:

```text
/api/publications/mcp/health
```

Transport:

- HTTP POST JSON-RPC
- Token-authenticated with the same bearer token

### Example MCP Client Config

Use the MCP HTTP endpoint with an authorization header. A representative config looks like:

```json
{
  "mcpServers": {
    "publication-mcp-studio": {
      "type": "http",
      "url": "https://your-domain.example/api/publications/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_PUBLICATION_API_TOKEN"
      }
    }
  }
}
```

Exact client syntax varies by platform, but the key pieces are always:

- server URL: `https://<your-domain>/api/publications/mcp`
- header: `Authorization: Bearer <PUBLICATION_API_TOKEN>`

If `PUBLICATION_API_SECRET` is configured, you can mint signed expiring tokens from the admin articles page instead of managing a single long-lived static token by hand.

For persistent MCP plugins, prefer a 90-day or 365-day signed token. Short-lived tokens are best reserved for temporary external sessions.

### MCP Tools

The MCP server exposes these tools:

- `list_articles`
- `get_article`
- `create_article`
- `update_article`
- `publish_article`
- `delete_article`
- `generate_publication_draft`
- `list_media`
- `upload_media`
- `delete_media`
- `list_article_versions`
- `restore_article_version`

### MCP Resources

The MCP server also exposes two markdown resources:

- `publication://authoring-guide`
- `publication://supported-blocks`

These help external agents learn the publication syntax before writing drafts.

## Audit Logging

When the `publication_api_audit_log` table exists, the service records API and MCP activity including:

- action name
- token label
- token type
- scopes used
- route and method
- related article slug or id
- timestamp

Add this table to Supabase:

```sql
create table if not exists public.publication_api_audit_log (
  id uuid default gen_random_uuid() primary key,
  action text not null,
  actor_label text not null,
  actor_type text not null,
  scopes text[] not null default '{}',
  route text not null,
  method text not null,
  article_id uuid null references public.articles(id) on delete set null,
  article_slug text null,
  status text not null default 'success',
  metadata jsonb null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
```

The admin articles page includes an audit panel that reads from `/api/publications/audit`.

## Token Inventory and Revocation

Signed tokens are now stored in `publication_api_tokens`, which means:

- the admin dashboard can list issued tokens
- tokens can be revoked before they expire
- signed tokens update `last_used_at`, `last_used_route`, and `last_used_method`

Add this table to Supabase if you have not already applied `supabase_schema.sql`:

```sql
create table if not exists public.publication_api_tokens (
  id uuid default gen_random_uuid() primary key,
  label text not null,
  token_type text not null default 'signed',
  scopes text[] not null default '{}',
  issued_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone null,
  last_used_at timestamp with time zone null,
  last_used_route text null,
  last_used_method text null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
```

## Article Version History

Article writes now create immutable snapshots in `publication_article_versions`.

That gives you:

- automatic version capture on create, update, publish, delete, and restore
- admin-side version history inside the editor
- restore support from the admin UI
- MCP tools for listing and restoring versions

Add this table to Supabase:

```sql
create table if not exists public.publication_article_versions (
  id uuid default gen_random_uuid() primary key,
  article_id uuid not null references public.articles(id) on delete cascade,
  version_number integer not null,
  source_action text not null,
  title text not null,
  slug text not null,
  content_markdown text not null,
  status text not null check (status in ('draft', 'published')),
  actor_label text null,
  actor_type text null,
  metadata jsonb null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(article_id, version_number)
);
```

## Recommended External Agent Flow

1. Read `publication://authoring-guide`.
2. Call `generate_publication_draft` with the instruction and source notes.
3. Review the returned markdown.
4. Save it with `create_article` or `update_article`.
5. Call `publish_article` when ready.
