// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

import { createApp } from "../../server/app";
import { createSqliteDatabase } from "../../server/database-sqlite";
import { ApiError } from "../../server/http";
import { SupabasePhotoStore } from "../../server/photo-supabase";
import { createSupabaseServerClient } from "../../server/supabase";
import { setupAdministrator } from "./helpers";

const SUPABASE_URL = "https://storage.example.supabase.co";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
});

function storageHttp(options: { publicBucket?: boolean; failure?: "bucket" | "upload" | "download" } = {}) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if ((options.failure === "bucket" && url.includes("/bucket/")) ||
        (options.failure === "upload" && method === "POST")) {
      return Response.json({ message: "Storage unavailable", statusCode: "503" }, { status: 503 });
    }
    if (method === "DELETE") return Response.json([]);
    if (url.includes("/bucket/")) {
      return Response.json({ id: "civicsignal-photos", name: "civicsignal-photos", public: options.publicBucket ?? false });
    }
    if (method === "GET" && url.includes("/object/civicsignal-photos/photos/")) {
      if (options.failure === "download") {
        return Response.json({ message: "Storage unavailable" }, { status: 503 });
      }
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }
    if (method === "GET" && url.includes(".public.blob.vercel-storage.com/")) {
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }
    return Response.json({ Key: "civicsignal-photos/photos/test.png" });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function client() {
  return createSupabaseServerClient(SUPABASE_URL, "sb_secret_test_only");
}

async function application(failPersistence = false) {
  const photos = await SupabasePhotoStore.create(client(), "civicsignal-photos");
  const database = await createSqliteDatabase(":memory:");
  const runtime = createApp({
    database: {
      ...database,
      prepare(sql) {
        const statement = database.prepare(sql);
        if (!failPersistence || !sql.trimStart().startsWith("INSERT INTO reports\n")) return statement;
        return { ...statement, async run() {
          throw new ApiError(503, "PERSISTENCE_UNAVAILABLE", "Report persistence is unavailable.");
        } };
      },
    },
    photos, secureCookies: false,
  });
  closers.push(runtime.close);
  return runtime.app;
}

async function submitPhoto(agent: ReturnType<typeof request.agent>, categoryId: string) {
  return agent.post("/api/reports")
    .field("categoryId", categoryId)
    .field("title", "Damaged curb at the library")
    .field("description", "The curb ramp has broken concrete and needs repair.")
    .field("location", "Main Street library entrance")
    .attach("photo", PNG, { filename: "../../curb.png", contentType: "image/png" });
}

async function registerResident(app: Express) {
  const resident = request.agent(app);
  await resident.post("/api/auth/register").send({
    displayName: "Report Owner",
    email: "owner@example.test",
    password: "a resident account password",
  }).expect(201);
  return resident;
}

describe("Supabase private photos", () => {
  it("rejects unavailable and public buckets instead of weakening authorization", async () => {
    storageHttp({ failure: "bucket" });
    await expect(SupabasePhotoStore.create(client(), "civicsignal-photos"))
      .rejects.toThrow("bucket is unavailable");
    storageHttp({ publicBucket: true });
    await expect(SupabasePhotoStore.create(client(), "civicsignal-photos"))
      .rejects.toThrow("must be private");
  });

  it("serves private photos only through the authorized report endpoint", async () => {
    const fetch = storageHttp();
    const app = await application();
    await setupAdministrator(app);
    const owner = await registerResident(app);
    const { body: { categories } } = await owner.get("/api/categories").expect(200);
    const created = await submitPhoto(owner, categories[0].id);
    expect(created.status).toBe(201);
    expect(created.body.attachments[0].url).toBe(
      `/api/reports/${created.body.id}/attachments/${created.body.attachments[0].id}`,
    );
    const upload = fetch.mock.calls.find(([url, init]) =>
      String(url).includes("/object/civicsignal-photos/") && init?.method === "POST");
    expect(String(upload?.[0])).toMatch(/\/photos\/[\w-]+\.png$/);
    expect(new Headers(upload?.[1]?.headers).get("apikey")).toBe("sb_secret_test_only");

    fetch.mockClear();
    await request(app).get(`/api/reports/${created.body.id}`).expect(401);
    await request(app).get(created.body.attachments[0].url).expect(401);
    const stranger = request.agent(app);
    await stranger.post("/api/auth/register").send({
      displayName: "Another Resident", email: "another@example.test", password: "another resident password",
    }).expect(201);
    await stranger.get(`/api/reports/${created.body.id}`).expect(404);
    expect(fetch).not.toHaveBeenCalled();

    await owner.get(`/api/reports/${created.body.id}`).expect(200);
    const served = await owner.get(created.body.attachments[0].url).expect(200);
    expect(Buffer.compare(served.body, PNG)).toBe(0);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/object/civicsignal-photos/photos/"))).toBe(true);
  }, 15_000);

  it("keeps a saved report usable when private photo retrieval fails", async () => {
    const options: { failure?: "download" } = {};
    const fetch = storageHttp(options);
    const app = await application();
    await setupAdministrator(app);
    const owner = await registerResident(app);
    const { body: { categories } } = await owner.get("/api/categories").expect(200);

    const created = await submitPhoto(owner, categories[0].id);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: expect.any(String), title: "Damaged curb at the library", status: "SUBMITTED",
    });
    expect(created.body.attachments).toHaveLength(1);
    const attachmentId = created.body.attachments[0]?.id;
    const uploadCalls = () => fetch.mock.calls.filter(([url, init]) =>
      String(url).includes("/object/civicsignal-photos/") && init?.method === "POST");
    const uploadUrl = String(uploadCalls()[0][0]);
    const storedName = uploadUrl.split("/object/civicsignal-photos/")[1];
    expect(storedName).toMatch(/^photos\/[\w-]+\.png$/);

    options.failure = "download";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const detail = await owner.get(`/api/reports/${created.body.id}`).expect(200);
      expect(detail.body).toMatchObject({
        id: created.body.id, referenceCode: created.body.referenceCode,
        title: created.body.title, description: created.body.description, status: "SUBMITTED",
        category: created.body.category, organization: created.body.organization,
        reporter: created.body.reporter, capabilities: created.body.capabilities,
        updates: [], attachments: created.body.attachments,
      });
      expect(detail.body.timeline).toHaveLength(1);
      expect(detail.body.timeline[0].action).toBe("REPORT_CREATED");
      const serialized = JSON.stringify(detail.body);
      for (const privateValue of [storedName, "stored_name", "storedName", "civicsignal-photos", "sb_secret_test_only"]) {
        expect(serialized).not.toContain(privateValue);
        expect(JSON.stringify(created.body)).not.toContain(privateValue);
      }
      const unavailable = await owner.get(created.body.attachments[0].url).expect(503);
      expect(unavailable.body.error.code).toBe("PHOTO_UNAVAILABLE");
    }

    await request(app).get(`/api/reports/${created.body.id}`).expect(401);
    const photoUrl = created.body.attachments[0].url;
    await request(app).get(photoUrl).expect(401);
    const stranger = request.agent(app);
    await stranger.post("/api/auth/register").send({
      displayName: "Another Resident", email: "another@example.test", password: "another resident password",
    }).expect(201);
    const denied = await stranger.get(`/api/reports/${created.body.id}`).expect(404);
    expect(denied.body.error.code).toBe("REPORT_NOT_FOUND");
    expect(denied.body).not.toHaveProperty("attachments");
    await stranger.get(photoUrl).expect(404);

    options.failure = undefined;
    const recovered = await owner.get(`/api/reports/${created.body.id}`).expect(200);
    expect(recovered.body.attachments).toHaveLength(1);
    expect(recovered.body.attachments[0]).toMatchObject({
      id: expect.any(String), contentType: "image/png", url: photoUrl,
    });
    if (attachmentId) expect(recovered.body.attachments[0].id).toBe(attachmentId);
    expect(recovered.body.attachments[0]).not.toHaveProperty("stored_name");
    expect(recovered.body.attachments[0]).not.toHaveProperty("storedName");
    expect(uploadCalls()).toHaveLength(1);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    const list = await owner.get("/api/reports?scope=mine").expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.reports.map((report: { id: string }) => report.id)).toEqual([created.body.id]);
  }, 15_000);

  it("returns the existing API error shape and persists no report when upload fails", async () => {
    storageHttp({ failure: "upload" });
    const app = await application();
    await setupAdministrator(app);
    const owner = await registerResident(app);
    const { body: { categories } } = await owner.get("/api/categories").expect(200);
    const rejected = await submitPhoto(owner, categories[0].id);
    expect(rejected.status).toBe(503);
    expect(rejected.body.error).toMatchObject({ code: "UPLOAD_ERROR" });
    expect((await owner.get("/api/reports").expect(200)).body.reports).toEqual([]);
  });

  it("deletes only the new Supabase photo when report persistence rolls back", async () => {
    const fetch = storageHttp();
    const app = await application(true);
    await setupAdministrator(app);
    const owner = await registerResident(app);
    const { body: { categories } } = await owner.get("/api/categories").expect(200);
    const rejected = await submitPhoto(owner, categories[0].id);
    expect(rejected.status).toBe(503);
    expect(rejected.body.error.code).toBe("PERSISTENCE_UNAVAILABLE");
    const upload = fetch.mock.calls.find(([url, init]) =>
      String(url).includes("/object/civicsignal-photos/") && init?.method === "POST");
    const storedName = String(upload?.[0]).split("/object/civicsignal-photos/")[1];
    const deletions = fetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletions).toHaveLength(1);
    expect(String(deletions[0][0])).toBe(`${SUPABASE_URL}/storage/v1/object/civicsignal-photos`);
    expect(JSON.parse(String(deletions[0][1]?.body))).toEqual({ prefixes: [storedName] });
    expect((await owner.get("/api/reports").expect(200)).body.total).toBe(0);
    expect(JSON.stringify(rejected.body)).not.toContain(storedName);
  });

  it("reads legacy blob photos only from the configured Vercel host", async () => {
    storageHttp();
    const photos = await SupabasePhotoStore.create(client(), "civicsignal-photos");
    const legacy = "https://example.public.blob.vercel-storage.com/photos/legacy.png";
    await expect(photos.read(legacy)).resolves.toEqual(PNG);
    await expect(photos.read("https://untrusted.example/photo.png"))
      .rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
  });
});
