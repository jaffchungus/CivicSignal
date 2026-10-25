// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupApplications, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("request origin protection", () => {
  it("rejects unsafe API requests from another origin without blocking non-browser clients", async () => {
    const app = await testApplication();
    const host = "civicsignal.example";

    await request(app)
      .post("/api/auth/logout")
      .set("Host", host)
      .set("Origin", `http://${host}`)
      .expect(204);
    await request(app).post("/api/auth/logout").expect(204);

    await request(app)
      .post("/api/auth/logout")
      .set("Host", host)
      .set("Origin", "https://attacker.example")
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe("INVALID_ORIGIN");
      });
    await request(app)
      .post("/api/auth/logout")
      .set("Host", host)
      .set("Origin", "null")
      .expect(403);
    await request(app)
      .post("/api/auth/logout")
      .set("Host", host)
      .set("Referer", "https://attacker.example/page")
      .expect(403);

    await request(app)
      .get("/api/categories")
      .set("Host", host)
      .set("Origin", "https://attacker.example")
      .expect(200);
  });
});
