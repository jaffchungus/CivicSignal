import { mkdirSync } from "node:fs";
import path from "node:path";

import express from "express";

import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3001);
const databasePath = process.env.DATABASE_PATH ?? "./data/civicsignal.db";
const uploadDirectory = process.env.UPLOAD_DIR ?? "./uploads";
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 14);
const clientDirectory = path.resolve(
  process.env.CLIENT_DIR ?? path.join("dist", "client"),
);

mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });

const { app, close } = createApp({
  databasePath,
  uploadDirectory,
  sessionTtlDays,
});

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
    close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
