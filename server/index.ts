// Standalone entry: SQLite/disk by default; external storage when CONNECTION_STRING
// is set. Serves the built client. Vercel uses api/index.ts instead.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import express from "express";

import { createApp } from "./app";
import { createSqliteDatabase } from "./database-sqlite";
import { DiskPhotoStore } from "./photo-store";
import { createProductionApp } from "./production";

// Node's native loader keeps existing process environment values authoritative.
for (const filename of [".env.local", ".env"]) {
  if (existsSync(filename)) process.loadEnvFile(filename);
}

const port = Number(process.env.PORT ?? 3001);
const databasePath = process.env.DATABASE_PATH ?? "./data/civicsignal.db";
const uploadDirectory = process.env.UPLOAD_DIR ?? "./uploads";
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 14);
const clientDirectory = path.resolve(
  process.env.CLIENT_DIR ?? path.join("dist", "client"),
);

async function localApp() {
  mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const database = await createSqliteDatabase(databasePath);
  return createApp({ database, photos: new DiskPhotoStore(uploadDirectory), sessionTtlDays });
}

const { app, close } = process.env.CONNECTION_STRING || process.env.DATABASE_URL || process.env.POSTGRES_URL
  ? await createProductionApp()
  : await localApp();

app.use(express.static(clientDirectory));
app.use((request, response, next) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    next();
    return;
  }
  if (request.path.startsWith("/api/") || request.path.startsWith("/uploads/")) {
    next();
    return;
  }
  response.sendFile(path.join(clientDirectory, "index.html"), (error) => {
    if (error) {
      next();
    }
  });
});

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
