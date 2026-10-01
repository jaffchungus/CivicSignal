// @vitest-environment node

import { describe, expect, it } from "vitest";

import { productionConfig } from "../server/production";
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

  it("keeps existing Postgres/Blob deployments working and permits an explicit choice", () => {
    expect(productionConfig({ POSTGRES_URL: DATABASE_URL, BLOB_READ_WRITE_TOKEN: "test" })
      .photos.provider).toBe("blob");
    expect(productionConfig({
      DATABASE_URL, PHOTO_STORAGE: "blob", BLOB_READ_WRITE_TOKEN: "test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    }).photos.provider).toBe("blob");
  });

  it("identifies missing SQL/storage credentials instead of using a public key as authorization", () => {
    expect(() => productionConfig({ NEXT_PUBLIC_SUPABASE_URL })).toThrow("DATABASE_URL is required");
    expect(() => productionConfig({ DATABASE_URL: NEXT_PUBLIC_SUPABASE_URL })).toThrow("Postgres connection string");
    expect(() => productionConfig({ DATABASE_URL })).toThrow("BLOB_READ_WRITE_TOKEN");
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
