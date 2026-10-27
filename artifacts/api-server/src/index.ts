import app from "./app";
import { logger } from "./lib/logger";
import { createPublishedApp } from './published-app.js';
import { validateProductionEngine } from './security.js';
import { acquireLocalEngineLock } from './local-lock.js';
import { getPublicationPlatform } from './publication-lib/publication-platform.js';
validateProductionEngine(process.env);
if (process.env.NODE_ENV === 'production' && !process.env.PUBLICATION_ADMIN_ORIGIN) process.env.PUBLICATION_ADMIN_ORIGIN = process.env.PUBLICATION_ENGINE_ORIGIN;

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// The engine is private by default, including in production. Expose only through
// a separately secured engine origin when remote MCP access is required.
const host = process.env.HOST || "127.0.0.1";
const feedPort = Number(process.env.PUBLICATION_FEED_PORT || 8081);
if (!Number.isInteger(feedPort) || feedPort < 1 || feedPort > 65535 || feedPort === port) throw new Error('Invalid PUBLICATION_FEED_PORT');
const releaseLock = getPublicationPlatform().kind === 'local' ? await acquireLocalEngineLock(process.env.PUBLICATION_LOCAL_ROOT_DIR || process.cwd()) : async () => {};
const feedServer = createPublishedApp().listen(feedPort, process.env.PUBLICATION_FEED_HOST || '127.0.0.1', () => {
  logger.info({ port: feedPort }, 'Read-only published feed listening');
});

const engineServer = app.listen(port, host, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

for (const server of [engineServer, feedServer]) {
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.on('error', async error => { logger.error({ error }, 'Listener failed'); await releaseLock(); process.exit(1) })
}
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => process.exit(1), 10_000).unref()
  Promise.all([engineServer, feedServer].map(server => new Promise<void>(resolve => server.close(() => resolve())))).then(async () => { await releaseLock(); clearTimeout(deadline); process.exit(0) })
})
