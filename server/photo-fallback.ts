import type { PhotoStore, StoredPhoto } from "./photo-store.js";

/** Falls back to database storage when the configured cloud provider rejects an upload. */
export class PhotoFallbackStore implements PhotoStore {
  constructor(
    private readonly primary: PhotoStore,
    private readonly databaseFallback: PhotoStore,
  ) {}

  async save(buffer: Buffer, originalName: string, contentType: string): Promise<StoredPhoto> {
    try {
      return await this.primary.save(buffer, originalName, contentType);
    } catch {
      console.error("[photos] Cloud upload failed; storing this photo in the database.");
      return this.databaseFallback.save(buffer, originalName, contentType);
    }
  }

  read(storedName: string): Promise<Buffer> {
    return storedName.startsWith("database:")
      ? this.databaseFallback.read(storedName)
      : this.primary.read(storedName);
  }

  remove(storedName: string): Promise<void> {
    return storedName.startsWith("database:")
      ? this.databaseFallback.remove(storedName)
      : this.primary.remove(storedName);
  }
}
