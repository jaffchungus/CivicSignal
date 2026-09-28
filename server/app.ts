// Composition root: wires middleware, routers, and the error protocol together.
import compression from "compression";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { z } from "zod";

import type { CivicDatabase } from "./database";
import { ApiError, sendError } from "./http";
import type { PhotoStore } from "./photo-store";
import { createAuthRouter } from "./routes/auth";
import { createCatalogRouter } from "./routes/catalog";
import { createAdminRouter } from "./routes/admin";
import { createNotificationsRouter } from "./routes/notifications";
import { createReportsRouter } from "./routes/reports";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_SESSION_TTL_DAYS = 7;

type AppOptions = {
  database: CivicDatabase;
  photos: PhotoStore;
  secureCookies?: boolean;
  sessionTtlDays?: number;
};

export function createApp(options: AppOptions) {
  const { database, photos } = options;
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";
  const sessionDurationMs =
    (options.sessionTtlDays ?? DEFAULT_SESSION_TTL_DAYS) * DAY_MS;
  const app = express();

  app.disable("x-powered-by");
  // Behind a platform proxy (Vercel) trust the first hop so secure cookies
  // and the rate limiter see the real client over x-forwarded-*.
  if (process.env.VERCEL) {
    app.set("trust proxy", 1);
  }
  // Photo attachments may be served from an external blob store in production.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { imgSrc: ["'self'", "data:", "https:"] },
      },
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
  });
  app.use("/api/auth", authLimiter);
  app.use("/api/setup", authLimiter);

  app.use(
    "/api",
    createAuthRouter({ database, secureCookies, sessionDurationMs }),
    createCatalogRouter({ database }),
  );
  app.use(
    "/api/reports",
    createReportsRouter({ database, photos }),
  );
  app.use("/api/notifications", createNotificationsRouter({ database }));
  app.use("/api/admin", createAdminRouter({ database }));
  if (photos.staticHandler) {
    app.use("/uploads", photos.staticHandler);
  }

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
    sendError(response, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
  });

  return {
    app,
    async close(): Promise<void> {
      await database.close();
    },
  };
}
