# Publishing the SDK

This package (`@publication-mcp-studio/platform`) lives inside the Replit pnpm workspace at `lib/publication-platform/`. It is the **source of truth** — edit it here, test it against the reference api-server / publication-studio in this Replit, then publish to npm and push to GitHub.

## Workflow

### 1. Edit and test locally

The api-server consumes the SDK via `workspace:*`, so edits to `src/*.ts` are picked up by esbuild on the next api-server restart — no rebuild needed.

```bash
# After editing lib/publication-platform/src/*
# Restart the api-server workflow, then:
node /tmp/e2e.mjs                   # run the api-server e2e suite
pnpm --filter @publication-mcp-studio/platform test   # run SDK unit tests
```

### 2. Bump the version + changelog

```bash
# Edit lib/publication-platform/package.json (bump "version")
# Edit lib/publication-platform/CHANGELOG.md (prepend release notes)
```

### 3. Build + verify

```bash
pnpm --filter @publication-mcp-studio/platform build      # tsup → dist/
pnpm --filter @publication-mcp-studio/platform test       # 25 unit tests
pnpm --filter @publication-mcp-studio/platform typecheck  # tsc --noEmit
```

`dist/` contains `*.js`, `*.d.ts`, and `*.js.map` for every entry point. `publishConfig.exports` in `package.json` rewrites the public exports to point at `dist/` (so npm consumers get compiled JS, while the workspace continues to consume `src/`).

### 4. Publish to npm

```bash
cd lib/publication-platform
npm login                # one-time, interactive
npm publish              # runs prepublishOnly → build + test
```

`prepublishOnly` re-runs `build && test`, so a stale `dist/` cannot ship.

### 5. Push to GitHub

The repo's `origin` is `https://github.com/son-of-ole/publication-mcp-studio`. The SDK lives at `packages/publication-platform/` on GitHub but at `lib/publication-platform/` here. If you want the GitHub layout to match, mirror the directory before pushing (or change the `directory` field in `package.json#repository`).

```bash
git add lib/publication-platform
git commit -m "publication-platform: vX.Y.Z"
git tag publication-platform@X.Y.Z
git push origin main --tags
```

## Files shipped to npm

Controlled by `"files"` in `package.json`:

- `dist/` — compiled JS + d.ts + sourcemaps
- `migrations/` — SQL migrations for the Neon adapter
- `README.md`, `CHANGELOG.md`

`src/`, `test/`, `tsconfig.json`, etc. are **not** included in the published tarball.
