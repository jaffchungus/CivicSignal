// Photo storage seam: local disk in development and tests, an external blob
// store in production. The rest of the app only knows stored names and URLs.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { ApiError } from "./http.js";

const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const IMAGE_EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export type StoredPhoto = { storedName: string };

export type PhotoStore = {
  save(buffer: Buffer, originalName: string, contentType: string): Promise<StoredPhoto>;
  /** Reads a photo after the report authorization check has passed. */
  read(storedName: string): Promise<Buffer>;
  /** Removes a newly saved photo when report persistence rolls back. */
  remove(storedName: string): Promise<void>;
};

/** Stored names always carry an allowed image extension, or .bin. */
export function photoExtension(originalName: string, contentType?: string): string {
  if (contentType && IMAGE_EXTENSIONS_BY_TYPE[contentType]) {
    return IMAGE_EXTENSIONS_BY_TYPE[contentType];
  }
  const extension = originalName.includes(".")
    ? `.${originalName.split(".").pop()?.toLowerCase() ?? ""}`
    : "";
  return ALLOWED_IMAGE_EXTENSIONS.has(extension) ? extension : ".bin";
}

export class DiskPhotoStore implements PhotoStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  save(buffer: Buffer, originalName: string, contentType?: string): Promise<StoredPhoto> {
    const storedName = `${randomUUID()}${photoExtension(originalName, contentType)}`;
    writeFileSync(path.join(this.directory, storedName), buffer);
    return Promise.resolve({ storedName });
  }

  remove(storedName: string): Promise<void> {
    return rm(path.join(this.directory, storedName), { force: true });
  }

  async read(storedName: string): Promise<Buffer> {
    if (path.basename(storedName) !== storedName) {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
    }
    try {
      return await readFile(path.join(this.directory, storedName));
    } catch {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
    }
  }

}
