// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { ADMIN_CREDENTIALS, cleanupApplications, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("first-run setup", () => {
  it("bootstraps only the first administrator once", async () => {
    const app = await testApplication();

    await request(app)
      .get("/api/setup/status")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ setupRequired: true });
      });

    const agent = request.agent(app);
    await agent.post("/api/setup").send(ADMIN_CREDENTIALS).expect(201);

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

  it("starts without placeholder organizations or categories", async () => {
    const app = await testApplication();

    const setup = await request(app).post("/api/setup").send(ADMIN_CREDENTIALS);

    expect(setup.status).toBe(201);
    expect(setup.body.user).toMatchObject({
      email: ADMIN_CREDENTIALS.email,
      role: "ADMIN",
      status: "ACTIVE",
    });
    expect(setup.body.organizations).toEqual([]);
    expect(setup.body.categories).toEqual([]);
  });
});
