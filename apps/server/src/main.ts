import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { VERSION, createApp, createContext } from './app';
import { findRelayPage, findWebRoot, serveRelayPage, serveWeb } from './web';

const config = loadConfig();
const ctx = createContext(config);
const app = createApp(ctx);

// A relay shows only the page saying what it is; anything else serves the web app.
const relayPage = config.mode === 'relay' ? findRelayPage(config.relayPage) : undefined;
const webRoot = config.mode === 'relay' ? undefined : findWebRoot(config.webRoot);
if (relayPage) serveRelayPage(app, relayPage);
if (webRoot) serveWeb(app, webRoot);

if (config.worker) ctx.worker.start();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `Perch Server ${VERSION} (${config.mode} mode) listening on http://${info.address}:${info.port}`,
  );
  console.log(`Database: ${config.databasePath} · signup: ${config.signup}`);
  if (config.mode === 'relay') console.log(`Relay page: ${relayPage ?? 'not found'}`);
  else
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
