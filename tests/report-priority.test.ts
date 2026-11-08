import { describe, expect, it } from "vitest";

import type { ReportStatus } from "../shared/contracts";
import {
  calculateReportPriority,
  NEARBY_REPORT_RADIUS_METERS,
  type NearbyReportPriorityInput,
} from "../server/report-priority";

const now = Date.UTC(2026, 10, 8, 12);
const oneDay = 24 * 60 * 60 * 1000;

function report(
  id: string,
  reporterId: string | null,
  overrides: Partial<NearbyReportPriorityInput> = {},
): NearbyReportPriorityInput {
  return {
    id,
    category_id: "roads",
    latitude: 39.7817,
    longitude: -89.6501,
    created_at: now - oneDay,
    reporter_user_id: reporterId,
    status: "SUBMITTED" as ReportStatus,
    ...overrides,
  };
}

describe("nearby report priority", () => {
  it("raises priority for distinct nearby reporters in the same category", () => {
    const target = report("target", "user-1");
    const candidates = [
      target,
      report("two", "user-2", { latitude: 39.7820 }),
      report("three", "user-3", { longitude: -89.6498 }),
      report("four", "user-4", { latitude: 39.7814 }),
      report("repeat", "user-2", { latitude: 39.7819 }),
      report("other-category", "user-5", { category_id: "parks" }),
      report("far-away", "user-6", { latitude: 39.8 }),
    ];

    expect(calculateReportPriority(target, candidates, now)).toEqual({
      level: "HIGH",
      reportCount: 5,
      reporterCount: 4,
      radiusMeters: NEARBY_REPORT_RADIUS_METERS,
      windowDays: 30,
    });
  });

  it("does not elevate repeated submissions from the same person", () => {
    const target = report("target", "user-1");
    const candidates = [
      target,
      report("same-person-1", "user-1", { latitude: 39.7818 }),
      report("same-person-2", "user-1", { latitude: 39.7819 }),
    ];

    expect(calculateReportPriority(target, candidates, now)).toMatchObject({
      level: "STANDARD",
      reportCount: 3,
      reporterCount: 1,
    });
  });

  it("ignores old, closed, and newly hidden reports", () => {
    const target = report("target", "user-1");
    const candidates = [
      target,
      report("old", "user-2", { created_at: now - 31 * oneDay }),
      report("resolved", "user-3", { status: "RESOLVED" }),
      report("closed", "user-4", { status: "CLOSED" }),
      report("recent", "user-5"),
    ];

    expect(calculateReportPriority(target, candidates, now)).toMatchObject({
      level: "ELEVATED",
      reportCount: 2,
      reporterCount: 2,
    });
  });

  it("does not assign priority to a report that is no longer active", () => {
    const target = report("target", "user-1", { status: "RESOLVED" });
    expect(calculateReportPriority(target, [target], now)).toBeNull();
  });
});
