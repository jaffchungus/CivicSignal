// First-run setup and identity: account creation, sign-in, sign-out, session.
import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";

import {
  REQUESTABLE_ROLES,
  type OrganizationKind,
  type UserRole,
} from "../../shared/contracts.js";
import type { CivicDatabase } from "../database.js";
import { ApiError, sendError } from "../http.js";
import {
  authenticate,
  createSession,
  currentUser,
  destroySession,
  revokeOtherSessions,
  userForSessionToken,
} from "../session.js";
import { recordAudit } from "../activity.js";
import { findUser } from "../users.js";

// Checked against unknown emails so sign-in takes the same bcrypt path either way.
// This hash belongs to no account; only its cost factor is used.
const ABSENT_USER_PASSWORD_HASH = "$2b$12$JxFW0YHrmenI8P0iStfuduLdPg2hiccPAqGiTfg4o7PBE10dB5Dk6";

const setupSchema = z.object({
  municipalityName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  role: z.enum(REQUESTABLE_ROLES).default("RESIDENT"),
  organizationId: z.string().trim().min(1).nullish(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

/** Roles other than resident may only be requested; administrators verify them. */
const EXPECTED_ORGANIZATION_KIND: Partial<Record<UserRole, OrganizationKind>> = {
  OFFICIAL: "PUBLIC_SERVICE",
  LAW_ENFORCEMENT: "LAW_ENFORCEMENT",
};

function normalizedEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

export function createAuthRouter(deps: {
  database: CivicDatabase;
  secureCookies: boolean;
  sessionDurationMs: number;
}): Router {
  const { database, secureCookies, sessionDurationMs } = deps;
  const router = Router();

  router.get("/setup/status", async (_request, response) => {
    const row = (await database.prepare("SELECT COUNT(*) AS count FROM users").get()) as {
      count: number;
    };
    response.json({ setupRequired: row.count === 0 });
  });

  router.post("/setup", async (request, response, next) => {
    try {
      const input = setupSchema.parse(request.body);
      const passwordHash = await bcrypt.hash(input.password, 12);
      const now = Date.now();
      const adminId = randomUUID();

      const result = await database.transaction(async () => {
        const existing = (await database.prepare("SELECT COUNT(*) AS count FROM users").get()) as {
          count: number;
        };
        if (existing.count !== 0) {
          return null;
        }

        // A unique settings claim serializes first-run setup across instances.
        // An uncommitted claim from another instance blocks this insert, then
        // returns no row, so only one administrator can be created.
        const claim = (await database
          .prepare(
            `INSERT INTO settings (key, value) VALUES ('system_initialized', ?)
             ON CONFLICT (key) DO NOTHING RETURNING key`,
          )
          .get(String(now))) as { key: string } | undefined;
        if (!claim) {
          return null;
        }

        await database
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

        await database
          .prepare("INSERT INTO settings (key, value) VALUES ('municipality_name', ?)")
          .run(input.municipalityName);

        await recordAudit(database, {
          actorUserId: adminId,
          action: "SYSTEM_INITIALIZED",
          targetType: "SYSTEM",
          targetId: "civicsignal",
          details: { municipalityName: input.municipalityName },
        });

        return adminId;
      });

      if (!result) {
        sendError(response, 409, "ALREADY_INITIALIZED", "CivicSignal is already initialized.");
        return;
      }

      await createSession(database, response, adminId, secureCookies, sessionDurationMs);
      const user = await findUser(database, adminId);
      response.status(201).json({
        user,
        organizations: [],
        categories: [],
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/session", async (request, response) => {
    const token = request.cookies?.civicsignal_session as string | undefined;
    const user = token ? await userForSessionToken(database, token) : null;
    response.json({ user });
  });

  router.post("/auth/register", async (request, response, next) => {
    try {
      const input = registerSchema.parse(request.body);
      const expectedKind = EXPECTED_ORGANIZATION_KIND[input.role];
      let organizationId: string | null = null;

      if (expectedKind) {
        if (!input.organizationId) {
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "The request contains invalid fields.",
            { organizationId: ["Select the organization you serve."] },
          );
        }
        const organization = (await database
          .prepare("SELECT id, kind FROM organizations WHERE id = ? AND active = 1")
          .get(input.organizationId)) as
          | { id: string; kind: OrganizationKind }
          | undefined;
        if (!organization || organization.kind !== expectedKind) {
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            "The request contains invalid fields.",
            {
              organizationId: [
                expectedKind === "LAW_ENFORCEMENT"
                  ? "Law-enforcement accounts must belong to a law-enforcement organization."
                  : "Official accounts must belong to a public-service organization.",
              ],
            },
          );
        }
        organizationId = organization.id;
      } else if (input.organizationId) {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "The request contains invalid fields.",
          { organizationId: ["Resident accounts are not attached to an organization."] },
        );
      }

      const existing = await database
        .prepare("SELECT id FROM users WHERE normalized_email = ?")
        .get(normalizedEmail(input.email));
      if (existing) {
        throw new ApiError(
          409,
          "EMAIL_TAKEN",
          "An account with this email address already exists.",
        );
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      const now = Date.now();
      const userId = randomUUID();
      // Official accounts stay inactive until an administrator verifies them.
      const status = input.role === "RESIDENT" ? "ACTIVE" : "PENDING";
      await database
        .prepare(
          `INSERT INTO users
            (id, display_name, email, normalized_email, password_hash, role, status,
             organization_id, verified_at, verified_by_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        )
        .run(
          userId,
          input.displayName,
          input.email.trim(),
          normalizedEmail(input.email),
          passwordHash,
          input.role,
          status,
          organizationId,
          now,
          now,
        );

      await createSession(database, response, userId, secureCookies, sessionDurationMs);
      response.status(201).json({ user: await findUser(database, userId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/login", async (request, response, next) => {
    try {
      const input = loginSchema.parse(request.body);
      const row = (await database
        .prepare(
          "SELECT id, password_hash, status FROM users WHERE normalized_email = ?",
        )
        .get(normalizedEmail(input.email))) as
        | { id: string; password_hash: string; status: string }
        | undefined;
      const passwordMatches = await bcrypt.compare(
        input.password,
        row?.password_hash ?? ABSENT_USER_PASSWORD_HASH,
      );
      if (!row || !passwordMatches) {
        sendError(response, 401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
        return;
      }
      if (row.status === "SUSPENDED") {
        sendError(
          response,
          403,
          "ACCOUNT_SUSPENDED",
          "This account has been suspended. Contact an administrator.",
        );
        return;
      }

      await createSession(database, response, row.id, secureCookies, sessionDurationMs);
      response.json({ user: await findUser(database, row.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/logout", async (request, response) => {
    await destroySession(database, request, response);
    response.status(204).end();
  });

  router.patch("/auth/profile", authenticate(database), async (request, response, next) => {
    try {
      const user = currentUser(request);
      const input = profileSchema.parse(request.body);
      await database
        .prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?")
        .run(input.displayName, Date.now(), user.id);

      await recordAudit(database, {
        actorUserId: user.id,
        action: "PROFILE_UPDATED",
        targetType: "USER",
        targetId: user.id,
        details: { displayName: input.displayName },
      });

      response.json({ user: await findUser(database, user.id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/auth/password", authenticate(database), async (request, response, next) => {
    try {
      const user = currentUser(request);
      const input = passwordChangeSchema.parse(request.body);
      const row = (await database
        .prepare("SELECT password_hash FROM users WHERE id = ?")
        .get(user.id)) as { password_hash: string } | undefined;
      const matches = row
        ? await bcrypt.compare(input.currentPassword, row.password_hash)
        : false;
      if (!matches) {
        sendError(
          response,
          401,
          "INVALID_CREDENTIALS",
          "The current password is incorrect.",
        );
        return;
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await database.transaction(async () => {
        await database
          .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
          .run(passwordHash, Date.now(), user.id);
        await revokeOtherSessions(database, request, user.id);
        await recordAudit(database, {
          actorUserId: user.id,
          action: "PASSWORD_CHANGED",
          targetType: "USER",
          targetId: user.id,
        });
      });

      response.json({ user: await findUser(database, user.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
