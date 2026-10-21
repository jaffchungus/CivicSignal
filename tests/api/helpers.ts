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
  return (async () => {
    await agent.post("/api/setup").send(ADMIN_CREDENTIALS).expect(201);

    // Civic routing belongs to each deployment. Tests provision their own
    // deterministic municipality configuration through the admin API.
    const organizations = new Map<string, string>();
    for (const organization of [
      { key: "publicWorks", name: "Public Works", kind: "PUBLIC_SERVICE" },
      { key: "parks", name: "Parks and Recreation", kind: "PUBLIC_SERVICE" },
      { key: "police", name: "Police Department", kind: "LAW_ENFORCEMENT" },
    ]) {
      const result = await agent.post("/api/admin/organizations").send({
        name: organization.name,
        kind: organization.kind,
      }).expect(201);
      organizations.set(organization.key, result.body.organization.id);
    }

    for (const [name, description, organizationKey] of [
      ["Roads and Sidewalks", "Potholes, damaged sidewalks, and road hazards", "publicWorks"],
      ["Streetlights", "Broken or malfunctioning public streetlights", "publicWorks"],
      ["Trash and Sanitation", "Missed collection, dumping, and public waste", "publicWorks"],
      ["Parks and Recreation", "Maintenance issues in parks and public recreation areas", "parks"],
      ["Non-Emergency Public Safety", "Non-emergency concerns appropriate for local police", "police"],
    ] as const) {
      await agent.post("/api/admin/categories").send({
        name,
        description,
        organizationId: organizations.get(organizationKey),
      }).expect(201);
    }
    return agent;
  })();
}
