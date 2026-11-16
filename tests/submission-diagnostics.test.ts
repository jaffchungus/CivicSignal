// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createStepTrace, describeError, runStep } from "../server/diagnostics";
import { ApiError } from "../server/http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submission diagnostics", () => {
  it("names the failing step and includes pg error code and constraint details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const trace = createStepTrace({ route: "POST /api/reports", userId: "user-1" });
    trace.reportId = "report-1";
    const failure = Object.assign(
      new Error('duplicate key value violates unique constraint "reports_reference_code_key"'),
      {
        code: "23505",
        detail: "Key (reference_code)=(CS-2026-0007) already exists.",
        constraint: "reports_reference_code_key",
        table: "reports",
        schema: "public",
        severity: "ERROR",
      },
    );

    await expect(runStep(trace, "next-reference-code", async () => {
      throw failure;
    })).rejects.toBe(failure);

    expect(log).toHaveBeenCalledTimes(1);
    const [message, context] = log.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("report submission failed");
    expect(context).toMatchObject({
      route: "POST /api/reports",
      step: "next-reference-code",
      userId: "user-1",
      reportId: "report-1",
      error: {
        code: "23505",
        constraint: "reports_reference_code_key",
        table: "reports",
        detail: "Key (reference_code)=(CS-2026-0007) already exists.",
      },
    });
    expect(String((context.error as Record<string, unknown>).stack)).toContain(
      "submission-diagnostics",
    );
  });

  it("logs once, naming the innermost step that failed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const trace = createStepTrace({ route: "POST /api/reports", userId: null });
    const failure = Object.assign(new Error("Connection terminated unexpectedly"), {
      code: "ECONNRESET",
    });

    await expect(
      runStep(trace, "persist-report", () =>
        runStep(trace, "insert-report-row", async () => {
          throw failure;
        }),
      ),
    ).rejects.toBe(failure);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toMatchObject({ step: "insert-report-row" });
    expect(trace.lastCompletedStep).toBeUndefined();
  });

  it("stays quiet for expected client errors and records completed steps", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const trace = createStepTrace({ route: "POST /api/reports", userId: null });

    await expect(runStep(trace, "validate-input", async () => {
      throw new ApiError(422, "VALIDATION_ERROR", "The request contains invalid fields.");
    })).rejects.toBeInstanceOf(ApiError);
    expect(log).not.toHaveBeenCalled();

    await runStep(trace, "load-categories", async () => undefined);
    expect(trace.lastCompletedStep).toBe("load-categories");

    expect(describeError(new Error("plain failure")).message).toBe("plain failure");
    expect(describeError("thrown string")).toEqual({ message: "thrown string", thrownValue: "string" });
  });

  it("keeps an ApiError application code separate from a database code", () => {
    const described = describeError(new ApiError(503, "PHOTO_STORAGE_UNAVAILABLE", "unavailable"));
    expect(described).toMatchObject({ status: 503, apiCode: "PHOTO_STORAGE_UNAVAILABLE" });
    expect(described.code).toBeUndefined();
  });
});
