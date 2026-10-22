// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

describe("public metadata assets", () => {
  it("provides crawl rules for the public landing page and excludes account routes", () => {
    const robots = readFileSync(path.join(publicDirectory, "robots.txt"), "utf8");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /reports/");
    expect(robots).toContain("Sitemap: https://civicsignal-tau.vercel.app/sitemap.xml");
  });

  it("keeps the sitemap limited to public pages", () => {
    const sitemap = readFileSync(path.join(publicDirectory, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("https://civicsignal-tau.vercel.app/");
    expect(sitemap).not.toMatch(/\/api\/|\/admin|\/reports\//);
  });

  it("provides a valid manifest and a real ICO file", () => {
    const manifest = JSON.parse(readFileSync(path.join(publicDirectory, "manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ name: expect.stringContaining("CivicSignal"), start_url: "/" });
    expect(manifest.icons).toContainEqual(expect.objectContaining({ src: "/favicon.svg", type: "image/svg+xml" }));

    const icon = readFileSync(path.join(publicDirectory, "favicon.ico"));
    expect(icon.subarray(0, 6)).toEqual(Buffer.from([0, 0, 1, 0, 1, 0]));
    expect(icon.readUInt16LE(12)).toBe(32);
  });
});
