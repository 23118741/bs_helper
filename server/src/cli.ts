/**
 * server/src/cli.ts
 * Admin commands (run on the server): approved emails, blocked institutions, users, usage.
 *   npm run admin -- email:allow student@example.nl   (approve: gets the daily budget; everyone else has 0)
 *   npm run admin -- email:revoke student@example.nl
 *   npm run admin -- email:list
 *   npm run admin -- host:block universiteitleiden.nl --reason "asked to block"
 *   npm run admin -- host:unblock universiteitleiden.nl
 *   npm run admin -- host:list
 *   npm run admin -- user:create --email you@example.nl   (asks for a password)
 *   npm run admin -- usage:today | usage:month | user:list
 */

import { createInterface } from 'node:readline';
import { createAuth, setUserPassword } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { dayKey, monthKey } from './period.js';
import { MemoryMailer } from './mailer.js';
import { microToEur } from './pricing.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Reads a password from the terminal without echoing it (or one line from a pipe). */
function promptPassword(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = out._writeToOutput.bind(rl);
    process.stdout.write(label);
    if (process.stdin.isTTY) out._writeToOutput = () => undefined;
    rl.question('', (answer) => {
      out._writeToOutput = original;
      if (process.stdin.isTTY) process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const now = Date.now();

  switch (cmd) {
    case 'email:allow': {
      const email = args[0]?.trim().toLowerCase();
      if (!email) throw new Error('usage: email:allow <email>');
      db.prepare('INSERT OR IGNORE INTO allowed_emails (email, source, created_at) VALUES (?, ?, ?)').run(email, 'admin', now);
      console.log(`Approved: ${email}`);
      break;
    }
    case 'email:revoke': {
      const email = args[0]?.trim().toLowerCase();
      if (!email) throw new Error('usage: email:revoke <email>');
      const r = db.prepare('DELETE FROM allowed_emails WHERE email = ?').run(email);
      console.log(r.changes ? `Revoked: ${email}` : `${email} was not approved`);
      break;
    }
    case 'email:list': {
      for (const r of db.prepare('SELECT email, source, created_at FROM allowed_emails ORDER BY created_at DESC').all() as any[]) {
        console.log(`${r.email}  ${r.source}  ${new Date(r.created_at).toISOString()}`);
      }
      break;
    }
    case 'host:block': {
      const pattern = args[0]?.trim().toLowerCase();
      if (!pattern) throw new Error('usage: host:block <hostname-suffix> [--reason text]');
      db.prepare('INSERT OR REPLACE INTO blocked_hosts (pattern, reason, created_at) VALUES (?, ?, ?)').run(
        pattern,
        flag(args, 'reason') ?? null,
        now
      );
      console.log(`Blocked: ${pattern} (matches the host and all subdomains, for email domains and Brightspace hosts)`);
      break;
    }
    case 'host:unblock': {
      const pattern = args[0]?.trim().toLowerCase();
      if (!pattern) throw new Error('usage: host:unblock <hostname-suffix>');
      db.prepare('DELETE FROM blocked_hosts WHERE pattern = ?').run(pattern);
      console.log(`Unblocked: ${pattern}`);
      break;
    }
    case 'host:list': {
      for (const r of db.prepare('SELECT * FROM blocked_hosts ORDER BY pattern').all() as any[]) {
        console.log(`${r.pattern}  ${r.reason ?? ''}`);
      }
      break;
    }
    case 'user:create':
    case 'user:set-password': {
      const email = (flag(args, 'email') ?? '').trim().toLowerCase();
      if (!email) throw new Error(`usage: ${cmd} --email <address>  (password is asked interactively)`);
      const password = await promptPassword('Password (min 8 characters): ');
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      // The mailer is never used here; auth only needs it to be constructed.
      const auth = await createAuth(config, db, new MemoryMailer());
      const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(email) as { id: string } | undefined;
      if (cmd === 'user:create' && !existing) {
        await auth.api.signUpEmail({ body: { email, password, name: email.split('@')[0] } });
        // accounts made by the admin are approved right away
        db.prepare('INSERT OR IGNORE INTO allowed_emails (email, source, created_at) VALUES (?, ?, ?)').run(email, 'cli', now);
        console.log(`Created ${email}`);
      } else if (existing) {
        await setUserPassword(auth, db, existing.id, password);
        console.log(`Password set for ${email}`);
      } else {
        throw new Error(`No such user: ${email} (use user:create)`);
      }
      break;
    }
    case 'user:list': {
      for (const r of db.prepare('SELECT id, email, createdAt FROM user ORDER BY createdAt DESC').all() as any[]) {
        console.log(`${r.email}  ${r.id}  created ${r.createdAt}`);
      }
      break;
    }
    case 'usage:today':
    case 'usage:month': {
      const col = cmd === 'usage:today' ? 'day' : 'month';
      const key = cmd === 'usage:today' ? dayKey(now, config.timeZone) : monthKey(now, config.timeZone);
      const rows = db
        .prepare(
          `SELECT user_id, COUNT(*) AS n, SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cost_micro_eur) AS c
           FROM usage_events WHERE ${col} = ? GROUP BY user_id ORDER BY c DESC`
        )
        .all(key) as any[];
      let total = 0;
      for (const r of rows) {
        total += r.c;
        console.log(`${r.user_id}  ${r.n} requests  in ${r.i}  out ${r.o}  EUR ${microToEur(r.c).toFixed(4)}`);
      }
      console.log(`TOTAL ${key}: EUR ${microToEur(total).toFixed(4)} (global daily cap EUR ${config.limits.globalDailyEur})`);
      break;
    }
    default:
      console.log(
        'Commands: ' +
          'email:allow <email> | email:revoke <email> | email:list | host:block <suffix> [--reason t] | host:unblock <suffix> | host:list | user:create --email e | user:set-password --email e | user:list | usage:today | usage:month'
      );
  }
  db.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
