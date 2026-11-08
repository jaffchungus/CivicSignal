// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupApplications,
  setupAdministrator,
  testApplicationWithUploads,
} from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("guest reporting and secure follow-up", () => {
  it("creates a routed report without an account and protects tracking with its one-time token", async () => {
    const { app } = await testApplicationWithUploads();
    await setupAdministrator(app);
    const { body: catalog } = await request(app).get("/api/categories").expect(200);
    await request(app)
      .get("/api/routing/readiness")
      .expect(200)
      .expect(({ body }) => {
        expect(body.jurisdiction.status).toBe("unavailable");
        expect(body.externalNotifications.status).toBe("unavailable");
      });
    const category = catalog.categories.find((entry: { name: string }) => entry.name === "Roads and Sidewalks");

    const created = await request(app)
      .post("/api/reports/guest")
      .field("categoryId", category.id)
      .field("title", "Pothole at Main Street crossing")
      .field("description", "A deep pothole is filling with water beside the crosswalk.")
      .field("location", "Main Street and 4th Avenue")
      .attach("photo", Buffer.from(PNG_BASE64, "base64"), { filename: "pothole.png", contentType: "image/png" })
      .expect(201);

    expect(created.body).toMatchObject({
      title: "Pothole at Main Street crossing",
      description: "A deep pothole is filling with water beside the crosswalk.",
      reporter: { id: null, displayName: "Guest resident" },
      status: "SUBMITTED",
      assignedTo: null,
    });
    expect(created.body.organization.name).toBe("Public Works");
    expect(created.body.guestAccessToken).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    await request(app).get(`/api/reports/${created.body.id}`).expect(401);
    await request(app).get(`/api/reports/${created.body.id}/guest`).expect(404);
    await request(app)
      .get(`/api/reports/${created.body.id}/guest`)
      .set("X-Guest-Access", created.body.guestAccessToken)
      .expect(200)
      .expect(({ body }) => expect(body.referenceCode).toBe(created.body.referenceCode));

    await request(app)
      .post(`/api/reports/${created.body.id}/guest/still-happening`)
      .set("X-Guest-Access", created.body.guestAccessToken)
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("FOLLOW_UP_NOT_AVAILABLE");
      });

    const other = await request(app)
      .post("/api/reports/guest")
      .field("categoryId", category.id)
      .field("title", "Broken pavement on Oak Street")
      .field("description", "Loose pavement is a trip hazard near the curb.")
      .field("location", "Oak Street")
      .attach("photo", Buffer.from(PNG_BASE64, "base64"), { filename: "road.png", contentType: "image/png" })
      .expect(201);
    await request(app)
      .get(`/api/reports/${other.body.id}/guest`)
      .set("X-Guest-Access", created.body.guestAccessToken)
      .expect(404);
  });

  it("keeps guest photos private and records follow-up without changing the official status", async () => {
    const { app } = await testApplicationWithUploads();
    const admin = await setupAdministrator(app);
    const { body: organizations } = await request(app).get("/api/organizations").expect(200);
    const publicWorks = organizations.organizations.find(
      (organization: { name: string }) => organization.name === "Public Works",
    );
    const official = request.agent(app);
    await official.post("/api/auth/register").send({
      displayName: "Guest Follow-up Official",
      email: "guest-follow-up@example.test",
      password: "a verified official password",
      role: "OFFICIAL",
      organizationId: publicWorks.id,
    }).expect(201);
    const { body: adminUsers } = await admin.get("/api/admin/users").expect(200);
    const officialUser = adminUsers.users.find(
      (user: { email: string }) => user.email === "guest-follow-up@example.test",
    );
    await admin.post(`/api/admin/users/${officialUser.id}/verify`).send({
      role: "OFFICIAL",
      organizationId: publicWorks.id,
    }).expect(200);

    const { body: catalog } = await request(app).get("/api/categories").expect(200);
    const category = catalog.categories.find(
      (item: { name: string }) => item.name === "Roads and Sidewalks",
    );
    const png = Buffer.from(PNG_BASE64, "base64");
    const created = await request(app)
      .post("/api/reports/guest")
      .field("categoryId", category.id)
      .field("title", "Broken fixture at the library entrance")
      .field("description", "The entrance fixture is loose and could fall.")
      .field("location", "Library entrance")
      .attach("photo", png, { filename: "issue.png", contentType: "image/png" })
      .expect(201);
    const attachment = created.body.attachments[0];

    await request(app).get(attachment.url).expect(401);
    const photo = await request(app)
      .get(`/api/reports/${created.body.id}/guest/attachments/${attachment.id}`)
      .set("X-Guest-Access", created.body.guestAccessToken)
      .expect(200);
    expect(Buffer.compare(photo.body, png)).toBe(0);

    await official.post(`/api/reports/${created.body.id}/claim`).expect(200);
    for (const status of ["UNDER_REVIEW", "IN_PROGRESS", "RESOLVED"]) {
      await official
        .post(`/api/reports/${created.body.id}/status`)
        .send({ status })
        .expect(200);
    }

    const followedUp = await request(app)
      .post(`/api/reports/${created.body.id}/guest/still-happening`)
      .set("X-Guest-Access", created.body.guestAccessToken)
      .expect(200);
    expect(followedUp.body).toMatchObject({
      status: "RESOLVED",
      reporterConfirmation: "STILL_HAPPENING",
      followUpNeeded: true,
    });
    expect(followedUp.body.timeline.some((event: { action: string }) => event.action === "REPORT_STILL_HAPPENING")).toBe(true);
    await request(app)
      .post(`/api/reports/${created.body.id}/guest/still-happening`)
      .set("X-Guest-Access", "incorrect-token")
      .expect(404);
  });
});
