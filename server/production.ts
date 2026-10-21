import { createApp } from "./app.js";
import { createPostgresDatabase } from "./database-postgres.js";
import { ApiError } from "./http.js";
import { BlobPhotoStore } from "./photo-blob.js";
import { SupabasePhotoStore } from "./photo-supabase.js";
import type { PhotoStore, StoredPhoto } from "./photo-store.js";
import { createSupabaseServerClient } from "./supabase.js";

type Environment = Record<string, string | undefined>;

const SUPABASE_DATABASE_HOST = "db.zocubotkhlkrtbyyheiu.supabase.co";
const SUPABASE_PROJECT_REF = "zocubotkhlkrtbyyheiu";
// This Supabase project resolves its direct database host to IPv6. Vercel
// Functions are IPv4-only, so use Supavisor's IPv4 transaction pooler there.
// The exact host can be overridden with SUPABASE_DB_POOLER_HOST if Supabase
// assigns the project to a different pooler cluster.
const SUPABASE_DATABASE_REGION = "us-east-2";

function encodePassword(password: string): string {
  return encodeURIComponent(password).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function productionConnectionString(environment: Environment = process.env): string | undefined {
  const configuredConnection =
    environment.CONNECTION_STRING || environment.DATABASE_URL || environment.POSTGRES_URL;
  if (configuredConnection) return configuredConnection;

  const password = environment.DB_PASSWORD;
  if (!password) return undefined;

  return `postgresql://postgres:${encodePassword(password)}@${SUPABASE_DATABASE_HOST}:5432/postgres?sslmode=require`;
}

function requiredConnectionString(environment: Environment): string {
  const connectionString = productionConnectionString(environment);
  if (!connectionString) {
    throw new Error("CONNECTION_STRING or DB_PASSWORD is required. Use the Supabase Postgres connection details with the database password.");
  }
  const parsedConnection = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsedConnection.protocol)) {
    throw new Error("CONNECTION_STRING must be a Postgres connection string, not a Supabase API URL.");
  }
  return connectionString;
}

function configureSupabaseTls(url: URL): void {
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }
  // pg-connection-string 2.x treats `require` as verify-full unless libpq
  // compatibility is enabled. Supabase documents `require` as encrypted
  // transport without CA verification.
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("uselibpqcompat", "true");
  }
}

function supabasePoolerConnectionStrings(connectionString: string, environment: Environment): string[] {
  if (!environment.VERCEL) return [connectionString];

  const directUrl = new URL(connectionString);
  const isDirectSupabaseConnection = directUrl.hostname === SUPABASE_DATABASE_HOST;
  const isSupavisorConnection = directUrl.hostname.endsWith(".pooler.supabase.com");
  if (!isDirectSupabaseConnection && !isSupavisorConnection) return [connectionString];

  if (isSupavisorConnection) {
    configureSupabaseTls(directUrl);
    return [directUrl.toString()];
  }

  const poolerHosts = environment.SUPABASE_DB_POOLER_HOST
    ? [environment.SUPABASE_DB_POOLER_HOST]
    : [0, 1].map((index) => `aws-${index}-${SUPABASE_DATABASE_REGION}.pooler.supabase.com`);

  return poolerHosts.map((host) => {
    const poolerUrl = new URL(connectionString);
    const username = decodeURIComponent(poolerUrl.username);
    poolerUrl.username = username === "postgres" || !username.endsWith(`.${SUPABASE_PROJECT_REF}`)
      ? `${username}.${SUPABASE_PROJECT_REF}`
      : username;
    poolerUrl.hostname = host;
    poolerUrl.port = "6543";
    configureSupabaseTls(poolerUrl);
    return poolerUrl.toString();
  });
}

function productionPhotoConfig(environment: Environment) {
  const secretKey = environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
  const provider = environment.PHOTO_STORAGE || (secretKey ? "supabase" : "blob");
  if (provider === "blob") {
    if (!environment.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN is required for Blob storage, or configure PHOTO_STORAGE=supabase.");
    }
    return { provider } as const;
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
    provider,
    url,
    secretKey,
    bucket: environment.SUPABASE_PHOTO_BUCKET || "civicsignal-photos",
  } as const;
}

export function productionConfig(environment: Environment = process.env) {
  return {
    connectionString: requiredConnectionString(environment),
    photos: productionPhotoConfig(environment),
  };
}

/** Keeps non-photo API routes available when the optional photo service is down. */
class UnavailablePhotoStore implements PhotoStore {
  async save(_buffer: Buffer, _originalName: string, _contentType: string): Promise<StoredPhoto> {
    throw new ApiError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is temporarily unavailable.");
  }

  async remove(_storedName: string): Promise<void> {
    throw new ApiError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is temporarily unavailable.");
  }

  async url(_storedName: string): Promise<string> {
    throw new ApiError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is temporarily unavailable.");
  }
}

export async function createProductionApp() {
  // The database is required for CivicSignal's account and report data.
  // Photo storage is optional: its missing credentials or an unavailable
  // bucket must not take signup, sign-in, and catalog APIs offline.
  const connectionString = requiredConnectionString(process.env);
  let database: Awaited<ReturnType<typeof createPostgresDatabase>> | undefined;
  let databaseError: unknown;
  for (const candidate of supabasePoolerConnectionStrings(connectionString, process.env)) {
    try {
      database = await createPostgresDatabase(candidate);
      break;
    } catch (error) {
      databaseError = error;
    }
  }
  if (!database) throw databaseError;

  let photos: PhotoStore;
  try {
    const config = productionPhotoConfig(process.env);
    photos = config.provider === "supabase"
      ? await SupabasePhotoStore.create(
          createSupabaseServerClient(config.url, config.secretKey),
          config.bucket,
        )
      : new BlobPhotoStore();
  } catch (error) {
    console.error("[production] Photo storage unavailable; starting API without photo support:", error);
    photos = new UnavailablePhotoStore();
  }

  return createApp({
    database,
    photos,
    secureCookies: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
  });
}
