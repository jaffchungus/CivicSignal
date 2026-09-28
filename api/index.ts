// Vercel serverless entry. The app is built once per function instance and
// every /api request is handed to Express; the client bundle is served by
// Vercel's CDN from outputDirectory (see vercel.json).
import type { Request, Response } from "express";

import { createApp } from "../server/app";
import { createPostgresDatabase } from "../server/database-postgres";
import { BlobPhotoStore } from "../server/photo-blob";

type App = ReturnType<typeof createApp>["app"];

let appPromise: Promise<App> | undefined;

function buildApp(): Promise<App> {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    return Promise.reject(
      new Error("DATABASE_URL is required to run CivicSignal on Vercel."),
    );
  }
  return createPostgresDatabase(connectionString).then((database) =>
    createApp({
      database,
      photos: new BlobPhotoStore(),
      secureCookies: true,
    }).app,
  );
}

export default async function handler(request: Request, response: Response): Promise<void> {
  try {
    appPromise ??= buildApp();
    const app = await appPromise;
    app(request, response);
  } catch (error) {
    console.error(error);
    response
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
  }
}
