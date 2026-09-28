// HTTP protocol helpers shared by the composition root and the routes.
import type { Request, Response } from "express";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ error: { code, message } });
}

/** Returns a single path parameter value (Express 5 types params as string | string[]). */
export function pathId(request: Request, name: string): string {
  const value = request.params[name];
  return typeof value === "string" ? value : "";
}

/** Serializes a stored millisecond timestamp for the wire. */
export function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
