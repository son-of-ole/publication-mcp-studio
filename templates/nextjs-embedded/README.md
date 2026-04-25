# Next.js Embedded Template

Use this template when another Next.js app wants to embed the publication platform directly.

## Install

```bash
npm install @publication-mcp-studio/platform
```

## What To Copy

- `lib/publication-platform.ts`

That file shows the main pattern:

- import the platform package
- inject a host-owned `adminAuthStore`
- choose adapter config from env

## Important Boundary

The package is stack-agnostic on purpose.

That means the host app owns:

- admin session cookies
- auth provider wiring
- route handlers
- page/UI composition

The package owns:

- storage contracts
- adapters
- token/media/version/audit persistence seams

See [lib/publication-platform.ts](/Users/olson/Software/publication-mcp-studio/templates/nextjs-embedded/lib/publication-platform.ts).
