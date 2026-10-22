// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";

import { createSqliteDatabase } from "../server/database-sqlite";

afterEach(() => vi.restoreAllMocks());

it("upgrades the report owner column for secure guest reports", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "civicsignal-guest-migration-"));
  const filename = path.join(directory, "legacy.db");
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE reports (
      id TEXT PRIMARY KEY,
      reference_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      category_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      reporter_user_id TEXT NOT NULL,
      assigned_user_id TEXT,
      status TEXT NOT NULL,
      moderation_status TEXT NOT NULL DEFAULT 'VISIBLE',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  legacy.close();
  const database = await createSqliteDatabase(filename);
  try {
    const columns = await database.prepare("PRAGMA table_info(reports)").all() as Array<{ name: string; notnull: number }>;
    expect(columns.find((column) => column.name === "reporter_user_id")?.notnull).toBe(0);
    expect(await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'guest_report_access'").get())
      .toEqual({ name: "guest_report_access" });
    expect(await database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("yields while another adapter owns the write lock without replaying callbacks", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "civicsignal-locking-"));
  const filename = path.join(directory, "test.db");
  const first = await createSqliteDatabase(filename);
  const second = await createSqliteDatabase(filename);
  try {
    let acquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { acquired = resolve; });
    let timerRan = false;
    const firstCallback = vi.fn(async () => {
      await first.prepare("INSERT INTO settings (key, value) VALUES ('locking-test', '1')").run();
      acquired();
      await delay(30);
      timerRan = true;
    });
    const firstTransaction = first.transaction(firstCallback);
    await lockAcquired;
    const secondCallback = vi.fn(async () => {
      expect(timerRan).toBe(true);
      await second.prepare("UPDATE settings SET value = '2' WHERE key = 'locking-test'").run();
    });
    await Promise.all([firstTransaction, second.transaction(secondCallback)]);
    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).toHaveBeenCalledOnce();
    expect(await first.prepare("SELECT value FROM settings WHERE key = 'locking-test'").get())
      .toEqual({ value: "2" });
  } finally {
    await Promise.all([first.close(), second.close()]);
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);

it.each(["callback", "commit-before", "commit-after"] as const)(
  "only authorizes compensation for confirmed pre-commit rollback (%s failure)",
  async (phase) => {
    const database = await createSqliteDatabase(":memory:");
    const original = new Error("Original transaction failure");
    const exec = Database.prototype.exec;
    vi.spyOn(Database.prototype, "exec").mockImplementation(function (this: Database.Database, sql) {
      if (phase === "commit-before" && sql === "COMMIT") throw original;
      const result = exec.call(this, sql);
      if (phase === "commit-after" && sql === "COMMIT") throw original;
      return result;
    });
    const compensate = vi.fn(async () => undefined);
    try {
      await expect(database.transaction(async () => {
        await database.prepare("INSERT INTO settings (key, value) VALUES ('test', '1')").run();
        if (phase === "callback") throw original;
      }, compensate)).rejects.toBe(original);
      expect(compensate).toHaveBeenCalledTimes(phase === "callback" ? 1 : 0);
      if (phase === "commit-after") {
        expect(await database.prepare("SELECT value FROM settings WHERE key = 'test'").get())
          .toEqual({ value: "1" });
      }
    } finally {
      await database.close();
    }
  },
);

it.each(["before", "after", "close-failure"] as const)(
  "quarantines failed-rollback connections, including queued operations (%s)",
  async (phase) => {
    const database = await createSqliteDatabase(":memory:");
    const read = database.prepare("SELECT value FROM settings WHERE key = 'partial'");
    const original = new Error("Original write failure");
    const exec = Database.prototype.exec;
    const close = Database.prototype.close;
    const nativePrepare = vi.spyOn(Database.prototype, "prepare");
    vi.spyOn(Database.prototype, "exec").mockImplementation(function (this: Database.Database, sql) {
      if (sql === "ROLLBACK") {
        if (phase === "after") exec.call(this, sql);
        throw new Error("Rollback acknowledgement failure");
      }
      return exec.call(this, sql);
    });
    let failClose = phase === "close-failure";
    const nativeClose = vi.spyOn(Database.prototype, "close").mockImplementation(function (this: Database.Database) {
      if (failClose) {
        failClose = false;
        throw new Error("Close failure");
      }
      return close.call(this);
    });
    const compensate = vi.fn(async () => undefined);
    const nextCallback = vi.fn(async () => undefined);
    let inheritedOperations!: Promise<PromiseSettledResult<unknown>[]>;
    let acquired!: () => void;
    let fail!: () => void;
    const acquiredGate = new Promise<void>((resolve) => { acquired = resolve; });
    const failureGate = new Promise<void>((resolve) => { fail = resolve; });
    try {
      const transaction = database.transaction(async () => {
        await database.prepare("INSERT INTO settings (key, value) VALUES ('partial', '1')").run();
        // Detached work retains the transaction's AsyncLocalStorage context.
        inheritedOperations = transaction.catch(() => Promise.allSettled([
          read.get(), database.transaction(nextCallback, compensate),
        ]));
        acquired();
        await failureGate;
        throw original;
      }, compensate);
      await acquiredGate;
      // Queue operations while the connection still owns its transaction.
      const results = Promise.allSettled([
        transaction, read.get(), read.all(),
        database.prepare("UPDATE settings SET value = '2' WHERE key = 'partial'").run(),
        database.transaction(nextCallback, compensate),
      ]);
      fail();
      const [failed, ...queued] = await results;
      expect(failed).toEqual({ status: "rejected", reason: original });
      for (const result of [...queued, ...await inheritedOperations]) {
        expect(result).toMatchObject({ status: "rejected", reason: expect.any(Error) });
      }
      await expect(read.get()).rejects.toThrow();
      expect(nativePrepare).toHaveBeenCalledOnce();
      expect(nextCallback).not.toHaveBeenCalled();
      expect(compensate).not.toHaveBeenCalled();
      expect(nativeClose).toHaveBeenCalledOnce();
      await database.close();
      await database.close();
      expect(nativeClose).toHaveBeenCalledTimes(phase === "close-failure" ? 2 : 1);
    } finally {
      fail();
      vi.restoreAllMocks();
      await database.close();
    }
  },
);

it("preserves the original error if confirmed-rollback compensation fails", async () => {
  const database = await createSqliteDatabase(":memory:");
  const original = new Error("Original write failure");
  const compensate = vi.fn(async () => { throw new Error("Cleanup failure"); });
  try {
    await expect(database.transaction(async () => { throw original; }, compensate)).rejects.toBe(original);
    expect(compensate).toHaveBeenCalledOnce();
    expect(await database.transaction(async () => database.prepare("SELECT 1 AS value").get()))
      .toEqual({ value: 1 });
  } finally {
    await database.close();
  }
});
