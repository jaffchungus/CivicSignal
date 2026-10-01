// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";

const { put, del } = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, del }));

import { BlobPhotoStore } from "../server/photo-blob";

afterEach(() => vi.resetAllMocks());

it("removes the newly uploaded Blob using its exact returned URL", async () => {
  const url = "https://test.public.blob.vercel-storage.com/photos/new.png";
  put.mockResolvedValue({ url });
  del.mockResolvedValue(undefined);
  const photos = new BlobPhotoStore();
  const saved = await photos.save(Buffer.from("photo"), "photo.png", "image/png");
  await photos.remove(saved.storedName);
  expect(del).toHaveBeenCalledExactlyOnceWith(url);
});
