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

/**
 * Vercel's rewrite to /api/index forwards the matched route as the `path`
 * query parameter. Express must receive the original /api/... URL to match
 * the mounted routers.
 */
function restoreRewrittenPath(request: Request): void {
  const requestUrl = new URL(request.url ?? "/", "http://vercel.local");
  if (requestUrl.pathname !== "/api/index") return;

  const routePath = requestUrl.searchParams.get("path");
  if (!routePath) return;

  requestUrl.searchParams.delete("path");
  const query = requestUrl.searchParams.toString();
  request.url = `/api/${routePath.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
}

function dispatch(app: App, request: Request, response: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.removeListener("finish", onFinish);
      response.removeListener("close", onClose);
      response.removeListener("error", onError);
    };
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      if (response.writableFinished) {
        resolve();
      } else {
        reject(new Error("Vercel closed the API response before Express finished it."));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    // Keep the Vercel invocation alive until Express finishes its async route.
    response.once("finish", onFinish);
    response.once("close", onClose);
    response.once("error", onError);
    try {
      app(request, response);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export default async function handler(request: Request, response: Response): Promise<void> {
  try {
    restoreRewrittenPath(request);
    appPromise ??= buildApp().catch((error: unknown) => {
      // A transient storage/database failure must not poison a warm instance.
      appPromise = undefined;
      throw error;
    });
    const app = await appPromise;
    await dispatch(app, request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent && !response.writableEnded) {
      response
        .status(500)
        .json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
    }
  }
}
