import { describe, expect, it } from "vitest";

import { reportGuidance } from "../src/lib/report-guidance";

describe("report guidance", () => {
  it("explains a recorded next step for each report status without promising response times", () => {
    const statuses = ["SUBMITTED", "UNDER_REVIEW", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

    for (const status of statuses) {
      const guidance = reportGuidance(status);
      expect(guidance.heading).not.toBe("");
      expect(guidance.explanation).not.toBe("");
      expect(guidance.residentAction).not.toBe("");
      expect(guidance.heading + guidance.explanation + guidance.residentAction)
        .not.toMatch(/guaranteed response|will be fixed by/i);
    }
  });

  it("distinguishes a recorded resolution from an independent inspection", () => {
    expect(reportGuidance("RESOLVED")).toMatchObject({
      heading: "The organization marked it resolved",
    });
    expect(reportGuidance("RESOLVED").explanation).toContain("not an independent inspection");
    expect(reportGuidance("RESOLVED").residentAction).toContain("still happening");
  });
});
