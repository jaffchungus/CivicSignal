// @vitest-environment node

import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupApplications,
  setTestPhotoAnalysis,
  setupAdministrator,
  testApplication,
  testApplicationWithUploads,
} from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Agent = ReturnType<typeof request.agent>;

type ReportRef = {
  id: string;
  referenceCode: string;
  title: string;
  attachmentId: string;
  attachmentUrl: string;
};

type Scenario = {
  app: Express;
  admin: Agent;
  residentA: Agent;
  residentB: Agent;
  officialA: Agent;
  officialB: Agent;
  residentBId: string;
  spareId: string;
  publicWorksId: string;
  parksId: string;
  roadsCategoryId: string;
  parksCategoryId: string;
  reportA: ReportRef;
  reportB: ReportRef;
  reportC: ReportRef;
  guestReport: ReportRef;
  guestToken: string;
};

const scenario = {} as Scenario;

function reportRef(body: {
  id: string;
  referenceCode: string;
  title: string;
  attachments: Array<{ id: string; url: string }>;
}): ReportRef {
  const attachment = body.attachments[0];
  return {
    id: body.id,
    referenceCode: body.referenceCode,
    title: body.title,
    attachmentId: attachment?.id ?? "",
    attachmentUrl: attachment?.url ?? "",
  };
}

function expectNoLeak(body: unknown, secrets: string[]): void {
  const serialized = JSON.stringify(body) ?? "";
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

async function register(
  app: Express,
  input: { displayName: string; email: string; password: string },
): Promise<Agent> {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(input).expect(201);
  return agent;
}

async function registerStaff(
  app: Express,
  input: { displayName: string; email: string; password: string; organizationId: string },
): Promise<Agent> {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send({ ...input, role: "OFFICIAL" })
    .expect(201);
  return agent;
}

async function createReport(
  agent: Agent,
  categoryId: string,
  title: string,
  description: string,
  location: string,
): Promise<ReportRef> {
  setTestPhotoAnalysis({ categoryId, title, description });
  const response = await agent
    .post("/api/reports")
    .field("location", location)
    .field("latitude", "39.7817")
    .field("longitude", "-89.6501")
    .attach("photo", PNG, { filename: "report.png", contentType: "image/png" })
    .expect(201);
  return reportRef(response.body);
}

beforeAll(async () => {
  const { app } = await testApplicationWithUploads();
  scenario.app = app;
  scenario.admin = await setupAdministrator(app);

  const organizations = (await request(app).get("/api/organizations").expect(200)).body
    .organizations as Array<{ id: string; name: string }>;
  scenario.publicWorksId = organizations.find(
    (organization) => organization.name === "Public Works",
  )!.id;
  scenario.parksId = organizations.find(
    (organization) => organization.name === "Parks and Recreation",
  )!.id;

  scenario.residentA = await register(app, {
    displayName: "Rita Owner",
    email: "owner@example.test",
    password: "a resident owner password",
  });
  scenario.residentB = await register(app, {
    displayName: "Ravi Stranger",
    email: "stranger@example.test",
    password: "another resident password",
  });
  scenario.officialA = await registerStaff(app, {
    displayName: "Olive Publicworks",
    email: "official-a@example.test",
    password: "a public works password",
    organizationId: scenario.publicWorksId,
  });
  scenario.officialB = await registerStaff(app, {
    displayName: "Parker Parks",
    email: "official-b@example.test",
    password: "a parks department password",
    organizationId: scenario.parksId,
  });
  const spare = await register(app, {
    displayName: "Sam Spare",
    email: "spare@example.test",
    password: "a spare account password",
  });
  await spare.get("/api/auth/session").expect(200);

  const users = (await scenario.admin.get("/api/admin/users").expect(200)).body.users as Array<{
    id: string;
    email: string;
  }>;
  const userId = (email: string) => users.find((user) => user.email === email)!.id;
  scenario.residentBId = userId("stranger@example.test");
  scenario.spareId = userId("spare@example.test");

  await scenario.admin
    .post(`/api/admin/users/${userId("official-a@example.test")}/verify`)
    .send({ role: "OFFICIAL", organizationId: scenario.publicWorksId })
    .expect(200);
  await scenario.admin
    .post(`/api/admin/users/${userId("official-b@example.test")}/verify`)
    .send({ role: "OFFICIAL", organizationId: scenario.parksId })
    .expect(200);

  const categories = (await scenario.residentA.get("/api/categories").expect(200)).body
    .categories as Array<{ id: string; name: string }>;
  scenario.roadsCategoryId = categories.find(
    (category) => category.name === "Roads and Sidewalks",
  )!.id;
  scenario.parksCategoryId = categories.find(
    (category) => category.name === "Parks and Recreation",
  )!.id;

  scenario.reportA = await createReport(
    scenario.residentA,
    scenario.roadsCategoryId,
    "Pothole beside the school crossing",
    "A wide pothole is holding water next to the school crossing.",
    "Main Street and 2nd Avenue",
  );
  scenario.reportB = await createReport(
    scenario.residentB,
    scenario.parksCategoryId,
    "Broken bench at Riverside Park",
    "The bench beside the pavilion has a broken slat.",
    "Riverside Park pavilion",
  );
  scenario.reportC = await createReport(
    scenario.residentA,
    scenario.roadsCategoryId,
    "Streetlight flickering on Oak Street",
    "The streetlight outside number 14 flickers all night.",
    "Oak Street 14",
  );

  setTestPhotoAnalysis({
    categoryId: scenario.roadsCategoryId,
    title: "Blocked storm drain on Pine Street",
    description: "A storm drain is blocked and the sidewalk floods.",
  });
  const guest = await request(app)
    .post("/api/reports/guest")
    .field("location", "Pine Street and 8th Avenue")
    .field("latitude", "39.7817")
    .field("longitude", "-89.6501")
    .attach("photo", PNG, { filename: "guest.png", contentType: "image/png" })
    .expect(201);
  scenario.guestReport = reportRef(guest.body);
  scenario.guestToken = guest.body.guestAccessToken as string;
});

afterAll(async () => {
  await cleanupApplications();
});

describe("cross-account authorization", () => {
  it("denies report and photo reads to unrelated residents and organizations", async () => {
    const { app, admin, residentA, residentB, officialA, officialB, reportA, reportB } =
      scenario;
    const secrets = [reportA.referenceCode, reportA.title, "owner@example.test"];

    const anonymous = await request(app).get(`/api/reports/${reportA.id}`).expect(401);
    expect(anonymous.body.error.code).toBe("AUTH_REQUIRED");

    for (const agent of [residentB, officialB]) {
      const detail = await agent.get(`/api/reports/${reportA.id}`).expect(404);
      expect(detail.body.error.code).toBe("REPORT_NOT_FOUND");
      expectNoLeak(detail.body, secrets);
      const photo = await agent.get(reportA.attachmentUrl).expect(404);
      expectNoLeak(photo.body, secrets);
    }

    await residentB
      .get(`/api/reports/${reportB.id}/attachments/${reportA.attachmentId}`)
      .expect(404);

    const staffView = await officialA.get(`/api/reports/${reportA.id}`).expect(200);
    expect(staffView.body.id).toBe(reportA.id);
    await admin.get(`/api/reports/${reportA.id}`).expect(200);
    const ownPhoto = await residentA.get(reportA.attachmentUrl).expect(200);
    expect(Buffer.compare(ownPhoto.body, PNG)).toBe(0);

    const mine = await residentB.get("/api/reports?scope=mine").expect(200);
    expect(mine.body.reports.map((report: { id: string }) => report.id)).not.toContain(
      reportA.id,
    );
    await residentB.get("/api/reports?scope=queue").expect(403);
    await residentB.get("/api/reports?scope=all").expect(403);

    const otherQueue = await officialB.get("/api/reports?scope=queue").expect(200);
    expect(otherQueue.body.reports.map((report: { id: string }) => report.id)).not.toContain(
      reportA.id,
    );
    const ownQueue = await officialA.get("/api/reports?scope=queue").expect(200);
    const queueIds = ownQueue.body.reports.map((report: { id: string }) => report.id);
    expect(queueIds).toContain(reportA.id);
    expect(queueIds).not.toContain(reportB.id);

    await request(app).get("/api/reports/impact").expect(401);
    await residentA.get("/api/reports/impact").expect(403);
    await officialA.get("/api/reports/impact").expect(200);
  });

  it("requires the guest token bound to that report for guest reads and follow-ups", async () => {
    const { app, guestReport, guestToken, reportA, residentA, officialA } = scenario;
    const wrongToken = "A".repeat(43);

    await request(app).get(`/api/reports/${guestReport.id}/guest`).expect(404);
    await request(app)
      .get(`/api/reports/${guestReport.id}/guest`)
      .set("X-Guest-Access", wrongToken)
      .expect(404);
    await request(app)
      .get(`/api/reports/${reportA.id}/guest`)
      .set("X-Guest-Access", guestToken)
      .expect(404);
    await request(app)
      .post(`/api/reports/${guestReport.id}/guest/still-happening`)
      .set("X-Guest-Access", wrongToken)
      .expect(404);
    await request(app)
      .get(`/api/reports/${guestReport.id}/guest/attachments/${guestReport.attachmentId}`)
      .expect(404);
    await request(app)
      .get(`/api/reports/${guestReport.id}/guest/attachments/${reportA.attachmentId}`)
      .set("X-Guest-Access", guestToken)
      .expect(404);

    const tracked = await request(app)
      .get(`/api/reports/${guestReport.id}/guest`)
      .set("X-Guest-Access", guestToken)
      .expect(200);
    expect(tracked.body.referenceCode).toBe(guestReport.referenceCode);
    const photo = await request(app)
      .get(`/api/reports/${guestReport.id}/guest/attachments/${guestReport.attachmentId}`)
      .set("X-Guest-Access", guestToken)
      .expect(200);
    expect(Buffer.compare(photo.body, PNG)).toBe(0);

    await residentA.get(`/api/reports/${guestReport.id}`).expect(404);
    await officialA.get(`/api/reports/${guestReport.id}`).expect(200);
  });

  it("denies staff workflow actions on another organization's report", async () => {
    const { residentA, admin, officialA, officialB, reportA, roadsCategoryId, parksCategoryId } = scenario;
    const secrets = [reportA.referenceCode, reportA.title];

    const claim = await officialB.post(`/api/reports/${reportA.id}/claim`).expect(404);
    expectNoLeak(claim.body, secrets);
    await officialB
      .post(`/api/reports/${reportA.id}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(404);
    await officialB
      .post(`/api/reports/${reportA.id}/updates`)
      .send({ message: "Cross-organization update attempt." })
      .expect(404);
    await officialB
      .post(`/api/reports/${reportA.id}/handoff`)
      .send({ toUserId: "someone", reason: "cross organization" })
      .expect(404);
    await officialB
      .post(`/api/reports/${reportA.id}/transfer`)
      .send({ categoryId: parksCategoryId, reason: "cross organization" })
      .expect(404);
    await officialB.get(`/api/reports/${reportA.id}/handoff-options`).expect(404);

    for (const agent of [residentA, admin]) {
      await agent.post(`/api/reports/${reportA.id}/claim`).expect(403);
      await agent
        .post(`/api/reports/${reportA.id}/status`)
        .send({ status: "UNDER_REVIEW" })
        .expect(403);
      await agent
        .post(`/api/reports/${reportA.id}/updates`)
        .send({ message: "Not staff." })
        .expect(403);
    }
    await residentA.get(`/api/reports/${reportA.id}/handoff-options`).expect(403);

    // Residents, officials, and administrators cannot submit resident reports.
    await officialA
      .post("/api/reports")
      .field("categoryId", reportA.id)
      .field("title", "Official-created report attempt")
      .field("description", "An official account must not submit a resident report.")
      .field("location", "Main Street")
      .expect(403);
    await admin
      .post("/api/reports")
      .field("categoryId", reportA.id)
      .field("title", "Admin-created report attempt")
      .field("description", "An administrator must not submit a resident report.")
      .field("location", "Main Street")
      .expect(403);

    // The handling organization reaches the same routes, so the denials above
    // are authorization rather than unreachable handlers.
    await officialA.get(`/api/reports/${reportA.id}/handoff-options`).expect(200);
    const handoff = await officialA
      .post(`/api/reports/${reportA.id}/handoff`)
      .send({ toUserId: "anyone", reason: "invalid recipient" })
      .expect(422);
    expect(handoff.body.error.code).toBe("INVALID_HANDOFF");
    const transfer = await officialA
      .post(`/api/reports/${reportA.id}/transfer`)
      .send({ categoryId: roadsCategoryId, reason: "same organization" })
      .expect(422);
    expect(transfer.body.error.code).toBe("INVALID_TRANSFER");
  });

  it("keeps authorized staff workflows scoped and resident confirmations owner-only", async () => {
    const { residentA, residentB, officialA, admin, reportC } = scenario;

    await officialA.post(`/api/reports/${reportC.id}/claim`).expect(200);
    await officialA
      .post(`/api/reports/${reportC.id}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(200);
    await officialA
      .post(`/api/reports/${reportC.id}/updates`)
      .send({ message: "A crew is scheduled to inspect the fixture." })
      .expect(201);
    await officialA
      .post(`/api/reports/${reportC.id}/status`)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    await officialA
      .post(`/api/reports/${reportC.id}/status`)
      .send({ status: "RESOLVED" })
      .expect(200);

    const options = await officialA
      .get(`/api/reports/${reportC.id}/handoff-options`)
      .expect(200);
    expect(JSON.stringify(options.body)).not.toContain("Parker Parks");
    expect(JSON.stringify(options.body)).not.toContain("official-b@example.test");

    await residentB.post(`/api/reports/${reportC.id}/confirm-fixed`).expect(404);
    await officialA.post(`/api/reports/${reportC.id}/confirm-fixed`).expect(403);
    await admin.post(`/api/reports/${reportC.id}/confirm-fixed`).expect(403);
    await residentA
      .post(`/api/reports/${reportC.id}/confirm-fixed`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.reporterConfirmation).toBe("FIXED");
      });
  });

  it("restricts moderation to administrators", async () => {
    const { app, residentA, officialA, admin, reportA } = scenario;

    await request(app)
      .post(`/api/reports/${reportA.id}/moderation`)
      .send({ moderationStatus: "HIDDEN" })
      .expect(401);
    await residentA
      .post(`/api/reports/${reportA.id}/moderation`)
      .send({ moderationStatus: "HIDDEN" })
      .expect(403);
    await officialA
      .post(`/api/reports/${reportA.id}/moderation`)
      .send({ moderationStatus: "HIDDEN" })
      .expect(403);

    await admin
      .post(`/api/reports/${reportA.id}/moderation`)
      .send({ moderationStatus: "HIDDEN" })
      .expect(200);
    await officialA.get(`/api/reports/${reportA.id}`).expect(404);
    await residentA.get(`/api/reports/${reportA.id}`).expect(200);
    await admin
      .post(`/api/reports/${reportA.id}/moderation`)
      .send({ moderationStatus: "VISIBLE" })
      .expect(200);
  });

  it("rejects every administrator endpoint for non-admins and validates admin targets", async () => {
    const { app, admin, residentA, officialA, residentBId, spareId, publicWorksId } =
      scenario;
    const endpoints = [
      "/api/admin/overview",
      "/api/admin/users",
      "/api/admin/organizations",
      "/api/admin/categories",
      "/api/admin/audit",
    ];

    for (const endpoint of endpoints) {
      await request(app).get(endpoint).expect(401);
      const residentAttempt = await residentA.get(endpoint).expect(403);
      expectNoLeak(residentAttempt.body, ["owner@example.test", "official-a@example.test"]);
      await officialA.get(endpoint).expect(403);
    }

    await residentA
      .post(`/api/admin/users/${residentBId}/verify`)
      .send({ role: "RESIDENT" })
      .expect(403);
    await officialA
      .post(`/api/admin/users/${residentBId}/verify`)
      .send({ role: "RESIDENT" })
      .expect(403);
    await admin
      .post(`/api/admin/users/${residentBId}/verify`)
      .send({ role: "RESIDENT" })
      .expect(200);

    await admin
      .post(`/api/admin/users/${spareId}/verify`)
      .send({ role: "OFFICIAL", organizationId: publicWorksId })
      .expect(200);
    await residentA
      .post(`/api/admin/users/${spareId}/status`)
      .send({ status: "SUSPENDED" })
      .expect(403);
    await officialA
      .post(`/api/admin/users/${spareId}/status`)
      .send({ status: "SUSPENDED" })
      .expect(403);
    await admin
      .post(`/api/admin/users/${spareId}/status`)
      .send({ status: "SUSPENDED" })
      .expect(200);

    await residentA
      .post("/api/admin/organizations")
      .send({ name: "Resident Organization", kind: "PUBLIC_SERVICE" })
      .expect(403);
    await officialA
      .post("/api/admin/organizations")
      .send({ name: "Official Organization", kind: "PUBLIC_SERVICE" })
      .expect(403);
    const organization = await admin
      .post("/api/admin/organizations")
      .send({ name: "Water Department", kind: "PUBLIC_SERVICE" })
      .expect(201);
    const waterId = organization.body.organization.id as string;

    const category = await admin
      .post("/api/admin/categories")
      .send({ name: "Water Leaks", description: "Leaks and outages", organizationId: waterId })
      .expect(201);
    const leakId = category.body.category.id as string;

    await residentA
      .post(`/api/admin/categories/${leakId}/active`)
      .send({ active: false })
      .expect(403);
    await admin
      .post(`/api/admin/categories/${leakId}/active`)
      .send({ active: false })
      .expect(200);
    await residentA
      .post(`/api/admin/organizations/${waterId}/active`)
      .send({ active: false })
      .expect(403);
    await admin
      .post(`/api/admin/organizations/${waterId}/active`)
      .send({ active: false })
      .expect(200);

    await admin
      .post("/api/admin/users/missing-user/verify")
      .send({ role: "RESIDENT" })
      .expect(404)
      .expect(({ body }) => {
        expect(body.error.code).toBe("USER_NOT_FOUND");
      });
    await admin
      .post("/api/admin/users/missing-user/status")
      .send({ status: "SUSPENDED" })
      .expect(404);
    await admin
      .post("/api/admin/organizations/missing-organization/active")
      .send({ active: false })
      .expect(404)
      .expect(({ body }) => {
        expect(body.error.code).toBe("ORGANIZATION_NOT_FOUND");
      });
    await admin
      .post("/api/admin/categories/missing-category/active")
      .send({ active: false })
      .expect(404)
      .expect(({ body }) => {
        expect(body.error.code).toBe("CATEGORY_NOT_FOUND");
      });
  });

  it("exposes no report delete endpoint, and delete attempts leave the report intact", async () => {
    const { residentA, officialA, admin, reportA } = scenario;

    await residentA.delete(`/api/reports/${reportA.id}`).expect(404);
    await officialA.delete(`/api/reports/${reportA.id}`).expect(404);
    await admin.delete(`/api/reports/${reportA.id}`).expect(404);
    await residentA.get(`/api/reports/${reportA.id}`).expect(200);
  });

  it("keeps photo analysis free of report data and account context", async () => {
    const { app, residentA } = scenario;

    const anonymous = await request(app)
      .post("/api/reports/analyze-photo")
      .attach("photo", PNG, { filename: "analysis.png", contentType: "image/png" })
      .expect(503);
    expect(anonymous.body.error.code).toBe("AI_NOT_CONFIGURED");
    expectNoLeak(anonymous.body, [
      "owner@example.test",
      "Pothole beside the school crossing",
    ]);

    const resident = await residentA
      .post("/api/reports/analyze-photo")
      .attach("photo", PNG, { filename: "analysis.png", contentType: "image/png" })
      .expect(503);
    expect(resident.body.error.code).toBe("AI_NOT_CONFIGURED");
    expectNoLeak(resident.body, [
      "owner@example.test",
      "Pothole beside the school crossing",
    ]);
  });
});

describe("follow-up authorization", () => {
  let app: Express;
  let residentA: Agent;
  let residentB: Agent;
  let residentReport: ReportRef;
  let guestReport: ReportRef;
  let guestToken: string;

  beforeAll(async () => {
    app = await testApplication();
    await setupAdministrator(app);
    residentA = await register(app, {
      displayName: "Fiona Followup",
      email: "followup-owner@example.test",
      password: "a follow-up owner password",
    });
    residentB = await register(app, {
      displayName: "Nora Nonowner",
      email: "followup-stranger@example.test",
      password: "a follow-up stranger password",
    });

    const categories = (await residentA.get("/api/categories").expect(200)).body
      .categories as Array<{ id: string; name: string }>;
    const roads = categories.find((category) => category.name === "Roads and Sidewalks")!.id;

    residentReport = await createReport(
      residentA,
      roads,
      "Cracked pavement near the bus stop",
      "The pavement beside the bus stop has cracked and lifted.",
      "Central Avenue bus stop",
    );

    setTestPhotoAnalysis({
      categoryId: roads,
      title: "Overflowing public bin at the plaza",
      description: "The public bin beside the plaza entrance is overflowing.",
    });
    const guest = await request(app)
      .post("/api/reports/guest")
      .field("location", "Civic Plaza entrance")
      .field("latitude", "39.7817")
      .field("longitude", "-89.6501")
      .attach("photo", PNG, { filename: "guest.png", contentType: "image/png" })
      .expect(201);
    guestReport = reportRef(guest.body);
    guestToken = guest.body.guestAccessToken as string;
  });

  it("binds every guest follow-up route to its own report token", async () => {
    const wrongToken = "B".repeat(43);

    await request(app)
      .post(`/api/reports/${guestReport.id}/guest/confirm-fixed`)
      .set("X-Guest-Access", wrongToken)
      .expect(404);
    await request(app)
      .post(`/api/reports/${guestReport.id}/guest/confirm-unknown`)
      .set("X-Guest-Access", wrongToken)
      .expect(404);
    await request(app)
      .post(`/api/reports/${residentReport.id}/guest/confirm-fixed`)
      .set("X-Guest-Access", guestToken)
      .expect(404);
  });

  it("rejects resident follow-ups from a non-owner", async () => {
    await residentB
      .post(`/api/reports/${residentReport.id}/still-happening`)
      .expect(404);
    await residentB
      .post(`/api/reports/${residentReport.id}/confirm-unknown`)
      .expect(404);
    await residentA.get(`/api/reports/${residentReport.id}`).expect(200);
  });
});

describe("notification and account isolation", () => {
  let app: Express;
  let residentA: Agent;
  let residentB: Agent;
  let report: ReportRef;
  let notificationId: string;

  beforeAll(async () => {
    app = await testApplication();
    const admin = await setupAdministrator(app);
    residentA = await register(app, {
      displayName: "Nina Notified",
      email: "notify-a@example.test",
      password: "a notified resident password",
    });
    residentB = await register(app, {
      displayName: "Ben Bystander",
      email: "notify-b@example.test",
      password: "a bystander resident password",
    });

    const organizations = (await request(app).get("/api/organizations").expect(200)).body
      .organizations as Array<{ id: string; name: string }>;
    const publicWorksId = organizations.find(
      (organization) => organization.name === "Public Works",
    )!.id;
    const official = await registerStaff(app, {
      displayName: "Owen Official",
      email: "notify-official@example.test",
      password: "a notifying official password",
      organizationId: publicWorksId,
    });
    const users = (await admin.get("/api/admin/users").expect(200)).body.users as Array<{
      id: string;
      email: string;
    }>;
    const officialId = users.find(
      (user) => user.email === "notify-official@example.test",
    )!.id;
    await admin
      .post(`/api/admin/users/${officialId}/verify`)
      .send({ role: "OFFICIAL", organizationId: publicWorksId })
      .expect(200);

    const categories = (await residentA.get("/api/categories").expect(200)).body
      .categories as Array<{ id: string; name: string }>;
    const roads = categories.find(
      (category) => category.name === "Roads and Sidewalks",
    )!.id;
    report = await createReport(
      residentA,
      roads,
      "Leaking hydrant near the library",
      "Water is pooling around the hydrant beside the library steps.",
      "Library entrance",
    );

    await official.post(`/api/reports/${report.id}/claim`).expect(200);
    await official
      .post(`/api/reports/${report.id}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(200);
    const notifications = await residentA.get("/api/notifications").expect(200);
    notificationId = notifications.body.notifications[0].id as string;
    expect(notificationId).toBeTruthy();
  });

  it("isolates notification lists and read state between accounts", async () => {
    const own = await residentA.get("/api/notifications").expect(200);
    expect(own.body.notifications.map((entry: { id: string }) => entry.id)).toContain(
      notificationId,
    );
    expect(own.body.notifications[0]).toMatchObject({ id: notificationId, read: false });
    const unreadBefore = own.body.unreadCount as number;
    expect(unreadBefore).toBeGreaterThan(0);

    const stranger = await residentB.get("/api/notifications").expect(200);
    expect(stranger.body.notifications).toEqual([]);
    expect(stranger.body.unreadCount).toBe(0);

    const denied = await residentB
      .post(`/api/notifications/${notificationId}/read`)
      .expect(404);
    expect(denied.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
    expectNoLeak(denied.body, [report.referenceCode, report.title]);

    await residentB.post("/api/notifications/read-all").expect(204);
    const untouched = await residentA.get("/api/notifications").expect(200);
    expect(untouched.body.notifications[0]).toMatchObject({ id: notificationId, read: false });
    expect(untouched.body.unreadCount).toBe(unreadBefore);

    await residentA.post(`/api/notifications/${notificationId}/read`).expect(204);
    const read = await residentA.get("/api/notifications").expect(200);
    expect(read.body.notifications[0]).toMatchObject({ id: notificationId, read: true });
    expect(read.body.unreadCount).toBe(unreadBefore - 1);
  });

  it("does not let an account read or delete another account's push subscription", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/notification-isolation";
    const keys = { p256dh: "A".repeat(87), auth: "B".repeat(22) };

    const rejected = await residentA
      .put("/api/notifications/push/subscription")
      .send({ endpoint: "https://evil.example/push", keys })
      .expect(422);
    expect(rejected.body.error.code).toBe("INVALID_PUSH_ENDPOINT");

    await residentA
      .put("/api/notifications/push/subscription")
      .send({ endpoint, keys })
      .expect(204);
    expect(
      (await residentA.get("/api/notifications/push/config").expect(200)).body.deviceCount,
    ).toBe(1);
    expect(
      (await residentB.get("/api/notifications/push/config").expect(200)).body.deviceCount,
    ).toBe(0);

    await residentB
      .delete("/api/notifications/push/subscription")
      .send({ endpoint })
      .expect(204);
    expect(
      (await residentA.get("/api/notifications/push/config").expect(200)).body.deviceCount,
    ).toBe(1);

    await residentA
      .delete("/api/notifications/push/subscription")
      .send({ endpoint })
      .expect(204);
    expect(
      (await residentA.get("/api/notifications/push/config").expect(200)).body.deviceCount,
    ).toBe(0);
  });

  it("ignores mass-assignment fields and keeps account state per user", async () => {
    const beforeA = await residentA.get("/api/auth/session").expect(200);
    const originalA = beforeA.body.user as { id: string; displayName: string };

    await residentB
      .patch("/api/auth/profile")
      .send({
        displayName: "Renamed Bystander",
        id: originalA.id,
        role: "ADMIN",
        email: "notify-a@example.test",
      })
      .expect(200);

    const afterA = await residentA.get("/api/auth/session").expect(200);
    expect(afterA.body.user).toMatchObject({
      displayName: originalA.displayName,
      email: "notify-a@example.test",
      role: "RESIDENT",
    });

    const afterB = await residentB.get("/api/auth/session").expect(200);
    expect(afterB.body.user).toMatchObject({
      displayName: "Renamed Bystander",
      email: "notify-b@example.test",
      role: "RESIDENT",
    });

    await request(app).get("/api/notifications").expect(401);
    await request(app).get("/api/notifications/push/config").expect(401);
    await request(app)
      .patch("/api/auth/profile")
      .send({ displayName: "Anonymous" })
      .expect(401);
    await request(app)
      .put("/api/notifications/push/subscription")
      .send({
        endpoint: "https://fcm.googleapis.com/fcm/send/anonymous",
        keys: { p256dh: "C".repeat(87), auth: "D".repeat(22) },
      })
      .expect(401);
  });
});
