// @vitest-environment node

import { readdirSync } from "node:fs";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupApplications,
  setupAdministrator,
  testApplicationWithUploads,
} from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

// A real 1x1 PNG payload for the multipart upload.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Scenario = {
  app: Awaited<ReturnType<typeof testApplicationWithUploads>>["app"];
  uploadDirectory: string;
  admin: ReturnType<typeof request.agent>;
  officialAgent: ReturnType<typeof request.agent>;
  residentAgent: ReturnType<typeof request.agent>;
  categories: Array<{ id: string; name: string; organizationId: string }>;
};

/** Admin + verified Public Works official + active resident, with test routing configured. */
async function scenario(): Promise<Scenario> {
  const { app, uploadDirectory } = await testApplicationWithUploads();
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

  return {
    app,
    uploadDirectory,
    admin,
    officialAgent,
    residentAgent,
    categories: categoryList.categories,
  };
}

function categoryByName(categories: Scenario["categories"], name: string) {
  const category = categories.find((entry) => entry.name === name);
  expect(category).toBeDefined();
  return category!;
}

function reportFields(categoryId: string, title: string, description: string, location: string) {
  return { categoryId, title, description, location };
}

describe("photo attachments", () => {
  it("serves uploaded photos only through the authorized report endpoint", async () => {
    const { app, residentAgent, categories } = await scenario();
    const roads = categoryByName(categories, "Roads and Sidewalks");
    const png = Buffer.from(PNG_BASE64, "base64");

    const created = await residentAgent
      .post("/api/reports")
      .field("categoryId", roads.id)
      .field("title", "Cracked curb ramp at the library")
      .field("description", "The curb ramp is cracked and lifts out of place.")
      .field("location", "Main Street library entrance")
      .attach("photo", png, { filename: "curb-ramp.png", contentType: "image/png" })
      .expect(201);

    expect(created.body.attachments).toHaveLength(1);
    const attachment = created.body.attachments[0];
    expect(attachment).toMatchObject({
      filename: "curb-ramp.png",
      contentType: "image/png",
      url: `/api/reports/${created.body.id}/attachments/${attachment.id}`,
    });
    // Files are stored under a generated name, never the client's filename.
    expect(attachment.url.endsWith("/curb-ramp.png")).toBe(false);

    // The attachment row persists on the report detail response.
    const detail = await residentAgent
      .get(`/api/reports/${created.body.id}`)
      .expect(200);
    expect(detail.body.attachments).toEqual([attachment]);

    await request(app).get(attachment.url).expect(401);
    const otherResident = request.agent(app);
    await otherResident.post("/api/auth/register").send({
      displayName: "Another Resident",
      email: "another-resident@example.test",
      password: "another resident account password",
    }).expect(201);
    await otherResident.get(attachment.url).expect(404);

    // Authorized readers get the file through the same report visibility policy.
    const served = await residentAgent.get(attachment.url).expect(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(Buffer.isBuffer(served.body)).toBe(true);
    expect(Buffer.compare(served.body, png)).toBe(0);
  });

  it("limits submissions to residents and refuses categories whose organization is inactive", async () => {
    const { admin, app, officialAgent, residentAgent, categories } = await scenario();
    const roads = categoryByName(categories, "Roads and Sidewalks");

    await officialAgent.post("/api/reports").send({
      categoryId: roads.id,
      title: "Official account report",
      description: "An official should not submit resident reports.",
      location: "Main Street",
    }).expect(403);

    await admin.post(`/api/admin/organizations/${roads.organizationId}/active`)
      .send({ active: false }).expect(200);
    const availableCategories = await residentAgent.get("/api/categories").expect(200);
    expect(availableCategories.body.categories.some((item: { id: string }) => item.id === roads.id)).toBe(false);

    const rejected = await residentAgent.post("/api/reports")
      .field("categoryId", roads.id)
      .field("title", "Pothole on a local road")
      .field("description", "The road surface is broken and needs an inspection.")
      .field("location", "Main Street")
      .expect(422);
    expect(rejected.body.error.fieldErrors.categoryId).toContain(
      "Choose a category routed to an active organization.",
    );
  });

  it("rejects a non-image attachment with a clean 415 and persists nothing", async () => {
    const { uploadDirectory, residentAgent, categories } = await scenario();
    const roads = categoryByName(categories, "Roads and Sidewalks");

    const rejected = await residentAgent
      .post("/api/reports")
      .field("categoryId", roads.id)
      .field("title", "Report with a bogus attachment")
      .field("description", "This upload should be rejected before anything is saved.")
      .field("location", "Nowhere Street 1")
      .attach("photo", Buffer.from("definitely not an image"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(rejected.status).toBe(415);
    expect(rejected.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");

    const list = await residentAgent.get("/api/reports?scope=mine").expect(200);
    expect(list.body.reports).toHaveLength(0);
    expect(readdirSync(uploadDirectory)).toHaveLength(0);
  });

  it("rejects an oversize attachment with a clean 400 and persists nothing", async () => {
    const { uploadDirectory, residentAgent, categories } = await scenario();
    const roads = categoryByName(categories, "Roads and Sidewalks");

    const rejected = await residentAgent
      .post("/api/reports")
      .field("categoryId", roads.id)
      .field("title", "Report with a giant attachment")
      .field("description", "This upload exceeds the five megabyte attachment limit.")
      .field("location", "Nowhere Street 2")
      .attach("photo", Buffer.alloc(5 * 1024 * 1024 + 1, 0x42), {
        filename: "huge.png",
        contentType: "image/png",
      });

    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("UPLOAD_ERROR");

    const list = await residentAgent.get("/api/reports?scope=mine").expect(200);
    expect(list.body.reports).toHaveLength(0);
    expect(readdirSync(uploadDirectory)).toHaveLength(0);
  });
});

describe("report filtering", () => {
  /** Four reports across categories and statuses; R4 lives in a different organization. */
  async function filterScenario() {
    const context = await scenario();
    const { residentAgent, officialAgent, categories } = context;
    const roads = categoryByName(categories, "Roads and Sidewalks");
    const streetlights = categoryByName(categories, "Streetlights");
    const trash = categoryByName(categories, "Trash and Sanitation");
    const parks = categoryByName(categories, "Parks and Recreation");

    const create = (categoryId: string, title: string, description: string, location: string) =>
      residentAgent
        .post("/api/reports")
        .send(reportFields(categoryId, title, description, location))
        .expect(201);

    const pothole = await create(
      roads.id,
      "Deep pothole on Main Street",
      "A deep pothole near the crosswalk is a hazard for cyclists.",
      "Main Street and 4th Avenue",
    );
    const streetlight = await create(
      streetlights.id,
      "Broken streetlight on Oak Street",
      "The streetlight outside number 12 has been out for a week.",
      "Oak Street 12",
    );
    const trashPickup = await create(
      trash.id,
      "Missed trash collection on Pine Street",
      "Trash was not collected on Pine Street this week.",
      "Pine Street 8",
    );
    const bench = await create(
      parks.id,
      "Broken bench in Riverside Park",
      "The bench near the pavilion is broken.",
      "Riverside Park pavilion",
    );

    // R1 under review, R2 in progress; R3 and R4 stay submitted.
    await officialAgent
      .post(`/api/reports/${pothole.body.id}/status`)
      .send({ status: "UNDER_REVIEW" })
      .expect(200);
    await officialAgent
      .post(`/api/reports/${streetlight.body.id}/status`)
      .send({ status: "IN_PROGRESS" })
      .expect(200);

    return {
      ...context,
      ids: {
        pothole: pothole.body.id as string,
        streetlight: streetlight.body.id as string,
        trashPickup: trashPickup.body.id as string,
        bench: bench.body.id as string,
      },
      codes: {
        pothole: pothole.body.referenceCode as string,
        streetlight: streetlight.body.referenceCode as string,
      },
      categoryIds: {
        roads: roads.id,
        streetlights: streetlights.id,
        trash: trash.id,
        parks: parks.id,
      },
    };
  }

  async function queueQuery(
    agent: ReturnType<typeof request.agent>,
    query: Record<string, string>,
  ) {
    const params = new URLSearchParams({ scope: "queue", ...query });
    const response = await agent.get(`/api/reports?${params.toString()}`).expect(200);
    const codes = response.body.reports.map((report: { id: string }) => report.id);
    expect(response.body.total).toBe(codes.length);
    return codes.sort();
  }

  it("narrows the queue by status", async () => {
    const { officialAgent, ids } = await filterScenario();

    expect(await queueQuery(officialAgent, { status: "UNDER_REVIEW" })).toEqual([
      ids.pothole,
    ]);
    expect(await queueQuery(officialAgent, { status: "IN_PROGRESS" })).toEqual([
      ids.streetlight,
    ]);
    // R4 is submitted but belongs to another organization's queue.
    expect(await queueQuery(officialAgent, { status: "SUBMITTED" })).toEqual([
      ids.trashPickup,
    ]);
    expect(await queueQuery(officialAgent, { status: "CLOSED" })).toEqual([]);
  });

  it("narrows the queue by category", async () => {
    const { officialAgent, ids, categoryIds } = await filterScenario();

    expect(
      await queueQuery(officialAgent, { categoryId: categoryIds.roads }),
    ).toEqual([ids.pothole]);
    expect(
      await queueQuery(officialAgent, { categoryId: categoryIds.streetlights }),
    ).toEqual([ids.streetlight]);
    expect(
      await queueQuery(officialAgent, { categoryId: categoryIds.trash }),
    ).toEqual([ids.trashPickup]);
    // The parks category routes to a different organization's queue.
    expect(
      await queueQuery(officialAgent, { categoryId: categoryIds.parks }),
    ).toEqual([]);
  });

  it("searches title, description, and reference code case-insensitively", async () => {
    const { officialAgent, ids, codes } = await filterScenario();

    expect(await queueQuery(officialAgent, { q: "pothole" })).toEqual([ids.pothole]);
    expect(await queueQuery(officialAgent, { q: "POTHOLE" })).toEqual([ids.pothole]);
    // A word that only appears in the description.
    expect(await queueQuery(officialAgent, { q: "cyclists" })).toEqual([ids.pothole]);
    // A word that only appears in the title of another report.
    expect(await queueQuery(officialAgent, { q: "bench" })).toEqual([]);
    // Reference codes are searchable.
    expect(await queueQuery(officialAgent, { q: codes.streetlight })).toEqual([
      ids.streetlight,
    ]);
    expect(await queueQuery(officialAgent, { q: "no-such-thing" })).toEqual([]);
  });

  it("combines status, category, and text filters", async () => {
    const { officialAgent, ids, categoryIds } = await filterScenario();

    expect(
      await queueQuery(officialAgent, {
        status: "IN_PROGRESS",
        categoryId: categoryIds.streetlights,
      }),
    ).toEqual([ids.streetlight]);
    expect(
      await queueQuery(officialAgent, {
        status: "UNDER_REVIEW",
        categoryId: categoryIds.streetlights,
      }),
    ).toEqual([]);
    expect(
      await queueQuery(officialAgent, {
        status: "IN_PROGRESS",
        categoryId: categoryIds.streetlights,
        q: "oak",
      }),
    ).toEqual([ids.streetlight]);
    expect(
      await queueQuery(officialAgent, {
        status: "IN_PROGRESS",
        categoryId: categoryIds.streetlights,
        q: "pine",
      }),
    ).toEqual([]);
    expect(
      await queueQuery(officialAgent, {
        status: "SUBMITTED",
        categoryId: categoryIds.trash,
        q: "collection",
      }),
    ).toEqual([ids.trashPickup]);
  });

  it("applies filters within each scope", async () => {
    const { admin, residentAgent, ids } = await filterScenario();

    // The resident's own reports span organizations; status filtering still applies.
    const mineParams = new URLSearchParams({
      scope: "mine",
      status: "SUBMITTED",
    });
    const mine = await residentAgent.get(`/api/reports?${mineParams}`).expect(200);
    expect(mine.body.reports.map((report: { id: string }) => report.id).sort()).toEqual(
      [ids.trashPickup, ids.bench].sort(),
    );

    // Administrators see every queue; text filtering still applies.
    const allParams = new URLSearchParams({ scope: "all", q: "bench" });
    const all = await admin.get(`/api/reports?${allParams}`).expect(200);
    expect(all.body.reports.map((report: { id: string }) => report.id)).toEqual([
      ids.bench,
    ]);
  });
});
