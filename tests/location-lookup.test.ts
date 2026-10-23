// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupApplications, testApplicationWithUploads } from "./api/helpers";

afterEach(async () => {
  await cleanupApplications();
  vi.unstubAllEnvs();
});

describe("location lookup", () => {
  it("returns provider attribution for the UI", async () => {
    const { app } = await testApplicationWithUploads();
    const response = await request(app).get("/api/location/attribution").expect(200);
    const body = response.body as {
      providerName?: string;
      attribution?: string;
      attributionUrl?: string;
      policyUrl?: string;
      usageNote?: string;
    };

    expect(body.providerName).toBeDefined();
    expect(body.attribution).toBeDefined();
    expect(body.usageNote).toBeDefined();
  });

  it("rejects invalid coordinates", async () => {
    const { app } = await testApplicationWithUploads();
    await request(app)
      .post("/api/location/reverse")
      .send({ latitude: "invalid", longitude: 0 })
      .expect(422);
  });

  it("rejects coordinates outside valid ranges", async () => {
    const { app } = await testApplicationWithUploads();
    await request(app)
      .post("/api/location/reverse")
      .send({ latitude: 91, longitude: 0 })
      .expect(422);
  });

  it("handles lookup service unavailability gracefully", async () => {
    vi.stubEnv("REVERSE_GEOCODER_URL", "https://invalid-endpoint.example/reverse");
    const { app } = await testApplicationWithUploads();
    const response = await request(app)
      .post("/api/location/reverse")
      .send({ latitude: 40.7128, longitude: -74.0060 })
      .expect(503);

    expect(response.body.error.code).toBe("ADDRESS_LOOKUP_UNAVAILABLE");
  });

  it("requires HTTPS endpoints for security", async () => {
    vi.stubEnv("REVERSE_GEOCODER_URL", "http://nominatim.openstreetmap.org/reverse");
    const { app } = await testApplicationWithUploads();
    await request(app)
      .post("/api/location/reverse")
      .send({ latitude: 40.7128, longitude: -74.0060 })
      .expect(503);
  });
});
