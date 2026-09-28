// SQLite driver for local development and tests. It wraps better-sqlite3's
// synchronous API in the async CivicDatabase surface; a mutex serializes
// transactions so concurrent async call sites can never interleave their
// statements inside an open transaction.
import { AsyncLocalStorage } from "node:async_hooks";

import Database from "better-sqlite3";

import type { CivicDatabase, CivicStatement } from "./database";

const SQLITE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('PUBLIC_SERVICE', 'LAW_ENFORCEMENT')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      normalized_email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('RESIDENT', 'OFFICIAL', 'LAW_ENFORCEMENT', 'ADMIN')),
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PENDING', 'SUSPENDED')),
      organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
      verified_at INTEGER,
      verified_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS categories_organization_id_idx
      ON categories(organization_id, active);

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reference_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
      moderation_status TEXT NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_status IN ('VISIBLE', 'HIDDEN', 'REMOVED')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS reports_reporter_idx
      ON reports(reporter_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS reports_organization_status_idx
      ON reports(organization_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS reports_assigned_user_idx
      ON reports(assigned_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS report_events (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      message TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS report_events_report_idx
      ON report_events(report_id, created_at);

    CREATE TABLE IF NOT EXISTS report_updates (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS report_updates_report_idx
      ON report_updates(report_id, created_at);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS attachments_report_idx
      ON attachments(report_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_id TEXT REFERENCES reports(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS notifications_user_idx
      ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
      ON audit_events(created_at DESC);
  `;

/** Marks the async context that owns an open transaction. */
const inTransaction = new AsyncLocalStorage<true>();

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export async function createSqliteDatabase(filename: string): Promise<CivicDatabase> {
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.exec(SQLITE_SCHEMA);

  const mutex = new Mutex();
  const execute = <T>(fn: () => T): Promise<T> =>
    inTransaction.getStore() ? Promise.resolve(fn()) : mutex.run(fn);

  const statement = (sql: string): CivicStatement => ({
    get: (...parameters) =>
      execute(() => database.prepare(sql).get(...(parameters as never[]))),
    all: (...parameters) =>
      execute(() => database.prepare(sql).all(...(parameters as never[]))),
    run: (...parameters) =>
      execute(() => {
        database.prepare(sql).run(...(parameters as never[]));
      }),
  });

  return {
    prepare: statement,
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (inTransaction.getStore()) {
        return fn();
      }
      return mutex.run(() =>
        inTransaction.run(true, async () => {
          database.exec("BEGIN");
          try {
            const value = await fn();
            database.exec("COMMIT");
            return value;
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
        }),
      );
    },
    close: () =>
      mutex.run(() => {
        database.close();
      }),
  };
}
