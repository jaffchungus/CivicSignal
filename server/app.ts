// Composition root: wires middleware, routers, and the error protocol together.
import path from "node:path";

import compression from "compression";
import cookieParser from "cookie-parser";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { z } from "zod";

import type { CivicDatabase } from "./database.js";
import { ApiError, sendError } from "./http.js";
import type { PhotoStore } from "./photo-store.js";
import { DEFAULT_SESSION_TTL_MS, sessionCookieName } from "./session.js";
import {
  CROSS_ORIGIN_OPENER_POLICY,
  CROSS_ORIGIN_RESOURCE_POLICY,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  contentSecurityPolicy,
} from "./security-policy.js";
import { createAuthRouter } from "./routes/auth.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createAdminRouter } from "./routes/admin.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createLocationRouter } from "./routes/location.js";
import { createReportsRouter } from "./routes/reports.js";

function configuredOrigins(environment = process.env): Set<string> {
  const origins = new Set<string>();
  for (const value of (environment.APP_ORIGIN ?? "").split(",")) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed values; the request origin must still match this host.
    }
  }
  return origins;
}

type AppOptions = {
  database: CivicDatabase;
  photos: PhotoStore;
  secureCookies?: boolean;
  /** Absolute session lifetime in milliseconds; defaults to two hours. */
  sessionTtlMs?: number;
  photoStorageAvailable?: boolean;
};

export function createApp(options: AppOptions) {
  const { database, photos } = options;
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";
  const sessionDurationMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sessionCookie = sessionCookieName(secureCookies);
  const allowedOrigins = configuredOrigins();
  const app = express();

  app.disable("x-powered-by");
  // Behind a platform proxy (Vercel) trust the first hop so secure cookies
  // and the rate limiter see the real client over x-forwarded-*.
  if (process.env.VERCEL) {
    app.set("trust proxy", 1);
  }
  // HTTPS deployments get HSTS and upgrade-insecure-requests; plain-HTTP local
  // development omits both so localhost assets are not rewritten to https.
  const httpsDeployment = secureCookies;
  // API responses include account state, private reports, notifications, and
  // authorization-dependent attachment data. Never let a shared cache retain them.
  app.use((_request, response, next) => {
    response.setHeader(
      "Content-Security-Policy",
      contentSecurityPolicy(httpsDeployment),
    );
    response.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
  });
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  // CSRF defence in depth on top of the SameSite=Lax session cookie: browsers
  // attach an Origin header to every unsafe request, so a foreign origin means
  // the request was not initiated by this application.
  app.use("/api", (request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      next();
      return;
    }
    const origin = request.headers.origin;
    if (!origin) {
      // Non-browser clients (and same-origin requests from older agents) may
      // omit Origin; the session cookie remains the authentication boundary.
      next();
      return;
    }
    const forwardedHost = request.headers["x-forwarded-host"];
    const host = typeof forwardedHost === "string" ? forwardedHost : request.headers.host;
    const forwardedProto = request.headers["x-forwarded-proto"];
    const protocol =
      typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : request.protocol;
    const sameOrigin = host ? `${protocol}://${host}` : undefined;
    if (origin === sameOrigin || allowedOrigins.has(origin)) {
      next();
      return;
    }
    sendError(
      response,
      403,
      "CROSS_ORIGIN_REQUEST",
      "This request was blocked because it came from another site.",
    );
  });
  app.use(
    helmet({
      // The full policy is set above so the same string can be mirrored in
      // vercel.json for CDN-served static files.
      contentSecurityPolicy: false,
      // OpenStreetMap's volunteer tile servers require a referrer. Sending
      // only the origin cross-site keeps report URLs private while letting the
      // map load tiles.
      referrerPolicy: { policy: REFERRER_POLICY },
      strictTransportSecurity: httpsDeployment
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
      frameguard: { action: "deny" },
      crossOriginOpenerPolicy: { policy: CROSS_ORIGIN_OPENER_POLICY },
      crossOriginResourcePolicy: { policy: CROSS_ORIGIN_RESOURCE_POLICY },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many authentication requests. Please wait before trying again." } },
  });
  const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Wait before trying again." } },
  });
  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many account creation attempts. Try again later." } },
  });
  app.post("/api/auth/login", signInLimiter);
  app.post("/api/auth/register", registrationLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/setup", authLimiter);

  app.use(
    "/api",
    createAuthRouter({ database, secureCookies, sessionDurationMs }),
    createCatalogRouter({ database, photoStorageAvailable: options.photoStorageAvailable }),
  );
  app.use("/api", createLocationRouter({ database }));
  app.use(
    "/api/reports",
    createReportsRouter({ database, photos, sessionCookie }),
  );
  app.use("/api/notifications", createNotificationsRouter({ database, sessionCookie }));
  app.use("/api/admin", createAdminRouter({ database, sessionCookie }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        },
      });
      return;
    }
    if (error instanceof z.ZodError) {
      response.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid fields.",
          fieldErrors: error.flatten().fieldErrors,
        },
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      sendError(response, 400, "UPLOAD_ERROR", "The uploaded file could not be processed.");
      return;
    }
    console.error(error);
    response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
  });

  return {
    app,
    async close(): Promise<void> {
      await database.close();
    },
  };
}

/**
 * Serves the built SPA. Vercel's CDN serves `dist/client` directly, so the same
 * header policy is mirrored in vercel.json for those responses.
 */
export function attachClient(app: Express, clientDirectory: string): void {
  const root = path.resolve(clientDirectory);
  app.use(
    "/assets",
    express.static(path.join(root, "assets"), { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static(root));
  app.use((request, response, next) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      next();
      return;
    }
    if (request.path.startsWith("/api/") || request.path.startsWith("/uploads/")) {
      next();
      return;
    }
    response.sendFile(path.join(root, "index.html"), (error) => {
      if (error) {
        next();
      }
    });
  });
}
