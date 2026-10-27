# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Project Purpose

This project is primarily an **SDK distributed via npm** — the `@publication-mcp-studio/platform` package — that other applications embed to add a generic publication system (blogs, stories, tutorials, scientific articles, etc.) plus MCP-endpoint capabilities. The Vite+React frontend (`artifacts/publication-studio`) and Express API (`artifacts/api-server`) here are **separate reference hosts** for the SDK — they exist to exercise and showcase the library, not to be the end product. Keep changes scoped accordingly: prefer adding capability to the SDK package, and treat the frontend/API as thin consumers.

### SDK location and publish workflow

- **Source of truth**: `packages/publication-platform/` and `packages/publication-client/` (currently v0.3.2).
- The api-server consumes the platform via `workspace:*` and the package's compiled `dist/` exports. Run `pnpm build:sdk` after SDK changes; restart the API if needed. `pnpm dev` builds SDKs before starting the local host.
- Build / test: `pnpm build` and `pnpm test` cover the workspace and isolated host flow. Host session/HTTP tests live under `artifacts/api-server/test/`; reader isolation and MCP-to-website tests live under `artifacts/publication-studio/test/`.
- Publish to npm: bump `package.json#version` + `CHANGELOG.md`, then use `packages/publication-platform/PUBLISHING.md`. Public exports permanently target `dist/*.js`; `prepublishOnly` runs build, tests and the export verification script. Publishing is a separate action from local stabilization.
- See `packages/publication-platform/PUBLISHING.md` for the full step-by-step.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Public website**: Vite development SSR and a Node/Express production website server. Public articles and Markdown are status-gated on every request; set `PUBLICATION_SITE_URL` to the canonical public origin. Do not restore the old static wildcard rewrite.
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild engine ESM bundle, Vite browser and SSR bundles

## Key Commands

See the root `README.md` for the separate MCP engine, published-only feed and read-only website. The website must never receive engine credentials or proxy `/api`. Only the reader website is registered on the shared public Replit host; deploy the engine on its own secured origin. `pnpm dev` runs all services locally with isolated filesystem data.

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
