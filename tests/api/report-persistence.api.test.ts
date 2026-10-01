// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { Pool } from "pg";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../server/app";
import type { CivicDatabase } from "../../server/database";
import { createSqliteDatabase } from "../../server/database-sqlite";
import { createPostgresDatabase } from "../../server/database-postgres";
import { ApiError } from "../../server/http";
import { DiskPhotoStore } from "../../server/photo-store";
import { setupAdministrator } from "./helpers";

const closers: Array<() => Promise<void>> = [];
const directories: string[] = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) await close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function scenario(
  adapter: "sqlite" | "postgres",
  failure?: { table: string; enabled: boolean },
  secondSqliteAdapter = false,
  outcome?: { kind: "committed" | "uncertain"; enabled: boolean },
) {
  const directory = await mkdtemp(path.join(tmpdir(), "civicsignal-persistence-"));
  directories.push(directory);
  let database: CivicDatabase;
  let secondDatabase: CivicDatabase | undefined;
  if (adapter === "postgres") {
    // Explicit opt-in: use a disposable test server, never production credentials.
    const connection = process.env.TEST_POSTGRES_URL!;
    const schema = `civicsignal_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: connection });
    const databases: CivicDatabase[] = [];
    closers.push(async () => {
      await Promise.all(databases.map((database) => database.close()));
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(connection);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    database = await createPostgresDatabase(scoped.toString());
    databases.push(database);
    secondDatabase = await createPostgresDatabase(scoped.toString());
    databases.push(secondDatabase);
  } else {
    const filename = path.join(directory, "test.db");
    database = await createSqliteDatabase(filename);
    closers.push(() => database.close());
    if (secondSqliteAdapter) {
      secondDatabase = await createSqliteDatabase(filename);
      closers.push(() => secondDatabase!.close());
    }
  }
  const wrap = (database: CivicDatabase): CivicDatabase => ({
    ...database,
    async transaction(fn, onRollback) {
      if (!outcome?.enabled) return database.transaction(fn, onRollback);
      if (outcome.kind === "committed") {
        await database.transaction(fn, onRollback);
      }
      // A rejected wrapper can represent a committed write or an unclassified
      // outcome. Neither is a confirmed rollback from the owning adapter.
      throw new ApiError(503, "PERSISTENCE_UNAVAILABLE", "Report persistence is unavailable.");
    },
    prepare(sql) {
      const statement = database.prepare(sql);
      if (!failure || !sql.trimStart().startsWith(`INSERT INTO ${failure.table}\n`)) return statement;
      return {
        ...statement,
        async run(...parameters) {
          if (failure.enabled) throw new ApiError(503, "PERSISTENCE_UNAVAILABLE", "Report persistence is unavailable.");
          await statement.run(...parameters);
        },
      };
    },
  });
  const uploadDirectory = path.join(directory, "uploads");
  const photos = new DiskPhotoStore(uploadDirectory);
  const runtime = createApp({ database: wrap(database), photos, secureCookies: false });
  const secondApp = secondDatabase
    ? createApp({ database: wrap(secondDatabase), photos, secureCookies: false }).app
    : runtime.app;
  await setupAdministrator(runtime.app);
  const owner = request.agent(runtime.app);
  const registration = await owner.post("/api/auth/register").send({
    displayName: "Report Owner", email: "owner@example.test", password: "a resident account password",
  }).expect(201);
  const { body: { categories } } = await owner.get("/api/categories").expect(200);
  const submit = (title: string, otherConnection = false) =>
    (otherConnection
      ? request(secondApp).post("/api/reports").set("Cookie", registration.headers["set-cookie"])
      : owner.post("/api/reports"))
    .field("categoryId", categories[0].id)
    .field("title", title)
    .field("description", "The curb ramp has broken concrete and needs repair.")
    .field("location", "Main Street library entrance")
    .attach("photo", PNG, { filename: "curb.png", contentType: "image/png" });
  return { app: runtime.app, secondApp, cookie: registration.headers["set-cookie"], database, photos, uploadDirectory, owner, submit };
}

it("rejects reads and submissions after failed SQLite rollback while a safe connection remains usable", async () => {
  const failure = { table: "attachments", enabled: false };
  const { secondApp, cookie, database, photos, uploadDirectory, owner, submit } = await scenario("sqlite", failure, true);
  const existing = await submit("Earlier committed report").expect(201);
  const save = vi.spyOn(photos, "save");
  const remove = vi.spyOn(photos, "remove");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let failedReportId!: string;
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (!sql.trimStart().startsWith("INSERT INTO reports\n")) return statement;
    return { ...statement, async run(...parameters) {
      await statement.run(...parameters);
      failedReportId = parameters[0] as string;
    } };
  });
  const exec = Database.prototype.exec;
  vi.spyOn(Database.prototype, "exec").mockImplementation(function (this: Database.Database, sql) {
    if (sql === "ROLLBACK") throw new Error("Private rollback failure");
    return exec.call(this, sql);
  });
  failure.enabled = true;
  const rejected = await submit("Partial report with a failed rollback").expect(503);
  expect(rejected.body).toEqual({ error: {
    code: "PERSISTENCE_UNAVAILABLE", message: "Report persistence is unavailable.",
  } });
  expect(failedReportId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  const retainedFiles = await readdir(uploadDirectory);
  expect(retainedFiles).toHaveLength(2);

  failure.enabled = false;
  for (const response of [
    await owner.get("/api/reports?scope=mine"),
    await owner.get(`/api/reports/${failedReportId}`),
    await submit("Submission on the unsafe connection"),
  ]) {
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: {
      code: "INTERNAL_ERROR", message: "An unexpected error occurred.",
    } });
  }
  expect(save).toHaveBeenCalledOnce();
  expect(await readdir(uploadDirectory)).toEqual(retainedFiles);

  const list = await request(secondApp).get("/api/reports?scope=mine").set("Cookie", cookie).expect(200);
  expect(list.body.total).toBe(1);
  expect(list.body.reports[0].id).toBe(existing.body.id);
  await request(secondApp).get(`/api/reports/${failedReportId}`).set("Cookie", cookie).expect(404);
  const recovered = await submit("Submission on a safe connection", true).expect(201);
  expect(recovered.body.referenceCode).toBe(`CS-${new Date().getFullYear()}-0002`);
  expect((await request(secondApp).get("/api/reports?scope=mine").set("Cookie", cookie).expect(200)).body.total).toBe(2);
  for (const report of [existing.body, recovered.body]) {
    const served = await request(secondApp).get(report.attachments[0].url).expect(200);
    expect(Buffer.compare(served.body, PNG)).toBe(0);
  }
  expect(remove).not.toHaveBeenCalled();
  expect(await readdir(uploadDirectory)).toHaveLength(3);

  await database.close();
  const reopened = await createSqliteDatabase(path.join(uploadDirectory, "..", "test.db"));
  try {
    expect(await reopened.prepare("SELECT id FROM reports WHERE id = ?").get(failedReportId)).toBeUndefined();
    for (const table of ["reports", "attachments", "report_events"]) {
      expect(await reopened.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 2 });
    }
  } finally {
    await reopened.close();
  }
}, 15_000);

describe.each(["sqlite", "postgres"] as const)("report persistence (%s)", (adapter) => {
  const test = it.skipIf(adapter === "postgres" && !process.env.TEST_POSTGRES_URL);
  test.each(adapter === "sqlite" ? [false, true] : [true])(
    "commits overlapping photo submissions with distinct references and intact attachments (two adapters: %s)",
    async (twoAdapters) => {
    const { app, database, photos, uploadDirectory, owner, submit } = await scenario(adapter, undefined, twoAdapters);
    const remove = vi.spyOn(photos, "remove");
    const save = photos.save.bind(photos);
    let arrived = 0;
    let release!: () => void;
    const bothUploaded = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(photos, "save").mockImplementation(async (buffer, filename) => {
      const stored = await save(buffer, filename);
      if (++arrived === 2) release();
      await bothUploaded;
      return stored;
    });

    const results = await Promise.all([submit("Overlapping report A"), submit("Overlapping report B", true)]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const prefix = `CS-${new Date().getFullYear()}-`;
    expect(results.map((result) => result.body.referenceCode).sort()).toEqual([`${prefix}0001`, `${prefix}0002`]);
    expect(new Set(results.map((result) => result.body.id)).size).toBe(2);
    const files = await readdir(uploadDirectory);
    expect(files).toHaveLength(2);
    for (const result of results) {
      expect(result.body.attachments).toHaveLength(1);
      const detail = await owner.get(`/api/reports/${result.body.id}`).expect(200);
      expect(detail.body.attachments).toEqual(result.body.attachments);
      expect(detail.body.timeline).toHaveLength(1);
      const served = await request(app).get(result.body.attachments[0].url).expect(200);
      expect(Buffer.compare(served.body, PNG)).toBe(0);
    }
    expect((await owner.get("/api/reports?scope=mine").expect(200)).body.total).toBe(2);
    // Repeat with an already-initialized counter, not just its first insertion.
    const more = await Promise.all([submit("Overlapping report C"), submit("Overlapping report D", true)]);
    expect(more.map((result) => result.status)).toEqual([201, 201]);
    expect(more.map((result) => result.body.referenceCode).sort()).toEqual([`${prefix}0003`, `${prefix}0004`]);
    const finalList = await owner.get("/api/reports?scope=mine").expect(200);
    expect(finalList.body.total).toBe(4);
    const attachments = await database.prepare("SELECT stored_name FROM attachments").all() as Array<{ stored_name: string }>;
    expect(attachments).toHaveLength(4);
    expect((await readdir(uploadDirectory)).sort()).toEqual(attachments.map((photo) => photo.stored_name).sort());
    expect(remove).not.toHaveBeenCalled();
  }, 15_000);

  test.each(["reports", "attachments"])("removes the uploaded photo and rolls back when inserting %s fails", async (table) => {
    const failure = { table, enabled: true };
    const { database, photos, uploadDirectory, owner, submit } = await scenario(adapter, failure);
    const save = vi.spyOn(photos, "save");
    const rejected = await submit("Report that fails to persist");
    expect(rejected.status).toBe(503);
    expect(rejected.body.error.code).toBe("PERSISTENCE_UNAVAILABLE");
    expect(save).toHaveBeenCalledOnce();
    expect(await readdir(uploadDirectory)).toEqual([]);
    for (const tableName of ["reports", "attachments", "report_events", "notifications"]) {
      expect(await database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()).toEqual({ count: 0 });
    }
    expect(JSON.stringify(rejected.body)).not.toContain("stored_name");

    failure.enabled = false;
    const retry = await submit("Report that persists on retry");
    expect(retry.status).toBe(201);
    expect(retry.body.referenceCode).toBe(`CS-${new Date().getFullYear()}-0001`);
    expect((await owner.get("/api/reports?scope=mine").expect(200)).body.total).toBe(1);
    expect(await readdir(uploadDirectory)).toHaveLength(1);
  }, 15_000);

  test("cleans up only the failed submission's photo, retaining earlier committed photos", async () => {
    const failure = { table: "attachments", enabled: false };
    const { photos, uploadDirectory, owner, submit } = await scenario(adapter, failure);
    const existing = await submit("Earlier committed report").expect(201);
    const existingFiles = await readdir(uploadDirectory);
    const remove = vi.spyOn(photos, "remove");
    failure.enabled = true;
    await submit("Later report that rolls back").expect(503);
    expect(remove).toHaveBeenCalledOnce();
    expect(await readdir(uploadDirectory)).toEqual(existingFiles);
    const detail = await owner.get(`/api/reports/${existing.body.id}`).expect(200);
    expect(detail.body.attachments).toEqual(existing.body.attachments);
    expect((await owner.get("/api/reports?scope=mine").expect(200)).body.total).toBe(1);
  }, 15_000);

  test("preserves the persistence error and logs a safe warning if storage cleanup is unavailable", async () => {
    const failure = { table: "reports", enabled: true };
    const { photos, submit } = await scenario(adapter, failure);
    const remove = vi.spyOn(photos, "remove").mockRejectedValue(new Error("private storage details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejected = await submit("Report with a storage cleanup outage");
    expect(rejected.status).toBe(503);
    expect(rejected.body.error.code).toBe("PERSISTENCE_UNAVAILABLE");
    expect(remove).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledExactlyOnceWith("Photo cleanup failed after report persistence rolled back.");
    expect(JSON.stringify(rejected.body)).not.toContain("private storage details");
  }, 15_000);

  test.each(["committed", "uncertain"] as const)(
    "does not delete the uploaded photo after a %s transaction rejection",
    async (kind) => {
      const outcome = { kind, enabled: false };
      const { app, database, photos, uploadDirectory, owner, submit } = await scenario(adapter, undefined, false, outcome);
      const remove = vi.spyOn(photos, "remove");
      outcome.enabled = true;
      const rejected = await submit("Report with a lost transaction acknowledgement");
      expect(rejected.status).toBe(503);
      expect(rejected.body).toEqual({ error: {
        code: "PERSISTENCE_UNAVAILABLE", message: "Report persistence is unavailable.",
      } });
      expect(remove).not.toHaveBeenCalled();
      const files = await readdir(uploadDirectory);
      expect(files).toHaveLength(1);
      const list = await owner.get("/api/reports?scope=mine").expect(200);
      expect(list.body.total).toBe(kind === "committed" ? 1 : 0);
      if (kind === "committed") {
        const detail = await owner.get(`/api/reports/${list.body.reports[0].id}`).expect(200);
        expect(detail.body.attachments).toHaveLength(1);
        expect(await database.prepare("SELECT stored_name FROM attachments").get())
          .toEqual({ stored_name: files[0] });
        const served = await request(app).get(detail.body.attachments[0].url).expect(200);
        expect(Buffer.compare(served.body, PNG)).toBe(0);
        await request(app).get(`/api/reports/${detail.body.id}`).expect(401);
      }
      expect(JSON.stringify(rejected.body)).not.toContain(files[0]);
    }, 15_000,
  );

  (adapter === "sqlite" ? test : test.skip)("retains the committed photo when SQLite COMMIT succeeds but its reply throws", async () => {
    const { app, photos, uploadDirectory, owner, submit } = await scenario(adapter);
    const remove = vi.spyOn(photos, "remove");
    const original = new Error("Lost COMMIT acknowledgement");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exec = Database.prototype.exec;
    vi.spyOn(Database.prototype, "exec").mockImplementation(function (this: Database.Database, sql) {
      const result = exec.call(this, sql);
      if (sql === "COMMIT") throw original;
      return result;
    });
    const rejected = await submit("Report committed before acknowledgement failure");
    expect(rejected.status).toBe(500);
    expect(rejected.body).toEqual({ error: {
      code: "INTERNAL_ERROR", message: "An unexpected error occurred.",
    } });
    expect(remove).not.toHaveBeenCalled();
    const list = await owner.get("/api/reports?scope=mine").expect(200);
    expect(list.body.total).toBe(1);
    const detail = await owner.get(`/api/reports/${list.body.reports[0].id}`).expect(200);
    expect(detail.body.attachments).toHaveLength(1);
    expect(await readdir(uploadDirectory)).toHaveLength(1);
    const served = await request(app).get(detail.body.attachments[0].url).expect(200);
    expect(Buffer.compare(served.body, PNG)).toBe(0);
  }, 15_000);

  test("seeds the counter from reports that predate this change", async () => {
    const { database, submit } = await scenario(adapter);
    await submit("Report from the existing installation").expect(201);
    await database.prepare("DELETE FROM settings WHERE key = 'report_reference_counter'").run();
    const created = await submit("First report after upgrading");
    expect(created.status).toBe(201);
    expect(created.body.referenceCode).toBe(`CS-${new Date().getFullYear()}-0002`);
  }, 15_000);
});
