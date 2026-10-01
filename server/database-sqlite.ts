// SQLite driver for local development and tests. It wraps better-sqlite3's
// synchronous API in the async CivicDatabase surface; a mutex serializes
// transactions so concurrent async call sites can never interleave their
// statements inside an open transaction.
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

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

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Wait for other connections without blocking the event loop they need to commit. */
async function retryBusy<T>(operation: () => T): Promise<T> {
  const deadline = performance.now() + 5_000;
  for (;;) {
    try {
      return operation();
    } catch (error) {
      if (!(error instanceof Database.SqliteError) || error.code !== "SQLITE_BUSY" || performance.now() >= deadline) {
        throw error;
      }
      await delay(10);
    }
  }
}

export async function createSqliteDatabase(filename: string): Promise<CivicDatabase> {
  // All lock waits are async; better-sqlite3's default busy timeout blocks JS.
  const database = new Database(filename, { timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    await retryBusy(() => database.pragma("journal_mode = WAL"));
    await retryBusy(() => database.exec(SQLITE_SCHEMA));
  } catch (error) {
    database.close();
    throw error;
  }

  // Transaction ownership belongs to this connection, not another adapter.
  const inTransaction = new AsyncLocalStorage<true>();
  const mutex = new Mutex();
  let unusable = false;
  const assertUsable = () => {
    if (unusable || !database.open) throw new Error("SQLite database connection is unavailable.");
  };
  const closeConnection = () => {
    if (database.open) database.close();
  };
  const execute = async <T>(fn: () => T): Promise<T> => {
    const operation = () => {
      assertUsable();
      return fn();
    };
    // Check at execution time so queued operations cannot use a quarantined connection.
    // An acquired write transaction does not retry statements or its callback.
    return inTransaction.getStore() ? operation() : mutex.run(() => retryBusy(operation));
  };

  return {
    prepare: (sql: string): CivicStatement => ({
      get: (...parameters) =>
        execute(() => database.prepare(sql).get(...(parameters as never[]))),
      all: (...parameters) =>
        execute(() => database.prepare(sql).all(...(parameters as never[]))),
      run: (...parameters) =>
        execute(() => {
          database.prepare(sql).run(...(parameters as never[]));
        }),
    }),
    async transaction<T>(fn: () => Promise<T>, onRollback?: () => Promise<void>): Promise<T> {
      if (inTransaction.getStore()) {
        assertUsable();
        return fn();
      }
      return mutex.run(() =>
        inTransaction.run(true, async () => {
          assertUsable();
          // Acquire the write lock before reading allocation state, including
          // when another process has opened the same database file.
          await retryBusy(() => database.exec("BEGIN IMMEDIATE"));
          let commitAttempted = false;
          try {
            const value = await fn();
            commitAttempted = true;
            database.exec("COMMIT");
            return value;
          } catch (error) {
            if (database.inTransaction) {
              try {
                database.exec("ROLLBACK");
              } catch {
                // Quarantine before closing: even failed disposal must never allow reuse.
                unusable = true;
                try {
                  closeConnection();
                } catch {
                  // Explicit close() can retry disposal; preserve the original error.
                }
                throw error;
              }
              try {
                if (!commitAttempted) await onRollback?.();
              } catch {
                // Compensation cannot replace the original transaction error.
              }
            }
            throw error;
          }
        }),
      );
    },
    close: () => mutex.run(closeConnection),
  };
}
