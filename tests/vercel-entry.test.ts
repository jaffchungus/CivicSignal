// @vitest-environment node

import type { Request, Response } from "express";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const { createProductionApp } = vi.hoisted(() => ({ createProductionApp: vi.fn() }));
vi.mock("../server/production", () => ({ createProductionApp }));

afterEach(() => vi.restoreAllMocks());

class TestResponse extends EventEmitter {
  statusCode?: number;
  body?: unknown;

  status(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    this.emit("finish");
    return this;
  }
}

it("retries a failed cold start and then reuses the initialized app", async () => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = vi.fn((_request: Request, response: TestResponse) => {
    setTimeout(() => response.json({ ok: true }), 0);
  });
  createProductionApp.mockRejectedValueOnce(new Error("Temporary connection failure"))
    .mockResolvedValue({ app });
  const { default: handler } = await import("../api/index");
  const request = {} as Request;
  const response = new TestResponse();
  await handler(request, response as unknown as Response);
  expect(response.statusCode).toBe(500);
  expect(response.body).toEqual({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  });
  await handler(request, response as unknown as Response);
  expect(response.body).toEqual({ ok: true });
  await handler(request, response as unknown as Response);
  expect(createProductionApp).toHaveBeenCalledTimes(2);
  expect(app).toHaveBeenCalledTimes(2);
});
