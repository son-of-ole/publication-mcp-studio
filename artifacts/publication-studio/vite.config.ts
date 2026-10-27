import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createReaderMiddleware } from "./published-content.mjs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT || '5180';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [
    {
      name: "public-publication-pages",
      configureServer(server) {
        server.middlewares.use(createReaderMiddleware({ publishedOrigin: process.env.PUBLICATION_PUBLISHED_ORIGIN || "http://127.0.0.1:8081" }))
        server.middlewares.use(async (req, res, next) => {
          const pathname = new URL(req.url || '/', 'http://localhost').pathname
          if (!/^\/(?:publications(?:\/|$)|sitemap\.xml$|robots\.txt$)/.test(pathname)) return next()
          try {
            const { handlePublicRequest } = await server.ssrLoadModule('/src/entry-public.tsx')
            const response: Response | null = await handlePublicRequest(new Request(`http://localhost${req.url}`, { method: req.method }), {
              siteUrl: process.env.PUBLICATION_SITE_URL || `http://127.0.0.1:${port}`,
              publishedOrigin: process.env.PUBLICATION_PUBLISHED_ORIGIN || 'http://127.0.0.1:8081',
              headHtml: '<link rel="stylesheet" href="/src/index.css"><script type="module" src="/src/main.tsx"></script>',
            })
            if (!response) return next()
            let body = await response.text()
            if (response.headers.get('content-type')?.includes('text/html') && req.method !== 'HEAD') body = await server.transformIndexHtml(req.url || '/', body)
            res.statusCode = response.status
            response.headers.forEach((value, name) => res.setHeader(name, value))
            res.end(req.method === 'HEAD' ? undefined : body)
          } catch (error) { next(error) }
        })
      },
    },
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: process.env.REPL_ID ? "0.0.0.0" : "127.0.0.1",
    allowedHosts: process.env.PUBLICATION_SITE_URL ? [new URL(process.env.PUBLICATION_SITE_URL).hostname] : [],
    fs: {
      strict: true,
      deny: ['.env', '.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.publication*/**', '**/.migration-backup/**', '**/Final-Handoff*/**', '**/artifacts/api-server/**'],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: process.env.PUBLICATION_SITE_URL ? [new URL(process.env.PUBLICATION_SITE_URL).hostname] : [],
  },
});
