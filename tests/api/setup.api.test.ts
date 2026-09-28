// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { ADMIN_CREDENTIALS, cleanupApplications, setupAdministrator, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("first-run setup", () => {
  it("bootstraps the first administrator and default civic routing once", async () => {
    const app = await testApplication();

    await request(app)
      .get("/api/setup/status")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ setupRequired: true });
      });

    const agent = await setupAdministrator(app);

    await agent
      .get("/api/auth/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ role: "ADMIN" });
      });

    await request(app)
      .post("/api/setup")
      .send({
        ...ADMIN_CREDENTIALS,
        municipalityName: "Other",
        displayName: "Other Admin",
        email: "other@example.test",
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("ALREADY_INITIALIZED");
      });
  });

  it("returns the default organizations and categories for the client", async () => {
    const app = await testApplication();

    const setup = await request(app).post("/api/setup").send(ADMIN_CREDENTIALS);

    expect(setup.status).toBe(201);
    expect(setup.body.user).toMatchObject({
      email: ADMIN_CREDENTIALS.email,
      role: "ADMIN",
      status: "ACTIVE",
    });
    expect(setup.body.organizations).toHaveLength(3);
    expect(setup.body.organizations[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      kind: expect.stringMatching(/^(PUBLIC_SERVICE|LAW_ENFORCEMENT)$/),
      active: true,
    });
    expect(setup.body.categories.length).toBeGreaterThanOrEqual(5);
  });
});
