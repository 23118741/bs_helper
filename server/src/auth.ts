/**
 * server/src/auth.ts
 * Better Auth (self-hosted) with bearer session tokens. Users sign in with email + password; the account is
 * created once with an emailed sign-up code (which proves the address) plus the password.
 * Only the server-side API (`auth.api.*`) is used; the library's own HTTP routes are NOT exposed,
 * so our routes in app.ts are the only entry point and add limits and blocks.
 */

import { randomBytes } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { bearer, emailOTP } from 'better-auth/plugins';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Mailer } from './mailer.js';

function buildOptions(config: Config, db: Db, mailer: Mailer) {
  return {
    database: db,
    baseURL: config.publicUrl,
    secret: config.authSecret,
    // Password sign-in is only reachable through our own /v1/auth/login route. Accounts are created by
    // /v1/auth/signup (email code + password) or the admin CLI.
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: false, revokeSessionsOnPasswordReset: true },
    session: {
      // Sliding 30-day session: refreshed at most once a day while the extension is in use.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: false }, // rate limits are enforced in app.ts
    plugins: [
      bearer(),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }) {
          if (type === 'forget-password') await mailer.sendResetCode(email, otp);
          else await mailer.sendSignupCode(email, otp);
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

/**
 * Creates the auth instance. The library's tables (user, session, account, verification) are
 * migrated first, so it never logs a "schema mismatch" at start-up.
 */
export async function createAuth(config: Config, db: Db, mailer: Mailer) {
  const options = buildOptions(config, db, mailer);
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  return betterAuth(options);
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

/** The id of the user with this email address, if any. */
export function findUserId(db: Db, email: string): string | undefined {
  return (db.prepare('SELECT id FROM user WHERE email = ?').get(email.toLowerCase()) as { id: string } | undefined)?.id;
}

/** True when the user already has a password (a finished account). */
export function hasPassword(db: Db, userId: string): boolean {
  return (
    db.prepare("SELECT 1 FROM account WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL").get(userId) !==
    undefined
  );
}

/** Sets (or replaces) the password of an existing user. */
export async function setUserPassword(auth: Auth, db: Db, userId: string, password: string): Promise<void> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const now = new Date().toISOString();
  const r = db.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").run(hash, now, userId);
  if (r.changes === 0) {
    db.prepare(
      "INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)"
    ).run(randomBytes(16).toString('hex'), userId, userId, hash, now, now);
  }
}
