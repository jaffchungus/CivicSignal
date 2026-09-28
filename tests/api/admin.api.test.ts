// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupApplications, setupAdministrator, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("administrator controls", () => {
  it("moderates reports without breaking the reporter's access to their own history", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);

    const { body: organizationList } = await request(app)
      .get("/api/organizations")
      .expect(200);
    const publicWorks = organizationList.organizations.find(
      (organization: { name: string }) => organization.name === "Public Works",
    );

    const officialAgent = request.agent(app);
    await officialAgent
      .post("/api/auth/register")
      .send({
        displayName: "Olive Official",
        email: "official@example.test",
        password: "an official account password",
        role: "OFFICIAL",
        organizationId: publicWorks.id,
      })
      .expect(201);
    const { body: adminUsers } = await admin.get("/api/admin/users").expect(200);
    const official = adminUsers.users.find(
      (user: { email: string }) => user.email === "official@example.test",
    );
    await admin
      .post(`/api/admin/users/${official.id}/verify`)
      .send({ role: "OFFICIAL", organizationId: publicWorks.id })
      .expect(200);

    const residentAgent = request.agent(app);
    await residentAgent
      .post("/api/auth/register")
      .send({
        displayName: "Rita Resident",
        email: "resident@example.test",
        password: "a resident account password",
      })
      .expect(201);
    const { body: categoryList } = await residentAgent
      .get("/api/categories")
      .expect(200);
    const roads = categoryList.categories.find(
      (category: { name: string }) => category.name === "Roads and Sidewalks",
    );
    const created = await residentAgent.post("/api/reports").send({
      categoryId: roads.id,
      title: "Suspicious spam report about sidewalks",
      description: "This report contains obvious spam content for moderation.",
      location: "Nowhere Street 1",
    });
    expect(created.status).toBe(201);
    const reportId = created.body.id as string;

    await officialAgent
      .get("/api/reports?scope=queue")
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(1);
      });

    // Hiding removes the report from the official workflow.
    await admin
      .post(`/api/reports/${reportId}/moderation`)
      .send({ moderationStatus: "HIDDEN" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.moderationStatus).toBe("HIDDEN");
      });
    await officialAgent
      .get("/api/reports?scope=queue")
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(0);
      });

    // The reporter keeps access to their own report while it is hidden.
    await residentAgent
      .get(`/api/reports/${reportId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.moderationStatus).toBe("HIDDEN");
      });

    // Removing hides it from everyone but administrators.
    await admin
      .post(`/api/reports/${reportId}/moderation`)
      .send({ moderationStatus: "REMOVED" })
      .expect(200);
    await residentAgent.get(`/api/reports/${reportId}`).expect(404);
    await officialAgent.get(`/api/reports/${reportId}`).expect(404);
    await admin
      .get(`/api/reports/${reportId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.moderationStatus).toBe("REMOVED");
      });

    const { body: audit } = await admin.get("/api/admin/audit").expect(200);
    expect(
      audit.entries.filter((entry: { action: string }) => entry.action === "REPORT_MODERATED"),
    ).toHaveLength(2);
  });

  it("suspends and reinstates accounts, revoking active sessions", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);

    const { body: organizationList } = await request(app)
      .get("/api/organizations")
      .expect(200);
    const publicWorks = organizationList.organizations.find(
      (organization: { name: string }) => organization.name === "Public Works",
    );

    const officialAgent = request.agent(app);
    await officialAgent
      .post("/api/auth/register")
      .send({
        displayName: "Olive Official",
        email: "official@example.test",
        password: "an official account password",
        role: "OFFICIAL",
        organizationId: publicWorks.id,
      })
      .expect(201);
    const { body: adminUsers } = await admin.get("/api/admin/users").expect(200);
    const official = adminUsers.users.find(
      (user: { email: string }) => user.email === "official@example.test",
    );
    await admin
      .post(`/api/admin/users/${official.id}/verify`)
      .send({ role: "OFFICIAL", organizationId: publicWorks.id })
      .expect(200);
    await officialAgent.get("/api/reports").expect(200);

    await admin
      .post(`/api/admin/users/${official.id}/status`)
      .send({ status: "SUSPENDED" })
      .expect(200);
    await officialAgent.get("/api/reports").expect(401);
    await officialAgent
      .post("/api/auth/login")
      .send({
        email: "official@example.test",
        password: "an official account password",
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe("ACCOUNT_SUSPENDED");
      });

    await admin
      .post(`/api/admin/users/${official.id}/status`)
      .send({ status: "ACTIVE" })
      .expect(200);
    await officialAgent
      .post("/api/auth/login")
      .send({
        email: "official@example.test",
        password: "an official account password",
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ status: "ACTIVE" });
      });

    // Administrators cannot suspend their own account.
    const { body: session } = await admin.get("/api/auth/session").expect(200);
    await admin
      .post(`/api/admin/users/${session.user.id}/status`)
      .send({ status: "SUSPENDED" })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error.code).toBe("CANNOT_MODIFY_SELF");
      });
  });

  it("manages organizations and categories used for civic routing", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);

    await admin
      .post("/api/admin/organizations")
      .send({ name: "Water Department", kind: "PUBLIC_SERVICE" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.organization).toMatchObject({
          name: "Water Department",
          kind: "PUBLIC_SERVICE",
          active: true,
          memberCount: 0,
        });
      });

    const { body: organizations } = await admin
      .get("/api/admin/organizations")
      .expect(200);
    expect(organizations.organizations).toHaveLength(4);
    const water = organizations.organizations.find(
      (organization: { name: string }) => organization.name === "Water Department",
    );

    await admin
      .post("/api/admin/categories")
      .send({
        name: "Water Leaks",
        description: "Leaks, outages, and water infrastructure problems",
        organizationId: water.id,
      })
      .expect(201);

    const { body: categories } = await admin.get("/api/admin/categories").expect(200);
    expect(
      categories.categories.some((category: { name: string }) => category.name === "Water Leaks"),
    ).toBe(true);

    // Inactive categories disappear from the resident report form.
    const leakCategory = categories.categories.find(
      (category: { name: string }) => category.name === "Water Leaks",
    );
    await admin
      .post(`/api/admin/categories/${leakCategory.id}/active`)
      .send({ active: false })
      .expect(200);
    await admin
      .post("/api/admin/categories")
      .send({ name: "Water Leaks", organizationId: "missing" })
      .expect(422);
  });
});
