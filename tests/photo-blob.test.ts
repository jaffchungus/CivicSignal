// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";

const { put, del, get } = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, del, get }));

import { BlobPhotoStore } from "../server/photo-blob";

afterEach(() => vi.resetAllMocks());

it("writes private photos and removes them using the private Blob API", async () => {
  const url = "https://test.private.blob.vercel-storage.com/photos/new.png";
  put.mockResolvedValue({ url });
  del.mockResolvedValue(undefined);
  const photos = new BlobPhotoStore();
  const saved = await photos.save(Buffer.from("photo"), "photo.png", "image/png");
  await photos.remove(saved.storedName);
  expect(put).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/^photos\/[0-9a-f-]+\.png$/),
    expect.any(Buffer),
    { access: "private", contentType: "image/png" },
  );
  expect(del).toHaveBeenCalledExactlyOnceWith(url);
});

it("reads private Blob content through the authenticated SDK with a size limit", async () => {
  const png = Buffer.from("private-image");
  get.mockResolvedValue({
    statusCode: 200,
    blob: { size: png.byteLength },
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(png);
        controller.close();
      },
    }),
  });
  const url = "https://test.private.blob.vercel-storage.com/photos/photo.png";
  const photos = new BlobPhotoStore();
  await expect(photos.read(url)).resolves.toEqual(png);
  expect(get).toHaveBeenCalledExactlyOnceWith(url, { access: "private" });
});

it("refuses a private Blob larger than the attachment limit before reading it", async () => {
  get.mockResolvedValue({
    statusCode: 200,
    blob: { size: 5 * 1024 * 1024 + 1 },
    stream: new ReadableStream(),
  });
  const photos = new BlobPhotoStore();
  await expect(photos.read("https://test.private.blob.vercel-storage.com/photos/large.png"))
    .rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
  expect(get).toHaveBeenCalledOnce();
});
