// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SESSION_TTL_MS, resolveSessionTtlMs } from "../../server/session";
import { ADMIN_CREDENTIALS, cleanupApplications, setupAdministrator, testApplication } from "./helpers";

function cookiesFrom(response: { headers: Record<string, unknown> }): string[] {
  const value = response.headers["set-cookie"];
  if (Array.isArray(value)) return value.map(String);
  return value === undefined ? [] : [String(value)];
}

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

  it("issues new sessions that last two hours", async () => {
    const app = await testApplication();
    const response = await request(app)
      .post("/api/setup")
      .send(ADMIN_CREDENTIALS)
      .expect(201);

    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain("civicsignal_session=");
    expect(cookie).not.toContain("__Host-");
    expect(cookie).toContain("Max-Age=7200");
    expect(DEFAULT_SESSION_TTL_MS).toBe(7_200_000);
  });

  it("uses a __Host- session cookie in production and clears it consistently", async () => {
    const app = await testApplication({ secureCookies: true });
    const setup = await request(app).post("/api/setup").send(ADMIN_CREDENTIALS).expect(201);
    const setupCookies = cookiesFrom(setup);
    const hardened = setupCookies.find((cookie) =>
      cookie.startsWith("__Host-civicsignal_session="),
    );

    expect(hardened).toBeDefined();
    expect(hardened).toContain("Path=/");
    expect(hardened).toContain("Secure");
    expect(hardened).toContain("HttpOnly");
    expect(hardened).toContain("SameSite=Lax");
    // The app must not issue an unprefixed session value in production mode.
    expect(setupCookies.some((cookie) => /^civicsignal_session=[^;]/.test(cookie))).toBe(false);

    const pair = hardened!.split(";")[0];
    const token = pair.slice(pair.indexOf("=") + 1);

    await request(app)
      .get("/api/auth/session")
      .set("Cookie", pair)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ email: ADMIN_CREDENTIALS.email });
      });

    // A subdomain-planted unprefixed cookie cannot authenticate in production.
    await request(app)
      .get("/api/auth/session")
      .set("Cookie", `civicsignal_session=${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toBeNull();
      });
    await request(app)
      .get("/api/reports")
      .set("Cookie", `civicsignal_session=${token}`)
      .expect(401);

    // Sign-in uses the same hardened name and drops a legacy cookie.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN_CREDENTIALS.email, password: ADMIN_CREDENTIALS.password })
      .expect(200);
    const loginCookies = cookiesFrom(login);
    expect(
      loginCookies.some((cookie) => cookie.startsWith("__Host-civicsignal_session=")),
    ).toBe(true);
    expect(loginCookies.some((cookie) => cookie.startsWith("civicsignal_session=;"))).toBe(true);

    // Sign-out clears the hardened cookie and ends the session server-side.
    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", pair)
      .expect(204);
    expect(
      cookiesFrom(logout).some(
        (cookie) =>
          cookie.startsWith("__Host-civicsignal_session=;") &&
          cookie.includes("Expires=Thu, 01 Jan 1970"),
      ),
    ).toBe(true);

    await request(app)
      .get("/api/auth/session")
      .set("Cookie", pair)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toBeNull();
      });
  });

  it("keeps the default lifetime when SESSION_TTL_HOURS is unusable", () => {
    for (const value of [undefined, "", "  ", "soon", "0", "-3", "Infinity"]) {
      expect(resolveSessionTtlMs({ SESSION_TTL_HOURS: value })).toBe(DEFAULT_SESSION_TTL_MS);
    }
    expect(resolveSessionTtlMs({ SESSION_TTL_HOURS: "8" })).toBe(28_800_000);
  });

  it("rejects state-changing requests that come from another site", async () => {
    const app = await testApplication();
    await setupAdministrator(app);

    await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: "admin@example.test", password: "correct horse battery staple" })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe("CROSS_ORIGIN_REQUEST");
      });

    await request(app)
      .post("/api/auth/login")
      .set("Host", "civicsignal.example")
      .set("Origin", "http://civicsignal.example")
      .send({ email: "admin@example.test", password: "correct horse battery staple" })
      .expect(200);
  });

  it("revokes other sessions when the password changes", async () => {
    const app = await testApplication();
    await setupAdministrator(app);

    const first = request.agent(app);
    const second = request.agent(app);
    for (const agent of [first, second]) {
      await agent
        .post("/api/auth/login")
        .send({ email: "admin@example.test", password: "correct horse battery staple" })
        .expect(200);
    }

    await first
      .patch("/api/auth/password")
      .send({
        currentPassword: "correct horse battery staple",
        newPassword: "a brand new administrator password",
      })
      .expect(200);

    await first
      .get("/api/auth/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).not.toBeNull();
      });

    await second
      .get("/api/auth/session")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toBeNull();
      });
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
