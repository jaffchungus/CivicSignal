import { randomUUID } from "node:crypto";

import type { CivicDatabase } from "./database.js";
import { ApiError } from "./http.js";
import { type PhotoStore, type StoredPhoto } from "./photo-store.js";

const DATABASE_PHOTO_PREFIX = "database:";
const MAX_STORED_PHOTO_BYTES = 5 * 1024 * 1024;

/** Private photo storage in the existing database, served only through report authorization. */
export class DatabasePhotoStore implements PhotoStore {
  constructor(private readonly database: CivicDatabase) {}

  async save(buffer: Buffer, _originalName: string, _contentType: string): Promise<StoredPhoto> {
    const id = randomUUID();
    try {
      await this.database.prepare(
        "INSERT INTO report_photos (id, photo_data) VALUES (?, ?)",
      ).run(id, buffer);
      return { storedName: `${DATABASE_PHOTO_PREFIX}${id}` };
    } catch {
      throw new ApiError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is temporarily unavailable.");
    }
  }

  async remove(storedName: string): Promise<void> {
    const id = this.databasePhotoId(storedName);
    if (!id) return;
    try {
      await this.database.prepare("DELETE FROM report_photos WHERE id = ?").run(id);
    } catch {
      throw new ApiError(503, "PHOTO_CLEANUP_FAILED", "Photo cleanup is unavailable.");
    }
  }

  async read(storedName: string): Promise<Buffer> {
    const id = this.databasePhotoId(storedName);
    if (id) {
      const row = await this.database.prepare(
        "SELECT photo_data FROM report_photos WHERE id = ?",
      ).get(id) as { photo_data?: Buffer | Uint8Array } | undefined;
      if (!row?.photo_data) throw unavailablePhoto();
      const buffer = Buffer.from(row.photo_data);
      if (buffer.byteLength > MAX_STORED_PHOTO_BYTES) throw unavailablePhoto();
      return buffer;
    }

    // Preserve access to legacy public Blob attachments after switching to DB storage.
    let url: URL;
    try {
      url = new URL(storedName);
    } catch {
      throw unavailablePhoto();
    }
    if (
      url.protocol !== "https:" || url.username || url.password ||
      !url.hostname.endsWith(".public.blob.vercel-storage.com")
    ) throw unavailablePhoto();

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw unavailablePhoto();
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_STORED_PHOTO_BYTES) throw unavailablePhoto();
      return buffer;
    } catch {
      throw unavailablePhoto();
    }
  }

  private databasePhotoId(storedName: string): string | null {
    if (!storedName.startsWith(DATABASE_PHOTO_PREFIX)) return null;
    const id = storedName.slice(DATABASE_PHOTO_PREFIX.length);
    return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  }
}

function unavailablePhoto(): ApiError {
  return new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
}
