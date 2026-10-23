import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "./http.js";
import { photoExtension, type PhotoStore, type StoredPhoto } from "./photo-store.js";

export class SupabasePhotoStore implements PhotoStore {
  private constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  static async create(client: SupabaseClient, bucket: string): Promise<SupabasePhotoStore> {
    const { data, error } = await client.storage.getBucket(bucket);
    if (error || !data) {
      throw new Error("Supabase photo bucket is unavailable. Check SUPABASE_PHOTO_BUCKET and server credentials.");
    }
    if (data.public) {
      throw new Error("The Supabase photo bucket must be private to preserve report authorization.");
    }
    return new SupabasePhotoStore(client, bucket);
  }

  async save(buffer: Buffer, originalName: string, contentType: string): Promise<StoredPhoto> {
    try {
      const storedName = `photos/${randomUUID()}${photoExtension(originalName)}`;
      const { data, error } = await this.client.storage.from(this.bucket).upload(storedName, buffer, {
        contentType,
        upsert: false,
      });
      if (error || !data) throw new Error("Photo storage upload failed.");
      return { storedName: data.path };
    } catch {
      throw new ApiError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is temporarily unavailable.");
    }
  }

  async remove(storedName: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([storedName]);
    if (error) {
      throw new ApiError(503, "PHOTO_CLEANUP_FAILED", "Photo cleanup is unavailable.");
    }
  }

  async read(storedName: string): Promise<Buffer> {
    if (storedName.startsWith("https://")) {
      const url = new URL(storedName);
      if (
        !url.hostname.endsWith(".public.blob.vercel-storage.com") ||
        url.username ||
        url.password
      ) {
        throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("Legacy photo is unavailable.");
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > 5 * 1024 * 1024) throw new Error("Legacy photo is too large.");
        return buffer;
      } catch {
        throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
      }
    }

    const { data, error } = await this.client.storage.from(this.bucket).download(storedName);
    if (error || !data) {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.byteLength > 5 * 1024 * 1024) {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable.");
    }
    return buffer;
  }

}
