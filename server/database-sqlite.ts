// SQLite driver for local development and tests. It wraps better-sqlite3's
// synchronous API in the async CivicDatabase surface; a mutex serializes
// transactions so concurrent async call sites can never interleave their
// statements inside an open transaction.
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

import Database from "better-sqlite3";

import type { CivicDatabase, CivicStatement } from "./database.js";

const SQLITE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('PUBLIC_SERVICE', 'LAW_ENFORCEMENT')),
      municipality_id TEXT REFERENCES municipalities(id) ON DELETE SET NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS municipalities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      boundary_geojson TEXT,
      center_latitude REAL,
      center_longitude REAL,
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
      latitude REAL,
      longitude REAL,
      accuracy_meters REAL,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      municipality_id TEXT,
      reporter_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
      moderation_status TEXT NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_status IN ('VISIBLE', 'HIDDEN', 'REMOVED')),
      reporter_confirmation TEXT CHECK (reporter_confirmation IN ('STILL_HAPPENING', 'FIXED', 'DONT_KNOW')),
      reporter_confirmed_at INTEGER,
      image_embedding BLOB,
      similar_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
      similarity_score REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS reports_reporter_idx
      ON reports(reporter_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS reports_organization_status_idx
      ON reports(organization_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS reports_assigned_user_idx
      ON reports(assigned_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS guest_report_access (
      report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS report_photos (
      id TEXT PRIMARY KEY,
      photo_data BLOB NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
      ON push_subscriptions(user_id);

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
    const reportTableColumns = database.pragma("table_info(reports)") as Array<{ name: string }>;
    if (!reportTableColumns.some((column) => column.name === "latitude")) {
      database.exec("ALTER TABLE reports ADD COLUMN latitude REAL");
    }
    if (!reportTableColumns.some((column) => column.name === "longitude")) {
      database.exec("ALTER TABLE reports ADD COLUMN longitude REAL");
    }
    if (!reportTableColumns.some((column) => column.name === "accuracy_meters")) {
      database.exec("ALTER TABLE reports ADD COLUMN accuracy_meters REAL");
    }
    if (!reportTableColumns.some((column) => column.name === "municipality_id")) {
      database.exec("ALTER TABLE reports ADD COLUMN municipality_id TEXT");
    }
    if (!reportTableColumns.some((column) => column.name === "reporter_confirmation")) {
      database.exec("ALTER TABLE reports ADD COLUMN reporter_confirmation TEXT CHECK (reporter_confirmation IN ('STILL_HAPPENING', 'FIXED', 'DONT_KNOW'))");
    }
    if (!reportTableColumns.some((column) => column.name === "reporter_confirmed_at")) {
      database.exec("ALTER TABLE reports ADD COLUMN reporter_confirmed_at INTEGER");
    }
    if (!reportTableColumns.some((column) => column.name === "image_embedding")) {
      database.exec("ALTER TABLE reports ADD COLUMN image_embedding BLOB");
    }
    if (!reportTableColumns.some((column) => column.name === "similar_report_id")) {
      database.exec("ALTER TABLE reports ADD COLUMN similar_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL");
    }
    if (!reportTableColumns.some((column) => column.name === "similarity_score")) {
      database.exec("ALTER TABLE reports ADD COLUMN similarity_score REAL");
    }

    // Add municipalities table if it doesn't exist
    const tableList = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='municipalities'").get() as { name: string } | undefined;
    if (!tableList) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS municipalities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          boundary_geojson TEXT,
          center_latitude REAL,
          center_longitude REAL,
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    }

    // Add municipality_id to organizations if it doesn't exist
    const orgColumns = database.pragma("table_info(organizations)") as Array<{ name: string }>;
    if (!orgColumns.some((column) => column.name === "municipality_id")) {
      database.exec("ALTER TABLE organizations ADD COLUMN municipality_id TEXT REFERENCES municipalities(id) ON DELETE SET NULL");
    }
    const reporterColumn = (database.pragma("table_info(reports)") as Array<{
      name: string;
      notnull: number;
    }>).find((column) => column.name === "reporter_user_id");
    if (reporterColumn?.notnull) {
      database.pragma("foreign_keys = OFF");
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE reports_guest_migration (
          id TEXT PRIMARY KEY,
          reference_code TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          location TEXT NOT NULL,
          latitude REAL,
          longitude REAL,
          accuracy_meters REAL,
          category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          reporter_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
          assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
          moderation_status TEXT NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_status IN ('VISIBLE', 'HIDDEN', 'REMOVED')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO reports_guest_migration
          (id, reference_code, title, description, location, latitude, longitude, accuracy_meters,
           category_id, organization_id, reporter_user_id, assigned_user_id,
           status, moderation_status, created_at, updated_at)
        SELECT id, reference_code, title, description, location, latitude, longitude, accuracy_meters,
               category_id, organization_id, reporter_user_id, assigned_user_id,
               status, moderation_status, created_at, updated_at
        FROM reports;
        DROP TABLE reports;
        ALTER TABLE reports_guest_migration RENAME TO reports;
        CREATE INDEX reports_reporter_idx ON reports(reporter_user_id, created_at DESC);
        CREATE INDEX reports_organization_status_idx ON reports(organization_id, status, created_at DESC);
        CREATE INDEX reports_assigned_user_idx ON reports(assigned_user_id, created_at DESC);
        COMMIT;
      `);
      database.pragma("foreign_keys = ON");
    }
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
