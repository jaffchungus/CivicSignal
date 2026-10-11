import { createApp } from "./app";
import { createPostgresDatabase } from "./database-postgres";
import { BlobPhotoStore } from "./photo-blob";
import { SupabasePhotoStore } from "./photo-supabase";
import { createSupabaseServerClient } from "./supabase";

type Environment = Record<string, string | undefined>;

export function productionConfig(environment: Environment = process.env) {
  const connectionString =
    environment.CONNECTION_STRING || environment.DATABASE_URL || environment.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("CONNECTION_STRING is required. Use the Supabase Postgres connection string with the database password.");
  }
  const parsedConnection = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsedConnection.protocol)) {
    throw new Error("CONNECTION_STRING must be a Postgres connection string, not a Supabase API URL.");
  }
  const secretKey = environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
  const provider = environment.PHOTO_STORAGE || (secretKey ? "supabase" : "blob");
  if (provider === "blob") {
    if (!environment.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN is required for Blob storage, or configure PHOTO_STORAGE=supabase.");
    }
    return { connectionString, photos: { provider } } as const;
  }
  if (provider !== "supabase") {
    throw new Error("PHOTO_STORAGE must be supabase or blob for an external database deployment.");
  }
  const url = environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || new URL(url).protocol !== "https:") {
    throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) must be an HTTPS Supabase project URL.");
  }
  if (!secretKey || secretKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY is required for private storage; the publishable key cannot authorize CivicSignal users.");
  }
  return {
    connectionString,
    photos: { provider, url, secretKey, bucket: environment.SUPABASE_PHOTO_BUCKET || "civicsignal-photos" },
  } as const;
}

export async function createProductionApp() {
  const config = productionConfig();
  const photos = config.photos.provider === "supabase"
    ? await SupabasePhotoStore.create(
        createSupabaseServerClient(config.photos.url, config.photos.secretKey),
        config.photos.bucket,
      )
    : new BlobPhotoStore();
  const database = await createPostgresDatabase(config.connectionString);
  return createApp({ database, photos, secureCookies: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL) });
}
