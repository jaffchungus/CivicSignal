// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { pools, connectFailure, schemaFailure } = vi.hoisted(() => ({
  pools: [] as Array<{
    options: unknown;
    query: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  }>,
  connectFailure: { value: false },
  schemaFailure: { value: false },
}));

vi.mock("pg", () => ({
  types: { setTypeParser: vi.fn() },
  Pool: class {
    constructor(options: unknown) {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (schemaFailure.value && sql.includes("CREATE TABLE")) throw new Error("Schema failure");
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      const pool = {
        options, client,
        query: vi.fn(async () => ({ rows: [{ value: 1 }] })),
        connect: vi.fn(async () => {
          if (connectFailure.value) throw new Error("Connection failure");
          return client;
        }),
        end: vi.fn(async () => undefined),
      };
      pools.push(pool);
      return pool;
    }
  },
}));

import { createPostgresDatabase } from "../server/database-postgres";

beforeEach(() => {
  pools.length = 0;
  connectFailure.value = false;
  schemaFailure.value = false;
});

describe("Postgres adapter", () => {
  it("serializes schema initialization and denies public Data API access", async () => {
    const database = await createPostgresDatabase("postgresql://test");
    const pool = pools[0];
    expect(pool.options).toMatchObject({ max: 1, connectionTimeoutMillis: 10_000 });
    const sql = pool.client.query.mock.calls.map(([text]) => String(text));
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("pg_advisory_xact_lock");
    expect(sql[2]).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(sql[3]).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql[3]).toContain("FROM PUBLIC");
    expect(sql[3]).toContain("'anon', 'authenticated'");
    expect(sql.at(-1)).toBe("COMMIT");
    await database.prepare("SELECT ? AS value").get(1);
    expect(pool.query).toHaveBeenCalledWith("SELECT $1 AS value", [1]);
    await database.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("does not borrow a transaction client from another database instance", async () => {
    const first = await createPostgresDatabase("postgresql://first");
    const second = await createPostgresDatabase("postgresql://second");
    await first.transaction(async () => {
      await first.prepare("SELECT ?").run("first");
      await first.transaction(async () => {
        await first.prepare("SELECT ?").run("nested");
      });
      await second.prepare("SELECT ?").run("second");
    });
    expect(pools[0].client.query).toHaveBeenCalledWith("SELECT $1", ["first"]);
    expect(pools[0].client.query).toHaveBeenCalledWith("SELECT $1", ["nested"]);
    expect(pools[1].query).toHaveBeenCalledWith("SELECT $1", ["second"]);
    expect(pools[0].client.query).not.toHaveBeenCalledWith("SELECT $1", ["second"]);
    await Promise.all([first.close(), second.close()]);
  });

  it("rolls back and releases its transaction client when a callback fails", async () => {
    const database = await createPostgresDatabase("postgresql://test");
    pools[0].client.query.mockClear();
    pools[0].client.release.mockClear();
    await expect(database.transaction(async () => { throw new Error("Write failure"); }))
      .rejects.toThrow("Write failure");
    expect(pools[0].client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(pools[0].client.release).toHaveBeenCalledOnce();
    await database.close();
  });

  it.each(["callback", "commit", "rollback"] as const)(
    "only authorizes compensation for confirmed pre-commit rollback (%s failure)",
    async (phase) => {
      const database = await createPostgresDatabase("postgresql://test");
      const client = pools[0].client;
      client.query.mockClear();
      client.release.mockClear();
      const original = new Error("Original transaction failure");
      client.query.mockImplementation(async (sql: string) => {
        if (phase === "commit" && sql === "COMMIT") throw original;
        if (phase === "rollback" && sql === "ROLLBACK") throw new Error("Rollback acknowledgement lost");
        return { rows: [] };
      });
      const compensate = vi.fn(async () => undefined);
      await expect(database.transaction(async () => {
        if (phase !== "commit") throw original;
      }, compensate)).rejects.toBe(original);
      expect(compensate).toHaveBeenCalledTimes(phase === "callback" ? 1 : 0);
      expect(client.release).toHaveBeenCalledExactlyOnceWith(phase !== "callback");
      expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(
        phase === "commit" ? ["BEGIN", "COMMIT"] : ["BEGIN", "ROLLBACK"],
      );
      await database.close();
    },
  );

  it("preserves the original error if confirmed-rollback compensation fails", async () => {
    const database = await createPostgresDatabase("postgresql://test");
    const original = new Error("Original write failure");
    const compensate = vi.fn(async () => { throw new Error("Cleanup failure"); });
    await expect(database.transaction(async () => { throw original; }, compensate)).rejects.toBe(original);
    expect(compensate).toHaveBeenCalledOnce();
    await database.close();
  });

  it("does not authorize nested compensation before its owning transaction ends", async () => {
    const database = await createPostgresDatabase("postgresql://test");
    const nestedCompensation = vi.fn();
    await database.transaction(async () => {
      await database.transaction(async () => { throw new Error("Nested failure"); }, nestedCompensation)
        .catch(() => undefined);
    });
    expect(nestedCompensation).not.toHaveBeenCalled();
    await database.close();
  });

  it("closes the pool after initialization connection or schema failures", async () => {
    connectFailure.value = true;
    await expect(createPostgresDatabase("postgresql://test")).rejects.toThrow("Connection failure");
    expect(pools[0].end).toHaveBeenCalledOnce();
    connectFailure.value = false;
    schemaFailure.value = true;
    await expect(createPostgresDatabase("postgresql://test")).rejects.toThrow("Schema failure");
    expect(pools[1].client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(pools[1].client.release).toHaveBeenCalledOnce();
    expect(pools[1].end).toHaveBeenCalledOnce();
  });
});
