import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadConfig } from './config';
import { VERSION, createApp, createContext } from './app';

const config = loadConfig();
const ctx = createContext(config);
const app = createApp(ctx);

if (config.webRoot) {
  app.use('/*', serveStatic({ root: config.webRoot }));
  // Client-side routes fall back to the app shell.
  app.get('/*', serveStatic({ root: config.webRoot, path: 'index.html' }));
}

if (config.worker) ctx.worker.start();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Perch Server ${VERSION} (${config.mode} mode) listening on http://${info.address}:${info.port}`,
  );
  console.log(`Database: ${config.databasePath} · signup: ${config.signup}`);
});

function shutdown() {
  ctx.worker.stop();
  server.close(() => {
    ctx.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
