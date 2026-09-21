// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";

const temporaryDirectories: string[] = [];

async function testApplication() {
  const directory = await mkdtemp(path.join(tmpdir(), "civicsignal-api-"));
  temporaryDirectories.push(directory);

  return createApp({
    databasePath: path.join(directory, "test.sqlite"),
    uploadDirectory: path.join(directory, "uploads"),
    secureCookies: false,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("first-run setup", () => {
  it("bootstraps the first administrator and default civic routing once", async () => {
    const app = await testApplication();
    const agent = request.agent(app);

    await agent
      .get("/api/setup/status")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ setupRequired: true });
      });

    const setup = await agent.post("/api/setup").send({
      municipalityName: "Springfield",
      displayName: "Platform Administrator",
      email: "admin@example.test",
      password: "correct horse battery staple",
    });

    expect(setup.status).toBe(201);
    expect(setup.body.user).toMatchObject({
      email: "admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
    });
    expect(setup.body.organizations).toHaveLength(3);
    expect(setup.body.categories.length).toBeGreaterThanOrEqual(5);

    await agent
      .get("/api/auth/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ role: "ADMIN" });
      });

    await request(app)
      .post("/api/setup")
      .send({
        municipalityName: "Other",
        displayName: "Other Admin",
        email: "other@example.test",
        password: "another correct horse battery staple",
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("ALREADY_INITIALIZED");
      });
  });
});
