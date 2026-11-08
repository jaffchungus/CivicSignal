// @vitest-environment node

import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupApplications,
  setTestPhotoAnalysis,
  setupAdministrator,
  testApplicationWithUploads,
  TEST_PNG_BUFFER,
} from "./helpers";

type Agent = ReturnType<typeof request.agent>;

const alpha = { latitude: 45, longitude: -100 };
const beta = { latitude: 39.01, longitude: -90.01 };
const gamma = { latitude: 39, longitude: -90 };

let app: Express;
let admin: Agent;
let resident: Agent;
let alphaOfficer: Agent;
let betaOfficer: Agent;
let database: Awaited<ReturnType<typeof testApplicationWithUploads>>["database"];
let publicWorksId: string;
let parksId: string;
let roadsCategoryId: string;

async function registerStaff(
  displayName: string,
  email: string,
  organizationId: string,
): Promise<Agent> {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({
    displayName,
    email,
    password: "a verified staff password",
    role: "OFFICIAL",
    organizationId,
  }).expect(201);
  const users = (await admin.get("/api/admin/users").expect(200)).body.users as Array<{
    id: string;
    email: string;
  }>;
  const userId = users.find((user) => user.email === email)!.id;
  await admin.post(`/api/admin/users/${userId}/verify`).send({
    role: "OFFICIAL",
    organizationId,
  }).expect(200);
  return agent;
}

async function submitReport(coordinates: { latitude: number; longitude: number }) {
  setTestPhotoAnalysis({
    categoryId: roadsCategoryId,
    title: "Cracked curb at the crossing",
    description: "The curb is cracked and lifted beside the crossing.",
  });
  return resident
    .post("/api/reports")
    .field("location", "Fictional test crossing")
    .field("latitude", String(coordinates.latitude))
    .field("longitude", String(coordinates.longitude))
    .attach("photo", TEST_PNG_BUFFER, {
      filename: "curb.png",
      contentType: "image/png",
    })
    .expect(201);
}

beforeAll(async () => {
  const application = await testApplicationWithUploads();
  app = application.app;
  database = application.database;
  admin = await setupAdministrator(app);

  const organizations = (await admin.get("/api/admin/organizations").expect(200)).body
    .organizations as Array<{ id: string; name: string }>;
  publicWorksId = organizations.find((organization) => organization.name === "Public Works")!.id;
  parksId = organizations.find((organization) => organization.name === "Parks and Recreation")!.id;

  const categories = (await admin.get("/api/admin/categories").expect(200)).body
    .categories as Array<{ id: string; name: string }>;
  roadsCategoryId = categories.find((category) => category.name === "Roads and Sidewalks")!.id;

  const now = Date.now();
  for (const municipality of [
    { id: "alpha", name: "Alpha", center: alpha },
    { id: "beta", name: "Beta", center: beta },
    { id: "gamma", name: "Gamma", center: gamma },
  ]) {
    await database
      .prepare(
        `INSERT INTO municipalities
          (id, name, boundary_geojson, center_latitude, center_longitude, active, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 1, ?, ?)`,
      )
      .run(
        municipality.id,
        municipality.name,
        municipality.center.latitude,
        municipality.center.longitude,
        now,
        now,
      );
  }
  await database
    .prepare("UPDATE organizations SET municipality_id = ? WHERE id = ?")
    .run("alpha", publicWorksId);
  await database
    .prepare("UPDATE organizations SET municipality_id = ? WHERE id = ?")
    .run("beta", parksId);

  alphaOfficer = await registerStaff(
    "Avery Alpha",
    "avery.alpha@example.test",
    publicWorksId,
  );
  betaOfficer = await registerStaff(
    "Blair Beta",
    "blair.beta@example.test",
    parksId,
  );
  resident = request.agent(app);
  await resident.post("/api/auth/register").send({
    displayName: "Riley Resident",
    email: "riley.resident@example.test",
    password: "a resident password",
  }).expect(201);
});

afterAll(async () => {
  await cleanupApplications();
});

describe("municipality-first staff assignment", () => {
  it("assigns the nearest eligible person in the report municipality and lets that person view the report", async () => {
    const created = await submitReport(alpha);

    expect(created.body.organization).toMatchObject({ name: "Public Works" });
    expect(created.body.municipality).toMatchObject({ name: "Alpha" });
    expect(created.body.assignedTo).toMatchObject({ displayName: "Avery Alpha" });

    await alphaOfficer.get(`/api/reports/${created.body.id}`).expect(200);
  });

  it("assigns the nearest eligible person anywhere when the report municipality has no staff, and grants that person access", async () => {
    const created = await submitReport(gamma);

    expect(created.body.organization).toMatchObject({ name: "Public Works" });
    expect(created.body.municipality).toMatchObject({ name: "Gamma" });
    expect(created.body.assignedTo).toMatchObject({ displayName: "Blair Beta" });

    const detail = await betaOfficer.get(`/api/reports/${created.body.id}`).expect(200);
    expect(detail.body.capabilities).toMatchObject({
      canUpdateStatus: true,
      canAddUpdate: true,
    });

    await betaOfficer
      .post(`/api/reports/${created.body.id}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(200);

    const queue = await betaOfficer.get("/api/reports?scope=queue").expect(200);
    expect(queue.body.reports.map((report: { id: string }) => report.id)).toContain(
      created.body.id,
    );

    await betaOfficer
      .get(`/api/reports/${created.body.id}/attachments/${created.body.attachments[0].id}`)
      .expect(200);
  });
});
