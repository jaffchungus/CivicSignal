// Vercel serverless entry. The app is built once per function instance and
// every /api request is handed to Express; the client bundle is served by
// Vercel's CDN from outputDirectory (see vercel.json).
import type { Request, Response } from "express";

type ProductionModule = typeof import("../server/production.js");
type App = Awaited<ReturnType<ProductionModule["createProductionApp"]>>["app"];

let appPromise: Promise<App> | undefined;

async function buildApp(): Promise<App> {
  // Keep app initialization inside the handler so startup failures can be
  // reported through the sanitized API error response below.
  const { createProductionApp } = await import("../server/production.js");
  const { app } = await createProductionApp();
  return app;
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

function safeStartupDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CONNECTION_STRING or DB_PASSWORD is required")) {
    return "MISSING_DATABASE_CONFIG";
  }
  if (message.includes("must be a Postgres connection string")) {
    return "INVALID_DATABASE_URL";
  }

  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_MODULE_NOT_FOUND") {
    const missingPackage = message.match(/Cannot find package ['"]([^'"]+)['"]/i)?.[1];
    if (missingPackage) return `MISSING_PACKAGE:${missingPackage}`;
    const missingModule = message.match(/Cannot find module ['"]([^'"]+)['"]/i)?.[1];
    if (missingModule) {
      return `MISSING_MODULE:${missingModule.split(/[\\/]/).at(-1)}`;
    }
  }
  if (typeof code === "string" && /^[a-z0-9_]{2,40}$/i.test(code)) {
    return code.toUpperCase();
  }
  return "API_STARTUP_FAILED";
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
    console.error("[api/index] Failed to initialize or dispatch the API request:", error);
    if (!response.headersSent && !response.writableEnded) {
      response
        .status(500)
        .json({
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
            diagnostic: safeStartupDiagnostic(error),
          },
        });
    }
  }
}
