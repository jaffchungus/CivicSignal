// Postgres driver for production (Vercel Functions against external
// Postgres such as Supabase or Neon). Queries are kept to the shared SQLite/Postgres
// subset; `?` placeholders are rewritten to numbered `$n` parameters here,
// and int8 columns are parsed back into JS numbers so COUNT(*) and stored
// millisecond timestamps behave exactly as they do on SQLite.
import { AsyncLocalStorage } from "node:async_hooks";

import { Pool, types, type PoolClient } from "pg";

import type { CivicDatabase, CivicStatement } from "./database.js";

const POSTGRES_SCHEMA = `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('PUBLIC_SERVICE', 'LAW_ENFORCEMENT')),
      active SMALLINT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
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
      verified_at BIGINT,
      verified_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      active SMALLINT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
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
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
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
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS report_events_report_idx
      ON report_events(report_id, created_at);

    CREATE TABLE IF NOT EXISTS report_updates (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
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
      created_at BIGINT NOT NULL
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
      read_at BIGINT,
      created_at BIGINT NOT NULL
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
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
      ON audit_events(created_at DESC);
  `;

/**
 * Rewrites `?` placeholders to numbered `$n` parameters. Question marks inside
 * string literals ('...') are left alone.
 */
export function toNumberedParameters(sql: string): string {
  let result = "";
  let index = 0;
  let inString = false;
  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position];
    if (character === "'") {
      if (inString && sql[position + 1] === "'") {
        result += "''";
        position += 1;
        continue;
      }
      inString = !inString;
      result += character;
      continue;
    }
    if (character === "?" && !inString) {
      index += 1;
      result += `$${index}`;
      continue;
    }
    result += character;
  }
  return result;
}

// These tables use CivicSignal sessions, not Supabase JWTs. Deny direct Data
// API access rather than adding policies that mistake anonymous SDK callers
// for authenticated CivicSignal users. The trusted Express server owns access.
const DATA_API_PROTECTION = `
  DO $civicsignal$
  DECLARE table_name text; role_name text;
  BEGIN
    FOREACH table_name IN ARRAY ARRAY[
      'settings', 'organizations', 'users', 'sessions', 'categories', 'reports',
      'report_events', 'report_updates', 'attachments', 'notifications', 'audit_events'
    ] LOOP
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
      FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
        END IF;
      END LOOP;
    END LOOP;
  END;
  $civicsignal$;
`;

export async function createPostgresDatabase(connectionString: string): Promise<CivicDatabase> {
  // No named prepared statements: compatible with Supabase transaction pooling.
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  // A transaction context belongs to this database, never another adapter instance.
  const inTransaction = new AsyncLocalStorage<PoolClient>();

  // int8 (COUNT(*), BIGINT timestamps) would otherwise arrive as strings.
  types.setTypeParser(20, (value) => Number(value));

  const initializationClient = await pool.connect().catch(async (error: unknown) => {
    await pool.end();
    throw error;
  });
  try {
    await initializationClient.query("BEGIN");
    // Concurrent cold starts must not race CREATE TABLE or schema hardening.
    await initializationClient.query("SELECT pg_advisory_xact_lock(1962042917)");
    await initializationClient.query(POSTGRES_SCHEMA);
    await initializationClient.query(DATA_API_PROTECTION);
    await initializationClient.query("COMMIT");
  } catch (error) {
    await initializationClient.query("ROLLBACK").catch(() => undefined);
    initializationClient.release();
    await pool.end();
    throw error;
  }
  initializationClient.release();

  const statement = (sql: string): CivicStatement => {
    const text = toNumberedParameters(sql);
    return {
      async get(...parameters) {
        const client = inTransaction.getStore() ?? pool;
        const result = await client.query(text, parameters as unknown[]);
        return result.rows[0];
      },
      async all(...parameters) {
        const client = inTransaction.getStore() ?? pool;
        const result = await client.query(text, parameters as unknown[]);
        return result.rows;
      },
      async run(...parameters) {
        const client = inTransaction.getStore() ?? pool;
        await client.query(text, parameters as unknown[]);
      },
    };
  };

  return {
    prepare: statement,
    async transaction<T>(fn: () => Promise<T>, onRollback?: () => Promise<void>): Promise<T> {
      if (inTransaction.getStore()) {
        return fn();
      }
      const client = await pool.connect();
      let commitAttempted = false;
      let discardClient = false;
      try {
        await client.query("BEGIN");
        const value = await inTransaction.run(client, fn);
        commitAttempted = true;
        await client.query("COMMIT");
        return value;
      } catch (error) {
        if (commitAttempted) {
          // ROLLBACK after a lost COMMIT reply cannot prove the write was undone.
          discardClient = true;
        } else {
          try {
            await client.query("ROLLBACK");
          } catch {
            discardClient = true;
          }
          if (!discardClient) {
            try {
              await onRollback?.();
            } catch {
              // Compensation cannot replace the original transaction error.
            }
          }
        }
        throw error;
      } finally {
        client.release(discardClient);
      }
    },
    async close() {
      await pool.end();
    },
  };
}
