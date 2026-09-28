// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupApplications, setupAdministrator, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("civic report workflow", () => {
  it("carries a resident report from submission through official resolution with history", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);

    const { body: organizationList } = await request(app)
      .get("/api/organizations")
      .expect(200);
    const publicWorks = organizationList.organizations.find(
      (organization: { name: string }) => organization.name === "Public Works",
    );

    // An official may request an account, but it is inactive until verified.
    const officialAgent = request.agent(app);
    const officialRegistration = await officialAgent.post("/api/auth/register").send({
      displayName: "Olive Official",
      email: "official@example.test",
      password: "an official account password",
      role: "OFFICIAL",
      organizationId: publicWorks.id,
    });
    expect(officialRegistration.status).toBe(201);
    expect(officialRegistration.body.user).toMatchObject({
      role: "OFFICIAL",
      status: "PENDING",
    });

    await officialAgent
      .get("/api/reports")
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe("ACCOUNT_NOT_ACTIVE");
      });

    await admin
      .get("/api/admin/overview")
      .expect(200)
      .expect(({ body }) => {
        expect(body.pendingVerifications).toBe(1);
      });

    const { body: adminUsers } = await admin.get("/api/admin/users").expect(200);
    const officialUser = adminUsers.users.find(
      (user: { email: string }) => user.email === "official@example.test",
    );
    await admin
      .post(`/api/admin/users/${officialUser.id}/verify`)
      .send({ role: "OFFICIAL", organizationId: publicWorks.id })
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({
          status: "ACTIVE",
          role: "OFFICIAL",
          organizationName: "Public Works",
        });
      });

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
      title: "Deep pothole on Main Street",
      description: "A deep pothole near the crosswalk is a hazard for cyclists.",
      location: "Main Street and 4th Avenue",
    });
    expect(created.status).toBe(201);
    const reportId = created.body.id as string;
    expect(created.body).toMatchObject({
      referenceCode: expect.stringMatching(/^CS-\d{4}-\d{4}$/),
      status: "SUBMITTED",
      organization: { name: "Public Works" },
    });
    expect(created.body.timeline).toHaveLength(1);
    expect(created.body.capabilities).toMatchObject({
      canUpdateStatus: false,
      canAddUpdate: false,
    });

    await officialAgent
      .get("/api/reports?scope=queue")
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(1);
        expect(body.reports[0]).toMatchObject({ id: reportId });
      });

    // Authorization is enforced server-side, not by hiding UI.
    await residentAgent.get("/api/reports?scope=queue").expect(403);
    await residentAgent
      .post(`/api/reports/${reportId}/status`)
      .send({ status: "IN_PROGRESS" })
      .expect(403);
    await residentAgent
      .post(`/api/reports/${reportId}/updates`)
      .send({ message: "please hurry" })
      .expect(403);
    await residentAgent.post(`/api/reports/${reportId}/claim`).expect(403);

    // Administrators manage the platform; officials run the civic workflow.
    await admin
      .post(`/api/reports/${reportId}/status`)
      .send({ status: "IN_PROGRESS" })
      .expect(403);

    const claimed = await officialAgent
      .post(`/api/reports/${reportId}/claim`)
      .expect(200);
    expect(claimed.body.assignedTo).toMatchObject({ displayName: "Olive Official" });
    expect(claimed.body.canClaim).toBe(false);

    // Admin assignment is not part of the product; the route must remain absent
    // and the claim flow must keep working without it.
    expect(claimed.body.capabilities).not.toHaveProperty("canAssign");
    await admin
      .post(`/api/reports/${reportId}/assign`)
      .send({ userId: officialUser.id })
      .expect(404);

    const withUpdate = await officialAgent
      .post(`/api/reports/${reportId}/updates`)
      .send({ message: "A crew has been scheduled to inspect the pothole this week." })
      .expect(201);
    expect(withUpdate.body.updates).toHaveLength(1);

    await officialAgent
      .post(`/api/reports/${reportId}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe("UNDER_REVIEW");
      });

    // Only allowed transitions are accepted.
    await officialAgent
      .post(`/api/reports/${reportId}/status`)
      .send({ status: "SUBMITTED" })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("INVALID_TRANSITION");
      });

    await officialAgent
      .post(`/api/reports/${reportId}/status`)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    await officialAgent
      .post(`/api/reports/${reportId}/status`)
      .send({ status: "RESOLVED" })
      .expect(200);
    const closed = await officialAgent
      .post(`/api/reports/${reportId}/status`)
      .send({ status: "CLOSED" })
      .expect(200);
    expect(closed.body.status).toBe("CLOSED");
    expect(closed.body.allowedTransitions).toEqual([]);

    // The resident can still view the completed report and its history.
    const detail = await residentAgent.get(`/api/reports/${reportId}`).expect(200);
    expect(detail.body.status).toBe("CLOSED");
    expect(detail.body.updates).toHaveLength(1);
    expect(detail.body.updates[0].author).toMatchObject({
      displayName: "Olive Official",
    });
    const actions = detail.body.timeline.map(
      (entry: { action: string }) => entry.action,
    );
    expect(actions).toEqual([
      "REPORT_CREATED",
      "REPORT_CLAIMED",
      "REPORT_UPDATE_ADDED",
      "REPORT_STATUS_CHANGED",
      "REPORT_STATUS_CHANGED",
      "REPORT_STATUS_CHANGED",
      "REPORT_STATUS_CHANGED",
    ]);
    expect(detail.body.timeline[3]).toMatchObject({
      fromStatus: "SUBMITTED",
      toStatus: "UNDER_REVIEW",
      actor: { displayName: "Olive Official" },
    });

    await officialAgent
      .get("/api/notifications")
      .expect(200)
      .expect(({ body }) => {
        expect(
          body.notifications.some(
            (notification: { type: string }) =>
              notification.type === "REPORT_SUBMITTED",
          ),
        ).toBe(true);
      });

    await residentAgent
      .get("/api/notifications")
      .expect(200)
      .expect(({ body }) => {
        expect(body.unreadCount).toBeGreaterThan(0);
        expect(
          body.notifications.some(
            (notification: { type: string }) =>
              notification.type === "REPORT_UPDATE",
          ),
        ).toBe(true);
        expect(
          body.notifications.some(
            (notification: { type: string }) =>
              notification.type === "REPORT_STATUS_CHANGED",
          ),
        ).toBe(true);
      });
    await residentAgent.post("/api/notifications/read-all").expect(204);
    await residentAgent
      .get("/api/notifications")
      .expect(200)
      .expect(({ body }) => {
        expect(body.unreadCount).toBe(0);
      });

    const { body: audit } = await admin.get("/api/admin/audit").expect(200);
    const statusChanges = audit.entries.filter(
      (entry: { action: string }) => entry.action === "REPORT_STATUS_CHANGED",
    );
    expect(statusChanges).toHaveLength(4);
    expect(statusChanges[0].actor).toMatchObject({ displayName: "Olive Official" });
    expect(statusChanges[0].reportId).toBe(reportId);
    expect(
      audit.entries.some((entry: { action: string }) => entry.action === "USER_VERIFIED"),
    ).toBe(true);
    expect(
      audit.entries.some((entry: { action: string }) => entry.action === "REPORT_CLAIMED"),
    ).toBe(true);
  });

  it("scopes law-enforcement accounts to their own organization only", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);

    const { body: organizationList } = await request(app)
      .get("/api/organizations")
      .expect(200);
    const police = organizationList.organizations.find(
      (organization: { kind: string }) => organization.kind === "LAW_ENFORCEMENT",
    );
    const publicWorks = organizationList.organizations.find(
      (organization: { name: string }) => organization.name === "Public Works",
    );

    const officerAgent = request.agent(app);
    const officerRegistration = await officerAgent.post("/api/auth/register").send({
      displayName: "Pat Officer",
      email: "officer@example.test",
      password: "an officer account password",
      role: "LAW_ENFORCEMENT",
      organizationId: police.id,
    });
    expect(officerRegistration.body.user).toMatchObject({
      role: "LAW_ENFORCEMENT",
      status: "PENDING",
    });

    const { body: adminUsers } = await admin.get("/api/admin/users").expect(200);
    const officer = adminUsers.users.find(
      (user: { email: string }) => user.email === "officer@example.test",
    );

    // Verification must point at a law-enforcement organization.
    await admin
      .post(`/api/admin/users/${officer.id}/verify`)
      .send({ role: "LAW_ENFORCEMENT", organizationId: publicWorks.id })
      .expect(422);
    await admin
      .post(`/api/admin/users/${officer.id}/verify`)
      .send({ role: "LAW_ENFORCEMENT", organizationId: police.id })
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
    const safety = categoryList.categories.find(
      (category: { name: string }) => category.name === "Non-Emergency Public Safety",
    );
    const roads = categoryList.categories.find(
      (category: { name: string }) => category.name === "Roads and Sidewalks",
    );

    const safetyReport = await residentAgent.post("/api/reports").send({
      categoryId: safety.id,
      title: "Late night noise near the pavilion",
      description: "Repeated late night noise near the park pavilion on weekends.",
      location: "Riverside Park pavilion",
    });
    expect(safetyReport.status).toBe(201);
    const roadsReport = await residentAgent.post("/api/reports").send({
      categoryId: roads.id,
      title: "Broken streetlight on Oak Street",
      description: "The streetlight outside number 12 has been out for a week.",
      location: "Oak Street 12",
    });
    expect(roadsReport.status).toBe(201);

    await officerAgent
      .get("/api/reports?scope=queue")
      .expect(200)
      .expect(({ body }) => {
        expect(body.reports.map((report: { id: string }) => report.id)).toEqual([
          safetyReport.body.id,
        ]);
      });

    // Reports outside the organization are neither visible nor manageable.
    await officerAgent.get(`/api/reports/${roadsReport.body.id}`).expect(404);
    await officerAgent
      .post(`/api/reports/${roadsReport.body.id}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(404);
    await officerAgent
      .post(`/api/reports/${safetyReport.body.id}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(200);
  });
});
