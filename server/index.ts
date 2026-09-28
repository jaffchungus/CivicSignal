// Local/standalone entry: SQLite on disk, photos on disk, serves the built
// client. Production on Vercel uses api/index.ts instead.
import { mkdirSync } from "node:fs";
import path from "node:path";

import express from "express";

import { createApp } from "./app";
import { createSqliteDatabase } from "./database-sqlite";
import { DiskPhotoStore } from "./photo-store";

const port = Number(process.env.PORT ?? 3001);
const databasePath = process.env.DATABASE_PATH ?? "./data/civicsignal.db";
const uploadDirectory = process.env.UPLOAD_DIR ?? "./uploads";
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 14);
const clientDirectory = path.resolve(
  process.env.CLIENT_DIR ?? path.join("dist", "client"),
);

mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });

const database = await createSqliteDatabase(databasePath);
const photos = new DiskPhotoStore(uploadDirectory);
const { app, close } = createApp({ database, photos, sessionTtlDays });

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
