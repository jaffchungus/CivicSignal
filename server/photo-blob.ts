// Production photo storage on Vercel Blob. Stored names are the public URLs
// the blob store returns, so url() passes them through unchanged.
import { randomUUID } from "node:crypto";

import { del, put } from "@vercel/blob";

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

  url(storedName: string): string {
    return storedName;
  }
}
