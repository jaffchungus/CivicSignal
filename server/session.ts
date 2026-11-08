// Sessions and request authentication — the security boundary. Everything that
// answers "who is asking, and may they?" lives here.
import { createHash, randomBytes } from "node:crypto";

import type { Request, RequestHandler, Response } from "express";

import { isStaffRole, type PublicUser, type UserRole } from "../shared/contracts.js";
import type { CivicDatabase } from "./database.js";
import { ApiError } from "./http.js";
import { findUser } from "./users.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicUser;
    }
  }
}

export const SESSION_COOKIE = "civicsignal_session";

/**
 * HTTPS deployments use the `__Host-` prefix: browsers reject such a cookie
 * unless it is Secure, has Path=/, and carries no Domain, so a sibling
 * subdomain cannot set or overwrite the session. Plain-HTTP development keeps
 * the unprefixed name because `__Host-` cookies are only stored over HTTPS.
 */
const HOST_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;

export function sessionCookieName(secureCookies: boolean): string {
  return secureCookies ? HOST_SESSION_COOKIE : SESSION_COOKIE;
}

/** Sessions last two hours by default, measured absolutely from sign-in. */
export const DEFAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1_000;

/**
 * Reads SESSION_TTL_HOURS. A missing, non-numeric, or non-positive value falls
 * back to the default instead of expiring sessions immediately.
 */
export function resolveSessionTtlMs(
  environment: Record<string, string | undefined> = process.env,
): number {
  const configured = environment.SESSION_TTL_HOURS;
  if (configured === undefined || configured.trim() === "") return DEFAULT_SESSION_TTL_MS;
  const hours = Number(configured);
  return Number.isFinite(hours) && hours > 0
    ? Math.round(hours * 60 * 60 * 1_000)
    : DEFAULT_SESSION_TTL_MS;
}

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolves the active user behind a session token, or null. */
export async function userForSessionToken(
  database: CivicDatabase,
  token: string,
): Promise<PublicUser | null> {
  const session = (await database
    .prepare(
      `SELECT user_id AS "userId" FROM sessions
       WHERE token_hash = ? AND expires_at > ?`,
    )
    .get(sessionHash(token), Date.now())) as { userId: string } | undefined;
  return session ? findUser(database, session.userId) : null;
}

export async function createSession(
  database: CivicDatabase,
  response: Response,
  userId: string,
  secureCookies: boolean,
  sessionDurationMs: number,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await database
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(sessionHash(token), userId, now, now + sessionDurationMs);
  const cookieName = sessionCookieName(secureCookies);
  response.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: sessionDurationMs,
  });
  if (cookieName !== SESSION_COOKIE) {
    // Drop any pre-`__Host-` cookie so a stale duplicate cannot linger after
    // an upgrade.
    response.clearCookie(SESSION_COOKIE, { path: "/" });
  }
}

/** Ends every session for a user except the one making this request. */
export async function revokeOtherSessions(
  database: CivicDatabase,
  request: Request,
  userId: string,
  cookieName: string,
): Promise<void> {
  const token = request.cookies?.[cookieName] as string | undefined;
  if (!token) return;
  await database
    .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?")
    .run(userId, sessionHash(token));
}

export async function destroySession(
  database: CivicDatabase,
  request: Request,
  response: Response,
  secureCookies: boolean,
): Promise<void> {
  const cookieName = sessionCookieName(secureCookies);
  const token = request.cookies?.[cookieName] as string | undefined;
  if (token) {
    await database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash(token));
  }
  response.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
  });
  if (cookieName !== SESSION_COOKIE) {
    response.clearCookie(SESSION_COOKIE, { path: "/" });
  }
}

/** Resolves the session user and rejects unauthenticated or inactive accounts. */
export function authenticate(database: CivicDatabase, cookieName: string): RequestHandler {
  return async (request, _response, next) => {
    try {
      const token = request.cookies?.[cookieName] as string | undefined;
      if (!token) {
        next(new ApiError(401, "AUTH_REQUIRED", "Sign in to continue."));
        return;
      }
      const user = await userForSessionToken(database, token);
      if (!user) {
        next(new ApiError(401, "AUTH_REQUIRED", "Sign in to continue."));
        return;
      }
      if (user.status !== "ACTIVE") {
        next(
          new ApiError(
            403,
            "ACCOUNT_NOT_ACTIVE",
            user.status === "PENDING"
              ? "This account is awaiting administrator verification."
              : "This account has been suspended.",
          ),
        );
        return;
      }
      request.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (request, _response, next) => {
    const user = currentUser(request);
    if (!roles.includes(user.role)) {
      next(
        new ApiError(
          403,
          "FORBIDDEN",
          "Your account does not have permission to perform this action.",
        ),
      );
      return;
    }
    next();
  };
}

/** Official workflow actions require a verified staff account with an organization. */
export function requireStaff(): RequestHandler {
  return (request, _response, next) => {
    const user = currentUser(request);
    if (!isStaffRole(user.role) || !user.organizationId) {
      next(
        new ApiError(
          403,
          "FORBIDDEN",
          "Your account does not have permission to perform this action.",
        ),
      );
      return;
    }
    next();
  };
}

export function currentUser(request: Request): PublicUser {
  const user = request.authUser;
  if (!user) {
    throw new ApiError(401, "AUTH_REQUIRED", "Sign in to continue.");
  }
  return user;
}
