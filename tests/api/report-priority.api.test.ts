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

const base = { latitude: 39.7817, longitude: -89.6501 };

let app: Express;
let admin: Agent;
let official: Agent;
let database: Awaited<ReturnType<typeof testApplicationWithUploads>>["database"];
let roadsCategoryId: string;
let residents: Agent[];

async function registerResident(displayName: string, email: string): Promise<Agent> {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({
    displayName,
    email,
    password: "a resident account password",
  }).expect(201);
  return agent;
}

async function submitReport(
  agent: Agent,
  title: string,
  coordinates: { latitude: number; longitude: number },
) {
  setTestPhotoAnalysis({
    categoryId: roadsCategoryId,
    title,
    description: `${title} needs an inspection.`,
  });
  return agent
    .post("/api/reports")
    .field("location", "Near the test intersection")
    .field("latitude", String(coordinates.latitude))
    .field("longitude", String(coordinates.longitude))
    .attach("photo", TEST_PNG_BUFFER, {
      filename: "priority.png",
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
  const publicWorksId = organizations.find((organization) => organization.name === "Public Works")!.id;
  const categories = (await admin.get("/api/admin/categories").expect(200)).body
    .categories as Array<{ id: string; name: string }>;
  roadsCategoryId = categories.find((category) => category.name === "Roads and Sidewalks")!.id;

  official = request.agent(app);
  await official.post("/api/auth/register").send({
    displayName: "Olive Official",
    email: "olive.priority@example.test",
    password: "an official account password",
    role: "OFFICIAL",
    organizationId: publicWorksId,
  }).expect(201);
  const users = (await admin.get("/api/admin/users").expect(200)).body.users as Array<{
    id: string;
    email: string;
  }>;
  const officialUser = users.find((user) => user.email === "olive.priority@example.test")!;
  await admin.post(`/api/admin/users/${officialUser.id}/verify`).send({
    role: "OFFICIAL",
    organizationId: publicWorksId,
  }).expect(200);

  residents = await Promise.all([
    registerResident("Riley One", "riley.one@example.test"),
    registerResident("Riley Two", "riley.two@example.test"),
    registerResident("Riley Three", "riley.three@example.test"),
    registerResident("Riley Four", "riley.four@example.test"),
  ]);
});

afterAll(async () => {
  await cleanupApplications();
});

describe("nearby report priority", () => {
  it("escalates corroborated reports for officials without exposing priority to residents", async () => {
    const first = await submitReport(residents[0], "First pothole report", base);
    expect(first.body.priority).toBeUndefined();

    const residentDetail = await residents[0]
      .get(`/api/reports/${first.body.id}`)
      .expect(200);
    expect(residentDetail.body.priority).toBeUndefined();

    const standard = await official.get(`/api/reports/${first.body.id}`).expect(200);
    expect(standard.body.priority).toEqual({
      level: "STANDARD",
      reportCount: 1,
      reporterCount: 1,
      radiusMeters: 100,
      windowDays: 30,
    });

    const second = await submitReport(residents[1], "Second pothole report", {
      latitude: base.latitude + 0.0002,
      longitude: base.longitude,
    });
    const elevated = await official.get(`/api/reports/${first.body.id}`).expect(200);
    expect(elevated.body.priority).toMatchObject({
      level: "ELEVATED",
      reportCount: 2,
      reporterCount: 2,
    });

    const third = await submitReport(residents[2], "Third pothole report", {
      latitude: base.latitude,
      longitude: base.longitude + 0.0002,
    });
    const threePeople = await official.get(`/api/reports/${third.body.id}`).expect(200);
    expect(threePeople.body.priority).toMatchObject({
      level: "ELEVATED",
      reportCount: 3,
      reporterCount: 3,
    });

    const fourth = await submitReport(residents[3], "Fourth pothole report", {
      latitude: base.latitude - 0.0002,
      longitude: base.longitude,
    });
    const high = await official.get(`/api/reports/${fourth.body.id}`).expect(200);
    expect(high.body.priority).toMatchObject({
      level: "HIGH",
      reportCount: 4,
      reporterCount: 4,
    });

    const farAway = await submitReport(residents[0], "Distant pothole report", {
      latitude: base.latitude + 0.02,
      longitude: base.longitude,
    });
    const standardFarAway = await official.get(`/api/reports/${farAway.body.id}`).expect(200);
    expect(standardFarAway.body.priority).toMatchObject({
      level: "STANDARD",
      reportCount: 1,
      reporterCount: 1,
    });

    const queue = await official.get("/api/reports?scope=queue").expect(200);
    expect(queue.body.reports).toHaveLength(5);
    expect(queue.body.reports[0].priority.level).toBe("HIGH");
    expect(queue.body.reports.at(-1)).toMatchObject({
      id: farAway.body.id,
      priority: { level: "STANDARD" },
    });
    expect(
      queue.body.reports.slice(0, 4).map((report: { id: string }) => report.id).sort(),
    ).toEqual(
      [first.body.id, second.body.id, third.body.id, fourth.body.id].sort(),
    );

    const residentQueue = await residents[0].get("/api/reports?scope=mine").expect(200);
    expect(residentQueue.body.reports).toHaveLength(2);
    expect(
      residentQueue.body.reports.every(
        (report: { priority?: unknown }) => report.priority === undefined,
      ),
    ).toBe(true);
  });
});
