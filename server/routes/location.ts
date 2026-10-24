import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import type { CivicDatabase } from "../database.js";
import { ApiError } from "../http.js";

const NOMINATIM_SLOT_KEY = "location_lookup_next_slot";
const CACHE_TTL_MS = 30 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 500;
const addressCache = new Map<string, { address: string; expiresAt: number }>();

function reverseGeocoderInfo() {
  const configuredEndpoint = process.env.REVERSE_GEOCODER_URL || "https://nominatim.openstreetmap.org/reverse";
  let usesNominatim = false;
  try {
    usesNominatim = new URL(configuredEndpoint).hostname === "nominatim.openstreetmap.org";
  } catch {
    // An invalid endpoint will produce a safe lookup error when the button is used.
  }
  return {
    providerName: process.env.REVERSE_GEOCODER_NAME || (usesNominatim ? "OpenStreetMap Nominatim" : "Address lookup service"),
    attribution: process.env.REVERSE_GEOCODER_ATTRIBUTION || (usesNominatim ? "© OpenStreetMap contributors" : ""),
    attributionUrl: process.env.REVERSE_GEOCODER_ATTRIBUTION_URL || (usesNominatim ? "https://www.openstreetmap.org/copyright" : ""),
    policyUrl: process.env.REVERSE_GEOCODER_POLICY_URL || (usesNominatim ? "https://operations.osmfoundation.org/policies/nominatim/" : ""),
    usageNote: process.env.REVERSE_GEOCODER_USAGE_NOTE || (usesNominatim
      ? "This optional public lookup is limited to one request per second and may be unavailable. The exact GPS pin is saved separately. Do not submit confidential information to the lookup service."
      : "Use current-location lookup only when needed."),
  };
}

const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

type ReverseResult = { display_name?: unknown };

export function createLocationRouter(deps: { database: CivicDatabase }): Router {
  const router = Router();
  const lookupLimiter = rateLimit({
    windowMs: 60 * 60 * 1_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Please wait before looking up another address." } },
  });

  router.get("/location/attribution", (_request, response) => {
    response.json(reverseGeocoderInfo());
  });

  router.post("/location/reverse", lookupLimiter, async (request, response) => {
    const coordinates = coordinateSchema.safeParse(request.body);
    if (!coordinates.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "A valid device location is required.");
    }

    const { latitude, longitude } = coordinates.data;
    const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = addressCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      response.json({ address: cached.address });
      return;
    }
    if (cached) addressCache.delete(cacheKey);

    await reserveNominatimSlot(deps.database);
    const queuedCache = addressCache.get(cacheKey);
    if (queuedCache && queuedCache.expiresAt > Date.now()) {
      response.json({ address: queuedCache.address });
      return;
    }
    let endpoint: URL;
    try {
      endpoint = new URL(process.env.REVERSE_GEOCODER_URL || "https://nominatim.openstreetmap.org/reverse");
    } catch {
      throw new ApiError(503, "ADDRESS_LOOKUP_UNAVAILABLE", "Address lookup is temporarily unavailable.");
    }
    if (endpoint.protocol !== "https:") {
      throw new ApiError(503, "ADDRESS_LOOKUP_UNAVAILABLE", "Address lookup is temporarily unavailable.");
    }
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("zoom", "18");
    endpoint.searchParams.set("addressdetails", "1");
    endpoint.searchParams.set("lat", String(latitude));
    endpoint.searchParams.set("lon", String(longitude));

    let address: string;
    try {
      const appOrigin = process.env.APP_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
      const contact = process.env.REVERSE_GEOCODER_CONTACT;
      const result = await fetch(endpoint, {
        headers: {
          "User-Agent": `CivicSignal/1.0 (${appOrigin}${contact ? `; ${contact}` : ""})`,
          Referer: appOrigin,
          ...(request.get("accept-language") ? { "Accept-Language": request.get("accept-language")! } : {}),
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!result.ok) throw new Error("Address lookup failed.");
      const body = await result.json() as ReverseResult;
      address = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 300) : "";
    } catch {
      throw new ApiError(503, "ADDRESS_LOOKUP_UNAVAILABLE", "Address lookup is temporarily unavailable. Enter the address manually.");
    }
    if (!address) {
      throw new ApiError(404, "ADDRESS_NOT_FOUND", "No street address was found nearby. Enter the address, intersection, or landmark manually.");
    }

    if (addressCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = addressCache.keys().next().value;
      if (firstKey) addressCache.delete(firstKey);
    }
    addressCache.set(cacheKey, { address, expiresAt: Date.now() + CACHE_TTL_MS });
    response.json({ address });
  });

  return router;
}

async function reserveNominatimSlot(database: CivicDatabase): Promise<void> {
  let waitMs = 0;
  await database.transaction(async () => {
    await database.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    ).run(NOMINATIM_SLOT_KEY, "0");
    for (;;) {
      const row = await database.prepare("SELECT value FROM settings WHERE key = ?")
        .get(NOMINATIM_SLOT_KEY) as { value: string };
      const now = Date.now();
      const lastSlot = Number(row.value.split(":", 1)[0]) || 0;
      const nextSlot = Math.max(now, lastSlot + 1_000);
      const reservation = `${nextSlot}:${randomUUID()}`;
      await database.prepare("UPDATE settings SET value = ? WHERE key = ? AND value = ?")
        .run(reservation, NOMINATIM_SLOT_KEY, row.value);
      const updated = await database.prepare("SELECT value FROM settings WHERE key = ?")
        .get(NOMINATIM_SLOT_KEY) as { value: string };
      if (updated.value === reservation) {
        waitMs = nextSlot - now;
        return;
      }
    }
  });
  if (waitMs > 0) await delay(waitMs);
}
