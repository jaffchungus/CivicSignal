import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import type { PublicUser } from "../shared/contracts";
import { openDatabase, type CivicDatabase } from "./database";

const SESSION_COOKIE = "civicsignal_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

type AppOptions = {
  databasePath: string;
  uploadDirectory: string;
  secureCookies?: boolean;
};

type UserRow = {
  id: string;
  display_name: string;
  email: string;
  role: PublicUser["role"];
  status: PublicUser["status"];
  organization_id: string | null;
  organization_name: string | null;
};

const setupSchema = z.object({
  municipalityName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

function normalizedEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function serializeUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  };
}

function findUser(database: CivicDatabase, id: string): PublicUser | null {
  const row = database
    .prepare(
      `SELECT users.id, users.display_name, users.email, users.role, users.status,
              users.organization_id, organizations.name AS organization_name
       FROM users
       LEFT JOIN organizations ON organizations.id = users.organization_id
       WHERE users.id = ?`,
    )
    .get(id) as UserRow | undefined;
  return row ? serializeUser(row) : null;
}

function createSession(
  database: CivicDatabase,
  response: Response,
  userId: string,
  secureCookies: boolean,
): void {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  database
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(sessionHash(token), userId, now, now + SESSION_DURATION_MS);
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: SESSION_DURATION_MS,
  });
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ error: { code, message } });
}

const DEFAULT_ORGANIZATIONS = [
  { key: "publicWorks", name: "Public Works", kind: "PUBLIC_SERVICE" },
  { key: "parks", name: "Parks and Recreation", kind: "PUBLIC_SERVICE" },
  { key: "police", name: "Police Department", kind: "LAW_ENFORCEMENT" },
] as const;

const DEFAULT_CATEGORIES = [
  ["Roads and Sidewalks", "Potholes, damaged sidewalks, and road hazards", "publicWorks"],
  ["Streetlights", "Broken or malfunctioning public streetlights", "publicWorks"],
  ["Trash and Sanitation", "Missed collection, dumping, and public waste", "publicWorks"],
  ["Parks and Recreation", "Maintenance issues in parks and public recreation areas", "parks"],
  ["Non-Emergency Public Safety", "Non-emergency concerns appropriate for local police", "police"],
] as const;

export function createApp(options: AppOptions) {
  mkdirSync(options.uploadDirectory, { recursive: true });
  const database = openDatabase(options.databasePath);
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/setup/status", (_request, response) => {
    const row = database.prepare("SELECT COUNT(*) AS count FROM users").get() as {
      count: number;
    };
    response.json({ setupRequired: row.count === 0 });
  });

  app.post("/api/setup", async (request, response, next) => {
    try {
      const input = setupSchema.parse(request.body);
      const passwordHash = await bcrypt.hash(input.password, 12);
      const now = Date.now();
      const adminId = randomUUID();

      const result = database.transaction(() => {
        const existing = database.prepare("SELECT COUNT(*) AS count FROM users").get() as {
          count: number;
        };
        if (existing.count !== 0) {
          return null;
        }

        database
          .prepare(
            `INSERT INTO users
              (id, display_name, email, normalized_email, password_hash, role, status,
               organization_id, verified_at, verified_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', NULL, ?, NULL, ?, ?)`,
          )
          .run(
            adminId,
            input.displayName,
            input.email.trim(),
            normalizedEmail(input.email),
            passwordHash,
            now,
            now,
            now,
          );

        database
          .prepare("INSERT INTO settings (key, value) VALUES ('municipality_name', ?)")
          .run(input.municipalityName);

        const organizationIds = new Map<string, string>();
        const insertOrganization = database.prepare(
          `INSERT INTO organizations (id, name, kind, active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        );
        for (const organization of DEFAULT_ORGANIZATIONS) {
          const id = randomUUID();
          organizationIds.set(organization.key, id);
          insertOrganization.run(id, organization.name, organization.kind, now, now);
        }

        const insertCategory = database.prepare(
          `INSERT INTO categories
            (id, name, description, organization_id, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        );
        for (const [name, description, organizationKey] of DEFAULT_CATEGORIES) {
          insertCategory.run(
            randomUUID(),
            name,
            description,
            organizationIds.get(organizationKey),
            now,
            now,
          );
        }

        database
          .prepare(
            `INSERT INTO audit_events
              (id, actor_user_id, action, target_type, target_id, details_json, created_at)
             VALUES (?, ?, 'SYSTEM_INITIALIZED', 'SYSTEM', 'civicsignal', ?, ?)`,
          )
          .run(
            randomUUID(),
            adminId,
            JSON.stringify({ municipalityName: input.municipalityName }),
            now,
          );

        return adminId;
      })();

      if (!result) {
        sendError(response, 409, "ALREADY_INITIALIZED", "CivicSignal is already initialized.");
        return;
      }

      createSession(database, response, adminId, secureCookies);
      const user = findUser(database, adminId);
      const organizations = database
        .prepare("SELECT id, name, kind, active FROM organizations ORDER BY name")
        .all();
      const categories = database
        .prepare(
          `SELECT categories.id, categories.name, categories.description,
                  categories.organization_id AS organizationId,
                  organizations.name AS organizationName
           FROM categories
           JOIN organizations ON organizations.id = categories.organization_id
           ORDER BY categories.name`,
        )
        .all();
      response.status(201).json({ user, organizations, categories });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/session", (request, response) => {
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) {
      response.json({ user: null });
      return;
    }
    const session = database
      .prepare(
        `SELECT user_id AS userId FROM sessions
         WHERE token_hash = ? AND expires_at > ?`,
      )
      .get(sessionHash(token), Date.now()) as { userId: string } | undefined;
    const user = session ? findUser(database, session.userId) : null;
    response.json({ user: user?.status === "ACTIVE" ? user : null });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
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
    console.error(error);
    sendError(response, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
  });

  return app;
}
