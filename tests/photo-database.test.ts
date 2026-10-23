// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabasePhotoStore } from "../server/photo-database";
import { createSqliteDatabase } from "../server/database-sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("database photo storage fallback", () => {
  let database: Awaited<ReturnType<typeof createSqliteDatabase>>;
  let photos: DatabasePhotoStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "civicsignal-photo-db-"));
    database = await createSqliteDatabase(path.join(tempDir, "test.db"));
    photos = new DatabasePhotoStore(database);
  });

  afterEach(async () => {
    await database.close();
    await rm(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("saves photos in the database with a prefixed identifier", async () => {
    const image = Buffer.from("test-photo-bytes");
    const saved = await photos.save(image, "photo.jpg", "image/jpeg");

    expect(saved.storedName).toMatch(/^database:[0-9a-f-]{36}$/);

    const row = await database
      .prepare("SELECT id, photo_data FROM report_photos WHERE id = ?")
      .get(saved.storedName.slice("database:".length)) as { id: string; photo_data: Buffer } | undefined;

    expect(row).toBeDefined();
    expect(Buffer.from(row!.photo_data)).toEqual(image);
  });

  it("retrieves saved photos by their prefixed identifier", async () => {
    const image = Buffer.from("test-photo-bytes");
    const saved = await photos.save(image, "photo.jpg", "image/jpeg");
    const retrieved = await photos.read(saved.storedName);

    expect(retrieved).toEqual(image);
  });

  it("removes photos by their prefixed identifier", async () => {
    const image = Buffer.from("test-photo-bytes");
    const saved = await photos.save(image, "photo.jpg", "image/jpeg");
    await photos.remove(saved.storedName);

    const row = await database
      .prepare("SELECT id FROM report_photos WHERE id = ?")
      .get(saved.storedName.slice("database:".length));

    expect(row).toBeUndefined();
  });

  it("rejects photos larger than the storage limit", async () => {
    const largeImage = Buffer.alloc(5 * 1024 * 1024 + 1);
    const saved = await photos.save(largeImage, "large.jpg", "image/jpeg");

    await expect(photos.read(saved.storedName)).rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
  });

  it("handles missing photos gracefully", async () => {
    await expect(photos.read("database:nonexistent-id"))
      .rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
  });

  it("preserves access to legacy public Blob URLs", async () => {
    const legacyUrl = "https://example.public.blob.vercel-storage.com/photos/legacy.jpg";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("legacy-photo"), { status: 200, headers: { "content-length": "12" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal });

    const retrieved = await photos.read(legacyUrl);
    expect(retrieved).toEqual(Buffer.from("legacy-photo"));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects legacy Blob URLs from unauthorized domains", async () => {
    const unauthorizedUrl = "https://evil.com/photos/photo.jpg";

    await expect(photos.read(unauthorizedUrl))
      .rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
  });
});
