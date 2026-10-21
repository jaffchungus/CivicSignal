// Production photo storage on Vercel Blob. Stored names are the public URLs
// the blob store returns, so url() passes them through unchanged.
import { randomUUID } from "node:crypto";

import { del, put } from "@vercel/blob";

import { ApiError } from "./http.js";
import { photoExtension, type PhotoStore, type StoredPhoto } from "./photo-store.js";

export class BlobPhotoStore implements PhotoStore {
  save(buffer: Buffer, originalName: string, contentType: string): Promise<StoredPhoto> {
    return put(`photos/${randomUUID()}${photoExtension(originalName)}`, buffer, {
      access: "public",
      contentType,
    }).then((blob) => ({ storedName: blob.url }));
  }

  remove(storedName: string): Promise<void> {
    return del(storedName);
  }

  async read(storedName: string): Promise<Buffer> {
    let url: URL;
    try {
      url = new URL(storedName);
    } catch {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
      url.username ||
      url.password
    ) {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        throw new Error("Blob storage returned an unavailable photo.");
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
        throw new Error("Stored photo exceeds the upload limit.");
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > 5 * 1024 * 1024) {
        throw new Error("Stored photo exceeds the upload limit.");
      }
      return buffer;
    } catch {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
    }
  }

}
