/**
 * server/src/index.ts
 * Production entry point: loads config, opens the database, migrates, starts the HTTP server.
 */

import { buildApp } from './app.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { MemoryMailer, SmtpMailer, type Mailer } from './mailer.js';
import { Pricing } from './pricing.js';
import { createProvider } from './providers/index.js';

async function main() {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const pricing = new Pricing(config);
  const provider = createProvider(config);
  const mailer: Mailer = config.smtpUrl
    ? new SmtpMailer(config.smtpUrl, config.mailFrom)
    : new MemoryMailer((m) => console.log(m));
  const auth = await createAuth(config, db, mailer);

  const app = buildApp({ config, db, auth, mailer, provider, pricing });
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { provider: provider.name, model: provider.model, env: config.env },
    'API ready'
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
