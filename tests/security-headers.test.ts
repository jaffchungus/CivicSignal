// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attachClient } from "../server/app";
import {
  CROSS_ORIGIN_OPENER_POLICY,
  CROSS_ORIGIN_RESOURCE_POLICY,
  PERMISSIONS_POLICY,
  PRODUCTION_CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
  STRICT_TRANSPORT_SECURITY,
  contentSecurityPolicy,
} from "../server/security-policy";
import { cleanupApplications, testApplication } from "./api/helpers";

const DOCUMENT = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="UTF-8" /><title>CivicSignal</title></head>',
  '<body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
].join("");

type Headers = Record<string, unknown>;

function header(response: { headers: Headers }, name: string): string | undefined {
  const value = response.headers[name];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : undefined;
}

function directive(policy: string | undefined, name: string): string | undefined {
  if (!policy) return undefined;
  for (const part of policy.split(";")) {
    const [key, ...values] = part.trim().split(/\s+/);
    if (key === name) return values.join(" ");
  }
  return undefined;
}

function expectProductionSecurityHeaders(response: { headers: Headers }): void {
  const csp = header(response, "content-security-policy");
  expect(csp).toBe(PRODUCTION_CONTENT_SECURITY_POLICY);
  expect(directive(csp, "default-src")).toBe("'self'");
  expect(directive(csp, "script-src")).toBe("'self'");
  expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
  expect(directive(csp, "script-src")).not.toContain("unsafe-eval");
  expect(directive(csp, "style-src")).toBe("'self'");
  expect(directive(csp, "base-uri")).toBe("'self'");
  expect(directive(csp, "object-src")).toBe("'none'");
  expect(directive(csp, "frame-ancestors")).toBe("'none'");
  expect(directive(csp, "frame-src")).toBe("'none'");
  expect(directive(csp, "child-src")).toBe("'none'");
  expect(directive(csp, "worker-src")).toBe("'self'");
  expect(directive(csp, "connect-src")).toBe("'self'");
  expect(directive(csp, "font-src")).toBe("'self'");
  expect(directive(csp, "form-action")).toBe("'self'");
  expect(directive(csp, "img-src")).toContain(
    "https://*.tile.openstreetmap.org",
  );
  expect(csp).toContain("upgrade-insecure-requests");
  expect(csp).not.toContain("nonce-");
  expect(header(response, "strict-transport-security")).toBe(
    STRICT_TRANSPORT_SECURITY,
  );
  expect(header(response, "x-content-type-options")).toBe("nosniff");
  expect(header(response, "x-frame-options")).toBe("DENY");
  expect(header(response, "referrer-policy")).toBe(REFERRER_POLICY);
  expect(header(response, "permissions-policy")).toBe(PERMISSIONS_POLICY);
  expect(header(response, "cross-origin-opener-policy")).toBe(
    CROSS_ORIGIN_OPENER_POLICY,
  );
  expect(header(response, "cross-origin-resource-policy")).toBe(
    CROSS_ORIGIN_RESOURCE_POLICY,
  );
}

let clientDirectory: string;
let productionApp: Express;
let developmentApp: Express;

beforeAll(async () => {
  clientDirectory = await mkdtemp(path.join(tmpdir(), "civicsignal-client-"));
  await mkdir(path.join(clientDirectory, "assets"), { recursive: true });
  await writeFile(path.join(clientDirectory, "index.html"), DOCUMENT);
  await writeFile(
    path.join(clientDirectory, "assets", "app.js"),
    "console.log('app');",
  );

  productionApp = await testApplication({ secureCookies: true });
  attachClient(productionApp, clientDirectory);
  developmentApp = await testApplication();
  attachClient(developmentApp, clientDirectory);
});

afterAll(async () => {
  await cleanupApplications();
  await rm(clientDirectory, { recursive: true, force: true });
});

describe("security response headers", () => {
  it("hardens the production HTML document and SPA fallback", async () => {
    const page = await request(productionApp).get("/").expect(200);
    expect(header(page, "content-type")).toContain("text/html");
    expectProductionSecurityHeaders(page);
    expect(header(page, "cache-control") ?? "").not.toContain("no-store");

    const spaRoute = await request(productionApp).get("/reports/example").expect(200);
    expect(header(spaRoute, "content-type")).toContain("text/html");
    expectProductionSecurityHeaders(spaRoute);
  });

  it("hardens API responses and keeps sensitive ones out of caches", async () => {
    for (const [route, status] of [
      ["/api/setup/status", 200],
      ["/api/auth/session", 200],
      ["/api/notifications", 401],
    ] as const) {
      const response = await request(productionApp).get(route).expect(status);
      expectProductionSecurityHeaders(response);
      expect(header(response, "cache-control")).toBe("private, no-store");
      expect(header(response, "content-type")).toContain("application/json");
    }
  });

  it("keeps HTTPS-only protections off during plain-HTTP development", async () => {
    const response = await request(developmentApp).get("/").expect(200);
    const csp = header(response, "content-security-policy");
    expect(csp).toBe(contentSecurityPolicy(false));
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(header(response, "strict-transport-security")).toBeUndefined();
    expect(directive(csp, "frame-ancestors")).toBe("'none'");
    expect(directive(csp, "script-src")).toBe("'self'");
    expect(header(response, "x-frame-options")).toBe("DENY");
    expect(header(response, "permissions-policy")).toBe(PERMISSIONS_POLICY);
  });

  it("serves hashed assets with immutable caching", async () => {
    const response = await request(productionApp).get("/assets/app.js").expect(200);
    expect(header(response, "cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(header(response, "content-type")).toContain("javascript");
  });

  it("mirrors the application policy in the Vercel CDN configuration", () => {
    const config = JSON.parse(readFileSync(path.resolve("vercel.json"), "utf8")) as {
      headers?: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
    };
    const entries = config.headers ?? [];
    const global = entries.find((entry) => entry.source === "/(.*)");
    expect(global).toBeDefined();
    const values = new Map(
      (global?.headers ?? []).map((entry) => [entry.key.toLowerCase(), entry.value]),
    );
    expect(values.get("content-security-policy")).toBe(
      PRODUCTION_CONTENT_SECURITY_POLICY,
    );
    expect(values.get("strict-transport-security")).toBe(STRICT_TRANSPORT_SECURITY);
    expect(values.get("x-content-type-options")).toBe("nosniff");
    expect(values.get("x-frame-options")).toBe("DENY");
    expect(values.get("referrer-policy")).toBe(REFERRER_POLICY);
    expect(values.get("permissions-policy")).toBe(PERMISSIONS_POLICY);
    expect(values.get("cross-origin-opener-policy")).toBe(
      CROSS_ORIGIN_OPENER_POLICY,
    );
    expect(values.get("cross-origin-resource-policy")).toBe(
      CROSS_ORIGIN_RESOURCE_POLICY,
    );

    const assets = entries.find((entry) => entry.source === "/assets/(.*)");
    expect(assets?.headers).toContainEqual({
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    });
  });

  it("ships documents with no inline scripts or styles, so no inline relaxations are needed", () => {
    for (const document of ["index.html", "public/offline.html"]) {
      const html = readFileSync(path.resolve(document), "utf8");
      expect(html, document).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html, document).not.toMatch(/<style[\s>]/i);
      expect(html, document).not.toMatch(/\sstyle\s*=/i);
    }
    for (const file of readdirSync(path.resolve("src"), {
      recursive: true,
      encoding: "utf8",
    })) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(path.resolve("src", file), "utf8");
      expect(source, file).not.toMatch(/<style[\s>]/i);
    }
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toContain("nonce-");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
  });
});
