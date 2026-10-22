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

  it("provides installable raster icons and a network-required offline shell", () => {
    const manifest = JSON.parse(readFileSync(path.join(publicDirectory, "manifest.webmanifest"), "utf8"));
    expect(manifest.icons).toContainEqual(expect.objectContaining({ src: "/icon-192.png", sizes: "192x192", type: "image/png" }));
    expect(manifest.icons).toContainEqual(expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", type: "image/png" }));
    for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512]] as const) {
      const icon = readFileSync(path.join(publicDirectory, name));
      expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(icon.readUInt32BE(16)).toBe(size);
      expect(icon.readUInt32BE(20)).toBe(size);
    }
    const worker = readFileSync(path.join(publicDirectory, "sw.js"), "utf8");
    expect(worker).toContain("/offline.html");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(readFileSync(path.join(publicDirectory, "offline.html"), "utf8")).toContain("Your saved report draft remains on this device.");
  });
});
