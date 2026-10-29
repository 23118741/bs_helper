import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { loadConfig, type Config } from '../src/config.js';
import { openDb, type Db } from '../src/db.js';
import { MemoryMailer } from '../src/mailer.js';
import { Pricing } from '../src/pricing.js';
import { FakeProvider } from '../src/providers/fake.js';
import type { Provider } from '../src/providers/types.js';

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  mailer: MemoryMailer;
  provider: Provider;
  config: Config;
  now: { value: number };
  /** Signs in with an email code. Approved by default (as the owner would do with email:allow). */
  signIn(email: string, opts?: { approved?: boolean }): Promise<{ token: string; id: string }>;
  generate(token: string, over?: Record<string, unknown>): Promise<any>;
}

/** Password of every account made with ctx.signIn. */
export const TEST_PASSWORD = 'test-password-1';

export async function createCtx(
  env: Record<string, string> = {},
  provider: Provider = new FakeProvider()
): Promise<TestCtx> {
  const config = loadConfig({ NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  const mailer = new MemoryMailer();
  const auth = await createAuth(config, db, mailer);
  const now = { value: Date.parse('2026-11-02T10:00:00Z') };
  const app = buildApp({ config, db, auth, mailer, provider, pricing: new Pricing(config), now: () => now.value });
  await app.ready();

  const ctx: TestCtx = {
    app,
    db,
    mailer,
    provider,
    config,
    now,
    async signIn(email, opts = {}) {
      if (opts.approved !== false) {
        db.prepare('INSERT OR IGNORE INTO allowed_emails (email, source, created_at) VALUES (?, ?, ?)').run(email.toLowerCase(), 'test', now.value);
      }
      const start = await app.inject({
        method: 'POST',
        url: '/v1/auth/signup/start',
        payload: { email },
      });
      if (start.statusCode !== 204) throw new Error(`start failed: ${start.statusCode} ${start.body}`);
      const code = mailer.lastCodeFor(email.toLowerCase())!;
      const verify = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email, code, password: TEST_PASSWORD } });
      if (verify.statusCode !== 200) throw new Error(`signup failed: ${verify.statusCode} ${verify.body}`);
      const body = verify.json();
      return { token: body.token, id: body.user.id };
    },
    generate(token, over = {}) {
      return app.inject({
        method: 'POST',
        url: '/v1/generate',
        headers: { authorization: `Bearer ${token}`, 'x-client-version': '1.0.0' },
        payload: {
          kind: 'chat',
          question: 'What is the deadline?',
          context_markdown: 'Deadline: 1 December.',
          client: { version: '1.0.0' },
          ...over,
        },
      });
    },
  };
  return ctx;
}
