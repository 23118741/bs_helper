/**
 * server/src/db.ts
 * SQLite connection plus our own tables. The auth library creates its own tables
 * (user, session, account, verification) through its migrations.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

const MIGRATIONS: string[] = [
  // 1: invites, allow list, blocked institutions, usage ledger
  `
  CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    note TEXT,
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE allowed_emails (
    email TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE blocked_hosts (
    pattern TEXT PRIMARY KEY,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    month TEXT NOT NULL,
    request_id TEXT NOT NULL,
    kind TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_micro_eur INTEGER NOT NULL,
    status TEXT NOT NULL
  );
  CREATE INDEX idx_usage_user_day ON usage_events(user_id, day);
  CREATE INDEX idx_usage_user_month ON usage_events(user_id, month);
  CREATE INDEX idx_usage_day ON usage_events(day);
  `,
];

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

function runMigrations(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version)
  );
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
    })();
  });
}
