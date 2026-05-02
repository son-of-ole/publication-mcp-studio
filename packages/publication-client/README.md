# Publication Client Package

Install:

```bash
npm install @publication-mcp-studio/client
```

Use this package when another app wants to integrate with a deployed Publication MCP Studio service over REST and MCP.

Published npm package:

- https://www.npmjs.com/package/@publication-mcp-studio/client

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

- [docs/publication-integration-guide.md](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/publication-integration-guide.md)
- [docs/sdk-integration-feedback-v0.1.0.md](https://github.com/son-of-ole/publication-mcp-studio/blob/main/docs/sdk-integration-feedback-v0.1.0.md)
- [templates/hosted-client/README.md](https://github.com/son-of-ole/publication-mcp-studio/blob/main/templates/hosted-client/README.md)
