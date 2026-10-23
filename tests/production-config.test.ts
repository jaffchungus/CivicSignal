// @vitest-environment node

import { describe, expect, it } from "vitest";

import { productionConfig, productionConnectionString } from "../server/production";
import { createSupabaseServerClient } from "../server/supabase";

const DATABASE_URL = "postgresql://postgres:password@localhost:5432/civicsignal";
const NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

describe("production configuration", () => {
  it("uses Supabase with existing Postgres SQL and a server-only storage key", () => {
    expect(productionConfig({
      DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY: "sb_secret_test",
    })).toEqual({
      connectionString: DATABASE_URL,
      photos: {
        provider: "supabase", url: NEXT_PUBLIC_SUPABASE_URL,
        secretKey: "sb_secret_test", bucket: "civicsignal-photos",
      },
    });
  });

  it("uses CONNECTION_STRING as the primary Postgres URL", () => {
    const suppliedConnection = "postgresql://postgres:password@db.example.supabase.co:5432/postgres";

    expect(productionConfig({
      CONNECTION_STRING: suppliedConnection,
      DATABASE_URL,
      BLOB_READ_WRITE_TOKEN: "test",
    })).toMatchObject({ connectionString: suppliedConnection });
  });

  it("builds the supplied Supabase connection from DB_PASSWORD with safe encoding and SSL", () => {
    const password = "p@ss:/? #!'()";
    expect(productionConnectionString({ DB_PASSWORD: password })).toBe(
      "postgresql://postgres:p%40ss%3A%2F%3F%20%23%21%27%28%29@db.zocubotkhlkrtbyyheiu.supabase.co:5432/postgres?sslmode=require",
    );
    expect(productionConfig({ DB_PASSWORD: password, BLOB_READ_WRITE_TOKEN: "test" }).connectionString)
      .toBe(productionConnectionString({ DB_PASSWORD: password }));
  });

  it("prefers an explicit Postgres URL when DB_PASSWORD is also configured", () => {
    const suppliedConnection = "postgresql://postgres:encoded@db.custom.supabase.co:5432/postgres";
    expect(productionConnectionString({ CONNECTION_STRING: suppliedConnection, DB_PASSWORD: "ignored" }))
      .toBe(suppliedConnection);
  });

  it("keeps existing Postgres/Blob deployments working and permits an explicit choice", () => {
    expect(productionConfig({ POSTGRES_URL: DATABASE_URL, BLOB_READ_WRITE_TOKEN: "test" })
      .photos.provider).toBe("blob");
    expect(productionConfig({
      DATABASE_URL, PHOTO_STORAGE: "blob", BLOB_READ_WRITE_TOKEN: "test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    }).photos.provider).toBe("blob");
  });

  it("uses database photos when no private cloud storage credentials are configured", () => {
    expect(() => productionConfig({ NEXT_PUBLIC_SUPABASE_URL })).toThrow("CONNECTION_STRING or DB_PASSWORD is required");
    expect(() => productionConfig({ DATABASE_URL: NEXT_PUBLIC_SUPABASE_URL })).toThrow("Postgres connection string");
    expect(productionConfig({ DATABASE_URL }).photos.provider).toBe("database");
    expect(productionConfig({
      DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    }).photos.provider).toBe("database");
    expect(() => productionConfig({
      DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, PHOTO_STORAGE: "supabase",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    })).toThrow("SUPABASE_SECRET_KEY is required");
    expect(() => productionConfig({
      DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY: "sb_publishable_test",
    })).toThrow("publishable key cannot authorize");
    expect(() => createSupabaseServerClient(NEXT_PUBLIC_SUPABASE_URL, "sb_publishable_test"))
      .toThrow("server-only secret");
  });

  it("rejects invalid providers and insecure storage endpoints", () => {
    expect(() => productionConfig({ DATABASE_URL, PHOTO_STORAGE: "disk" })).toThrow("PHOTO_STORAGE");
    expect(() => productionConfig({
      DATABASE_URL, SUPABASE_URL: "http://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test",
    })).toThrow("HTTPS");
  });
});
