# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Project Purpose

This project is primarily an **SDK distributed via npm** — the `@publication-mcp-studio/platform` package — that other applications embed to add a generic publication system (blogs, stories, tutorials, scientific articles, etc.) plus MCP-endpoint capabilities. The Vite+React frontend (`artifacts/publication-studio`) and Express API (`artifacts/api-server`) here are a **reference / demo host** for the SDK — they exist to exercise and showcase the library, not to be the end product. Keep changes scoped accordingly: prefer adding capability to the SDK package, and treat the frontend/API as thin consumers.

### SDK location and publish workflow

- **Source of truth**: `packages/publication-platform/` (workspace package, currently v0.3.0; mirrors the GitHub layout).
- The api-server consumes it via `workspace:*`, so `src/*.ts` edits flow through esbuild at api-server restart — no SDK rebuild needed during development.
- Build / test: `pnpm --filter @publication-mcp-studio/platform build` (tsup → `dist/`) and `pnpm --filter @publication-mcp-studio/platform test` (25 unit tests).
- Publish to npm: bump `package.json#version` + `CHANGELOG.md`, then `cd packages/publication-platform && npm publish` (the `prepublishOnly` script re-runs build + tests). `publishConfig.exports` rewrites the public exports to `dist/*.js` so npm consumers get compiled JS while the workspace keeps using `src/`.
- See `packages/publication-platform/PUBLISHING.md` for the full step-by-step.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
