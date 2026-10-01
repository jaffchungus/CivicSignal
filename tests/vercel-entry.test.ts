// @vitest-environment node

import type { Request, Response } from "express";
import { afterEach, expect, it, vi } from "vitest";

const { createProductionApp } = vi.hoisted(() => ({ createProductionApp: vi.fn() }));
vi.mock("../server/production", () => ({ createProductionApp }));

afterEach(() => vi.restoreAllMocks());

it("retries a failed cold start and then reuses the initialized app", async () => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = vi.fn();
  createProductionApp.mockRejectedValueOnce(new Error("Temporary connection failure"))
    .mockResolvedValue({ app });
  const { default: handler } = await import("../api/index");
  const request = {} as Request;
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(request, response as unknown as Response);
  expect(response.status).toHaveBeenCalledWith(500);
  expect(response.json).toHaveBeenCalledWith({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  });
  await handler(request, response as unknown as Response);
  await handler(request, response as unknown as Response);
  expect(createProductionApp).toHaveBeenCalledTimes(2);
  expect(app).toHaveBeenCalledTimes(2);
});
