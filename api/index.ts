// Vercel serverless entry. The app is built once per function instance and
// every /api request is handed to Express; the client bundle is served by
// Vercel's CDN from outputDirectory (see vercel.json).
import type { Request, Response } from "express";

import { createProductionApp } from "../server/production";

type App = Awaited<ReturnType<typeof createProductionApp>>["app"];

let appPromise: Promise<App> | undefined;

function buildApp(): Promise<App> {
  return createProductionApp().then(({ app }) => app);
}

export default async function handler(request: Request, response: Response): Promise<void> {
  try {
    appPromise ??= buildApp().catch((error: unknown) => {
      // A transient storage/database failure must not poison a warm instance.
      appPromise = undefined;
      throw error;
    });
    const app = await appPromise;
    app(request, response);
  } catch (error) {
    console.error(error);
    response
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
  }
}
