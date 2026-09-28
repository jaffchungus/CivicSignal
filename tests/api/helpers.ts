import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";

import { createApp } from "../../server/app";
import { createSqliteDatabase } from "../../server/database-sqlite";
import { DiskPhotoStore } from "../../server/photo-store";

const closers: Array<() => Promise<void>> = [];
const temporaryDirectories: string[] = [];

/** Creates a fresh CivicSignal app on a throwaway database and exposes its upload directory. */
export async function testApplicationWithUploads(): Promise<{
  app: Express;
  uploadDirectory: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "civicsignal-api-"));
  temporaryDirectories.push(directory);
  const uploadDirectory = path.join(directory, "uploads");
  const database = await createSqliteDatabase(path.join(directory, "test.sqlite"));
  const photos = new DiskPhotoStore(uploadDirectory);
  const { app, close } = createApp({ database, photos, secureCookies: false });
  closers.push(close);
  return { app, uploadDirectory };
}

/** Creates a fresh CivicSignal app on a throwaway database. */
export async function testApplication(): Promise<Express> {
  return (await testApplicationWithUploads()).app;
}

/** Closes database handles before removing temp directories (required on Windows). */
export async function cleanupApplications(): Promise<void> {
  for (const close of closers.splice(0)) {
    await close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export const ADMIN_CREDENTIALS = {
  municipalityName: "Springfield",
  displayName: "Platform Administrator",
  email: "admin@example.test",
  password: "correct horse battery staple",
};

/** Runs first-run setup and returns a signed-in administrator agent. */
export function setupAdministrator(app: Express) {
  const agent = request.agent(app);
  return agent
    .post("/api/setup")
    .send(ADMIN_CREDENTIALS)
    .expect(201)
    .then(() => agent);
}
