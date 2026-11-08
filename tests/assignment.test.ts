import { describe, expect, it } from "vitest";

import { chooseNearestAssignee, type AssigneeCandidate } from "../server/jurisdiction";

const reportCoordinates = { latitude: 39.7817, longitude: -89.6501 };

function candidate(
  id: string,
  municipalityId: string | null,
  latitude: number | null,
  longitude: number | null,
  createdAt = 1,
): AssigneeCandidate {
  return {
    id,
    displayName: id,
    organizationId: `${id}-organization`,
    organizationName: `${id} organization`,
    municipalityId,
    latitude,
    longitude,
    createdAt,
  };
}

describe("nearest staff assignment", () => {
  it("chooses the closest person inside the report municipality over an even closer person elsewhere", () => {
    const chosen = chooseNearestAssignee(
      [
        candidate("same-municipality-far", "municipality-a", 40.1, -89.9, 2),
        candidate("same-municipality-near", "municipality-a", 39.9, -89.8, 3),
        candidate("closer-elsewhere", "municipality-b", 39.7818, -89.6501, 1),
      ],
      "municipality-a",
      reportCoordinates,
    );

    expect(chosen?.id).toBe("same-municipality-near");
  });

  it("falls back to the closest person in any municipality when the report municipality has none", () => {
    const chosen = chooseNearestAssignee(
      [
        candidate("far-away", "municipality-b", 40.2, -89.9, 1),
        candidate("nearest", "municipality-c", 39.782, -89.6502, 2),
      ],
      "municipality-a",
      reportCoordinates,
    );

    expect(chosen?.id).toBe("nearest");
  });

  it("uses the earliest created eligible person when coordinates are unavailable", () => {
    const chosen = chooseNearestAssignee(
      [
        candidate("later", "municipality-a", null, null, 20),
        candidate("earlier", "municipality-a", null, null, 10),
      ],
      "municipality-a",
      reportCoordinates,
    );

    expect(chosen?.id).toBe("earlier");
  });

  it("returns null when the organization has no eligible staff", () => {
    expect(chooseNearestAssignee([], "municipality-a", reportCoordinates)).toBeNull();
  });
});