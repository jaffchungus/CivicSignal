// Photo storage seam: local disk in development and tests, an external blob
// store in production. The rest of the app only knows stored names and URLs.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import express, { type RequestHandler } from "express";

const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export type StoredPhoto = { storedName: string };

export type PhotoStore = {
  save(buffer: Buffer, originalName: string, contentType: string): Promise<StoredPhoto>;
  /** Public URL a client can fetch the stored photo from. */
  url(storedName: string): string;
  /** Mounts /uploads for stores that serve files themselves. */
  staticHandler?: RequestHandler;
};

/** Stored names always carry an allowed image extension, or .bin. */
export function photoExtension(originalName: string): string {
  const extension = originalName.includes(".")
    ? `.${originalName.split(".").pop()?.toLowerCase() ?? ""}`
    : "";
  return ALLOWED_IMAGE_EXTENSIONS.has(extension) ? extension : ".bin";
}

export class DiskPhotoStore implements PhotoStore {
  private readonly directory: string;
  readonly staticHandler: RequestHandler;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    this.staticHandler = express.static(directory);
  }

  save(buffer: Buffer, originalName: string): Promise<StoredPhoto> {
    const storedName = `${randomUUID()}${photoExtension(originalName)}`;
    writeFileSync(path.join(this.directory, storedName), buffer);
    return Promise.resolve({ storedName });
  }

  url(storedName: string): string {
    return `/uploads/${storedName}`;
  }
}
