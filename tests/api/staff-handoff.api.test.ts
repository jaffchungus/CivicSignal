// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupApplications,
  setTestPhotoAnalysis,
  setupAdministrator,
  testApplication,
} from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

describe("verified staff report handoff", () => {
  it("transfers one owner within the configured organization and records reason and resident update", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);
    const { body: organizations } = await request(app).get("/api/organizations").expect(200);
    const publicWorks = organizations.organizations.find((item: { name: string }) => item.name === "Public Works");
    const police = organizations.organizations.find((item: { name: string; kind: string }) => item.kind === "LAW_ENFORCEMENT");

    async function verifiedStaff(displayName: string, email: string, organizationId: string) {
      const agent = request.agent(app);
      await agent.post("/api/auth/register").send({
        displayName,
        email,
        password: "a verified staff password",
        role: organizationId === police.id ? "LAW_ENFORCEMENT" : "OFFICIAL",
        organizationId,
      }).expect(201);
      const { body } = await admin.get("/api/admin/users").expect(200);
      const target = body.users.find((user: { email: string }) => user.email === email);
      await admin.post(`/api/admin/users/${target.id}/verify`).send({
        role: organizationId === police.id ? "LAW_ENFORCEMENT" : "OFFICIAL",
        organizationId,
      }).expect(200);
      return { agent, id: target.id };
    }

    const original = await verifiedStaff("Olive Official", "olive@example.test", publicWorks.id);
    const recipient = await verifiedStaff("Omar Official", "omar@example.test", publicWorks.id);
    const outside = await verifiedStaff("Parker Officer", "parker@example.test", police.id);
    const resident = request.agent(app);
    await resident.post("/api/auth/register").send({
      displayName: "Rita Resident",
      email: "rita@example.test",
      password: "a resident account password",
    }).expect(201);
    const { body: catalog } = await request(app).get("/api/categories").expect(200);
    const category = catalog.categories.find((item: { name: string }) => item.name === "Roads and Sidewalks");
    setTestPhotoAnalysis({
      categoryId: category.id,
      title: "Road surface damage",
      description: "The road surface is broken near the intersection.",
    });
    const report = await resident
      .post("/api/reports")
      .field("location", "Main Street")
      .field("latitude", "39.7817")
      .field("longitude", "-89.6501")
      .attach("photo", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), {
        filename: "damage.png",
        contentType: "image/png",
      })
      .expect(201);

    await original.agent.post(`/api/reports/${report.body.id}/claim`).expect(200);
    await original.agent.post(`/api/reports/${report.body.id}/handoff`)
      .send({ toUserId: outside.id, reason: "Outside the service area." })
      .expect(422);
    await resident.post(`/api/reports/${report.body.id}/handoff`)
      .send({ toUserId: recipient.id, reason: "Coverage change." })
      .expect(403);

    const transferred = await original.agent.post(`/api/reports/${report.body.id}/handoff`)
      .send({ toUserId: recipient.id, reason: "The next shift will continue the inspection." })
      .expect(200);
    expect(transferred.body.assignedTo.displayName).toBe("Omar Official");
    expect(transferred.body.timeline.some((event: { action: string; message: string }) =>
      event.action === "REPORT_HANDED_OFF" && event.message === "The next shift will continue the inspection.",
    )).toBe(true);
    expect(transferred.body.updates.at(-1).message).toContain("staff member handling your report has changed");
    await recipient.agent.get(`/api/reports/${report.body.id}`).expect(200);
    await original.agent.post(`/api/reports/${report.body.id}/handoff`)
      .send({ toUserId: recipient.id, reason: "Attempted to retain ownership." })
      .expect(409);

    const { body: audit } = await admin.get("/api/admin/audit?limit=50").expect(200);
    const entry = audit.entries.find((item: { action: string; targetId: string }) =>
      item.action === "REPORT_HANDED_OFF" && item.targetId === report.body.id,
    );
    expect(JSON.parse(entry.details)).toMatchObject({
      fromUserId: original.id,
      toUserId: recipient.id,
      reason: "The next shift will continue the inspection.",
    });
  });

  it("transfers a report to another configured department with audit and resident history", async () => {
    const app = await testApplication();
    const admin = await setupAdministrator(app);
    const { body: organizations } = await request(app).get("/api/organizations").expect(200);
    const publicWorks = organizations.organizations.find((item: { name: string }) => item.name === "Public Works");
    const police = organizations.organizations.find((item: { kind: string }) => item.kind === "LAW_ENFORCEMENT");

    async function verifiedStaff(displayName: string, email: string, organizationId: string) {
      const agent = request.agent(app);
      const role = organizationId === police.id ? "LAW_ENFORCEMENT" : "OFFICIAL";
      await agent.post("/api/auth/register").send({
        displayName,
        email,
        password: "a verified staff password",
        role,
        organizationId,
      }).expect(201);
      const { body } = await admin.get("/api/admin/users").expect(200);
      const target = body.users.find((user: { email: string }) => user.email === email);
      await admin.post(`/api/admin/users/${target.id}/verify`).send({ role, organizationId }).expect(200);
      return { agent, id: target.id };
    }

    const publicWorksOfficial = await verifiedStaff("Olive Official", "olive-transfer@example.test", publicWorks.id);
    const policeOfficial = await verifiedStaff("Parker Officer", "parker-transfer@example.test", police.id);
    const resident = request.agent(app);
    await resident.post("/api/auth/register").send({
      displayName: "Rita Resident",
      email: "rita-transfer@example.test",
      password: "a resident account password",
    }).expect(201);

    const { body: catalog } = await request(app).get("/api/categories").expect(200);
    const roads = catalog.categories.find((item: { name: string }) => item.name === "Roads and Sidewalks");
    const streetlights = catalog.categories.find((item: { name: string }) => item.name === "Streetlights");
    const safety = catalog.categories.find((item: { name: string }) => item.name === "Non-Emergency Public Safety");
    setTestPhotoAnalysis({
      categoryId: roads.id,
      title: "Abandoned vehicle blocking the lane",
      description: "A vehicle has been left in the travel lane for several days.",
    });
    const report = await resident
      .post("/api/reports")
      .field("location", "Main Street near the library")
      .field("latitude", "39.7817")
      .field("longitude", "-89.6501")
      .attach("photo", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), {
        filename: "vehicle.png",
        contentType: "image/png",
      })
      .expect(201);

    await publicWorksOfficial.agent.post(`/api/reports/${report.body.id}/claim`).expect(200);
    await publicWorksOfficial.agent.post(`/api/reports/${report.body.id}/transfer`).send({
      categoryId: streetlights.id,
      reason: "The same organization already handles this.",
    }).expect(422);

    const transferred = await publicWorksOfficial.agent.post(`/api/reports/${report.body.id}/transfer`).send({
      categoryId: safety.id,
      reason: "The vehicle is blocking a travel lane and needs law-enforcement review.",
    }).expect(200);
    expect(transferred.body).toMatchObject({
      status: "SUBMITTED",
      category: { name: "Non-Emergency Public Safety" },
      organization: { name: "Police Department" },
      assignedTo: null,
    });
    expect(transferred.body.timeline.some(
      (event: { action: string }) => event.action === "REPORT_TRANSFERRED",
    )).toBe(true);
    expect(transferred.body.updates.at(-1).message).toContain("Police Department");

    await publicWorksOfficial.agent.get(`/api/reports/${report.body.id}`).expect(404);
    const policeQueue = await policeOfficial.agent.get("/api/reports?scope=queue").expect(200);
    expect(policeQueue.body.reports.map((item: { id: string }) => item.id)).toContain(report.body.id);

    const residentDetail = await resident.get(`/api/reports/${report.body.id}`).expect(200);
    expect(residentDetail.body.organization.name).toBe("Police Department");
    const residentTransferEvent = residentDetail.body.timeline.find(
      (event: { action: string }) => event.action === "REPORT_TRANSFERRED",
    );
    expect(residentTransferEvent.message).toContain("reassigned to the responsible organization");
    expect(residentTransferEvent.message).not.toContain("law-enforcement review");

    const { body: audit } = await admin.get("/api/admin/audit?limit=50").expect(200);
    const entry = audit.entries.find((item: { action: string; targetId: string }) =>
      item.action === "REPORT_TRANSFERRED" && item.targetId === report.body.id,
    );
    expect(JSON.parse(entry.details)).toMatchObject({
      fromOrganizationId: publicWorks.id,
      toOrganizationId: police.id,
      toCategoryId: safety.id,
      reason: "The vehicle is blocking a travel lane and needs law-enforcement review.",
    });
  });
});
