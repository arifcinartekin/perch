import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { VERSION, createApp, createContext } from './app';
import { findWebRoot, serveWeb } from './web';

const config = loadConfig();
const ctx = createContext(config);
const app = createApp(ctx);

const webRoot = findWebRoot(config.webRoot);
if (webRoot) serveWeb(app, webRoot);

if (config.worker) ctx.worker.start();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Perch Server ${VERSION} (${config.mode} mode) listening on http://${info.address}:${info.port}`,
  );
  console.log(`Database: ${config.databasePath} · signup: ${config.signup}`);
  console.log(webRoot ? `Web reader: ${webRoot}` : 'Web reader: not built (npm run build:web)');
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
