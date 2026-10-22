// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupApplications, setupAdministrator, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("authentication", () => {
  it("marks session, setup, and protected API responses private and non-cacheable", async () => {
    const app = await testApplication();

    for (const response of await Promise.all([
      request(app).get("/api/auth/session"),
      request(app).get("/api/setup/status"),
      request(app).get("/api/reports"),
    ])) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    expect((await request(app).get("/api/reports")).status).toBe(401);
  });

  it("limits repeated sign-in attempts from one client", async () => {
    const app = await testApplication();
    const attempts = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      attempts.push(await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@example.test", password: "wrong" }));
    }

    expect(attempts.slice(0, 10).every((response) => response.status === 401)).toBe(true);
    expect(attempts[10].status).toBe(429);
    expect(attempts[10].headers["cache-control"]).toBe("private, no-store");
    expect(attempts[10].body.error.code).toBe("RATE_LIMITED");
  });

  it("registers residents, rejects duplicates and self-declared administrators", async () => {
    const app = await testApplication();

    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({
        displayName: "Rita Resident",
        email: "resident@example.test",
        password: "a resident account password",
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({
          role: "RESIDENT",
          status: "ACTIVE",
          email: "resident@example.test",
        });
      });

    await request(app)
      .post("/api/auth/register")
      .send({
        displayName: "Copy Cat",
        email: "RESIDENT@example.test",
        password: "a resident account password",
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("EMAIL_TAKEN");
      });

    await request(app)
      .post("/api/auth/register")
      .send({
        displayName: "Sneaky Admin",
        email: "sneaky@example.test",
        password: "a resident account password",
        role: "ADMIN",
      })
      .expect(422);

    await request(app)
      .post("/api/auth/register")
      .send({
        displayName: "Confused Resident",
        email: "confused@example.test",
        password: "a resident account password",
        role: "RESIDENT",
        organizationId: "some-organization",
      })
      .expect(422);

    await request(app)
      .post("/api/auth/register")
      .send({
        displayName: "Short Password",
        email: "short@example.test",
        password: "short",
      })
      .expect(422);
  });

  it("signs users in and out and reports the current session", async () => {
    const app = await testApplication();
    await setupAdministrator(app);

    await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@example.test", password: "wrong password attempt" })
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe("INVALID_CREDENTIALS");
      });

    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({
        email: "admin@example.test",
        password: "correct horse battery staple",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ role: "ADMIN" });
      });

    await agent
      .get("/api/auth/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ email: "admin@example.test" });
      });

    await agent.post("/api/auth/logout").expect(204);

    await agent
      .get("/api/auth/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toBeNull();
      });

    await request(app)
      .get("/api/reports")
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe("AUTH_REQUIRED");
      });
  });
});
