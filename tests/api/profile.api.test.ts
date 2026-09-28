// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupApplications, setupAdministrator, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("profile management", () => {
  it("requires a signed-in user", async () => {
    const app = await testApplication();

    await request(app)
      .patch("/api/auth/profile")
      .send({ displayName: "Rita Resident" })
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe("AUTH_REQUIRED");
      });

    await request(app)
      .patch("/api/auth/password")
      .send({ currentPassword: "a resident account password", newPassword: "another account password" })
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe("AUTH_REQUIRED");
      });
  });

  it("updates the display name and records an audit entry", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);

    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({
        displayName: "Rita Resident",
        email: "resident@example.test",
        password: "a resident account password",
      })
      .expect(201);

    await agent
      .patch("/api/auth/profile")
      .send({ displayName: "Rita R. Resident" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({
          displayName: "Rita R. Resident",
          email: "resident@example.test",
          role: "RESIDENT",
        });
      });

    await agent
      .get("/api/auth/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user.displayName).toBe("Rita R. Resident");
      });

    await agent
      .patch("/api/auth/profile")
      .send({ displayName: " " })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.fieldErrors.displayName).toBeDefined();
      });

    const { body: audit } = await admin.get("/api/admin/audit").expect(200);
    expect(
      audit.entries.some((entry: { action: string }) => entry.action === "PROFILE_UPDATED"),
    ).toBe(true);
  });

  it("changes the password only with the current password and rejects weak input", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);

    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({
        displayName: "Rita Resident",
        email: "resident@example.test",
        password: "a resident account password",
      })
      .expect(201);

    await agent
      .patch("/api/auth/password")
      .send({
        currentPassword: "not the current password",
        newPassword: "a replacement account password",
      })
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe("INVALID_CREDENTIALS");
      });

    await agent
      .patch("/api/auth/password")
      .send({ currentPassword: "a resident account password", newPassword: "short" })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.fieldErrors.newPassword).toBeDefined();
      });

    await agent
      .patch("/api/auth/password")
      .send({
        currentPassword: "a resident account password",
        newPassword: "a replacement account password",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ email: "resident@example.test" });
      });

    await request(app)
      .post("/api/auth/login")
      .send({ email: "resident@example.test", password: "a resident account password" })
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe("INVALID_CREDENTIALS");
      });

    await request(app)
      .post("/api/auth/login")
      .send({ email: "resident@example.test", password: "a replacement account password" })
      .expect(200);

    const { body: audit } = await admin.get("/api/admin/audit").expect(200);
    expect(
      audit.entries.some((entry: { action: string }) => entry.action === "PASSWORD_CHANGED"),
    ).toBe(true);
    // bcrypt cost-12 hashing makes this the slowest test in the suite.
  }, 15_000);
});
