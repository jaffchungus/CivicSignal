// Sessions and request authentication — the security boundary. Everything that
// answers "who is asking, and may they?" lives here.
import { createHash, randomBytes } from "node:crypto";

import type { Request, RequestHandler, Response } from "express";

import { isStaffRole, type PublicUser, type UserRole } from "../shared/contracts";
import type { CivicDatabase } from "./database";
import { ApiError } from "./http";
import { findUser } from "./users";

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicUser;
    }
  }
}

export const SESSION_COOKIE = "civicsignal_session";

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolves the active user behind a session token, or null. */
export function userForSessionToken(
  database: CivicDatabase,
  token: string,
): PublicUser | null {
  const session = database
    .prepare(
      `SELECT user_id AS userId FROM sessions
       WHERE token_hash = ? AND expires_at > ?`,
    )
    .get(sessionHash(token), Date.now()) as { userId: string } | undefined;
  return session ? findUser(database, session.userId) : null;
}

export function createSession(
  database: CivicDatabase,
  response: Response,
  userId: string,
  secureCookies: boolean,
  sessionDurationMs: number,
): void {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  database
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(sessionHash(token), userId, now, now + sessionDurationMs);
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: sessionDurationMs,
  });
}

export function destroySession(
  database: CivicDatabase,
  request: Request,
  response: Response,
): void {
  const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash(token));
  }
  response.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Resolves the session user and rejects unauthenticated or inactive accounts. */
export function authenticate(database: CivicDatabase): RequestHandler {
  return (request, _response, next) => {
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) {
      next(new ApiError(401, "AUTH_REQUIRED", "Sign in to continue."));
      return;
    }
    const user = userForSessionToken(database, token);
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
