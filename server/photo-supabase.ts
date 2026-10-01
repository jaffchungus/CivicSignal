import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "./http";
import { photoExtension, type PhotoStore, type StoredPhoto } from "./photo-store";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

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
    const storedName = `photos/${randomUUID()}${photoExtension(originalName)}`;
    const { data, error } = await this.client.storage.from(this.bucket).upload(storedName, buffer, {
      contentType,
      upsert: false,
    });
    if (error || !data) {
      throw new ApiError(503, "UPLOAD_ERROR", "Photo storage is unavailable. Please try again.");
    }
    return { storedName: data.path };
  }

  async remove(storedName: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([storedName]);
    if (error) {
      throw new ApiError(503, "PHOTO_CLEANUP_FAILED", "Photo cleanup is unavailable.");
    }
  }

  async url(storedName: string): Promise<string> {
    // Preserve already-stored Vercel Blob attachments during a storage switch.
    if (storedName.startsWith("https://")) {
      const url = new URL(storedName);
      if (url.hostname.endsWith(".public.blob.vercel-storage.com") && !url.username && !url.password) {
        return storedName;
      }
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable. Please try again.");
    }
    const { data, error } = await this.client.storage.from(this.bucket)
      .createSignedUrl(storedName, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new ApiError(503, "PHOTO_UNAVAILABLE", "This photo is unavailable. Please try again.");
    }
    return data.signedUrl;
  }
}
