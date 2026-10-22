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
      .send({ categoryId: category.id, location: "Main Street and 4th Avenue" })
      .expect(201);

    expect(created.body).toMatchObject({
      title: "Roads and Sidewalks issue",
      description: "",
      reporter: { id: null, displayName: "Guest resident" },
      status: "SUBMITTED",
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

    const other = await request(app)
      .post("/api/reports/guest")
      .send({ categoryId: category.id, location: "Oak Street" })
      .expect(201);
    await request(app)
      .get(`/api/reports/${other.body.id}/guest`)
      .set("X-Guest-Access", created.body.guestAccessToken)
      .expect(404);
  });

  it("keeps guest photos private and records a resident still-happening confirmation", async () => {
    const { app } = await testApplicationWithUploads();
    await setupAdministrator(app);
    const { body: catalog } = await request(app).get("/api/categories").expect(200);
    const category = catalog.categories[0];
    const png = Buffer.from(PNG_BASE64, "base64");
    const created = await request(app)
      .post("/api/reports/guest")
      .field("categoryId", category.id)
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

    const followedUp = await request(app)
      .post(`/api/reports/${created.body.id}/guest/still-happening`)
      .set("X-Guest-Access", created.body.guestAccessToken)
      .expect(200);
    expect(followedUp.body.timeline.some((event: { action: string }) => event.action === "REPORT_STILL_HAPPENING")).toBe(true);
    await request(app)
      .post(`/api/reports/${created.body.id}/guest/still-happening`)
      .set("X-Guest-Access", "incorrect-token")
      .expect(404);
  });
});
