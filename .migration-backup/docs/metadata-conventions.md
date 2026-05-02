# Article Metadata Conventions

Publication MCP Studio stores two kinds of article classification data:

- First-class indexed fields: `category` and `tags`.
- Flexible JSON metadata: arbitrary host-specific fields in `metadata jsonb`.

Use first-class fields when you need filtering, indexes, or stable public navigation. Use metadata when the field is presentation-specific or host-specific.

## Reserved Metadata Keys

These keys are treated as conventional by the SDK, Studio UI, or examples:

| Key | Type | Meaning |
|---|---|---|
| `category` | `string` | Legacy/convenience category. Prefer the first-class `category` column for filtering. |
| `tags` | `string[]` | Legacy/convenience tags. Prefer the first-class `tags` column for filtering. |
| `excerpt` | `string` | Short card/list summary. |
| `imageUrl` | `string` | Public preview/hero image URL for host blog cards. |
| `date` | `string` | Host-facing publication date. |
| `title` | `string` | Frontmatter title for markdown imports. |
| `authors` | `string[]` | Scientific/publication authors. |
| `journal` | `string` | Journal or publication container. |
| `doi` | `string` | DOI or publication identifier. |
| `canonicalUrl` | `string` | SEO canonical URL. |

All other keys are pass-through.

## Recommended Write Pattern

```ts
await client.createArticle({
  title: 'Lean Checks for Publication Math',
  slug: 'lean-checks-publication-math',
  category: 'science',
  tags: ['lean', 'latex', 'verification'],
  metadata: {
    excerpt: 'A short overview of agent-assisted math verification.',
    imageUrl: 'https://cdn.example.com/lean-card.png',
  },
  contentMarkdown,
})
```

If an older integration only sends `metadata.category` or `metadata.tags`, the platform handler promotes those values into the first-class fields on create.
