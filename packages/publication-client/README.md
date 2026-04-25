# Publication Client Package

Install:

```bash
npm install @publication-mcp-studio/client
```

Use this package when another app wants to integrate with a deployed Publication MCP Studio service over REST and MCP.

Example:

```ts
import { createPublicationClient } from '@publication-mcp-studio/client'

const publication = createPublicationClient({
  baseUrl: 'https://your-publication-service.example',
  token: process.env.PUBLICATION_API_TOKEN,
})

const articles = await publication.listArticles({ status: 'published', limit: 10 })
```

See:

- [docs/publication-integration-guide.md](/Users/olson/Software/publication-mcp-studio/docs/publication-integration-guide.md)
- [templates/hosted-client/README.md](/Users/olson/Software/publication-mcp-studio/templates/hosted-client/README.md)
