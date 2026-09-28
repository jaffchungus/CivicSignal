// @vitest-environment node

import { describe, expect, it } from "vitest";

import { toNumberedParameters } from "../server/database-postgres";

describe("postgres parameter rewriting", () => {
  it("numbers placeholders outside string literals only", () => {
    expect(
      toNumberedParameters("SELECT * FROM users WHERE id = ? AND status = 'PENDING'"),
    ).toBe("SELECT * FROM users WHERE id = $1 AND status = 'PENDING'");

    expect(toNumberedParameters("SELECT '?' AS q, a FROM t WHERE x = ? AND y = ?")).toBe(
      "SELECT '?' AS q, a FROM t WHERE x = $1 AND y = $2",
    );

    expect(toNumberedParameters("SELECT 'it''s fine' FROM t WHERE z = ?")).toBe(
      "SELECT 'it''s fine' FROM t WHERE z = $1",
    );

    expect(toNumberedParameters("SELECT 1")).toBe("SELECT 1");
  });
});
