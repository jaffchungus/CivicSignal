// Standalone entry: SQLite/disk by default; external storage when CONNECTION_STRING
// is set. Serves the built client. Vercel uses api/index.ts instead.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { attachClient, createApp } from "./app.js";
import { createSqliteDatabase } from "./database-sqlite.js";
import { DiskPhotoStore } from "./photo-store.js";
import { createProductionApp } from "./production.js";
import { resolveSessionTtlMs } from "./session.js";

// Node's native loader keeps existing process environment values authoritative.
for (const filename of [".env.local", ".env"]) {
  if (existsSync(filename)) process.loadEnvFile(filename);
}

const port = Number(process.env.PORT ?? 3001);
const databasePath = process.env.DATABASE_PATH ?? "./data/civicsignal.db";
const uploadDirectory = process.env.UPLOAD_DIR ?? "./uploads";
const sessionTtlMs = resolveSessionTtlMs();
const clientDirectory = path.resolve(
  process.env.CLIENT_DIR ?? path.join("dist", "client"),
);

async function localApp() {
  mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const database = await createSqliteDatabase(databasePath);
  return createApp({ database, photos: new DiskPhotoStore(uploadDirectory), sessionTtlMs });
}

const { app, close } = process.env.CONNECTION_STRING || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_PASSWORD
  ? await createProductionApp()
  : await localApp();

attachClient(app, clientDirectory);

const server = app.listen(port, () => {
  console.log(`CivicSignal server listening on http://localhost:${port}`);
});

function shutdown(): void {
  server.close(() => {
    void close().then(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
