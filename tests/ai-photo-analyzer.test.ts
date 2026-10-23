// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectProblemInPhoto, isPhotoAnalysisConfigured } from "../server/ai-photo-analyzer.js";

const successfulResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              problem: "A pothole is visible in the road.",
              detectedIssueType: "Roads and Sidewalks",
              suggestedCategoryName: "Roads and Sidewalks",
              suggestedTitle: "Pothole in roadway",
              suggestedDescription: "A pothole is visible in the roadway.",
              confidence: 0.91,
              detectedCues: ["Broken asphalt", "Road surface depression"],
            }),
          },
        ],
      },
    },
  ],
};

describe("Gemini photo analysis", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the image to the supported vision model using a server-side API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successfulResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const image = Buffer.from("test-image-bytes");
    const result = await detectProblemInPhoto(image, "image/png");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(options.body));

    expect(url).toContain("/models/gemini-3.5-flash:generateContent");
    expect(url).not.toContain("test-gemini-key");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-gemini-key",
    });
    expect(requestBody.contents[0].parts[1].inline_data).toEqual({
      mime_type: "image/png",
      data: image.toString("base64"),
    });
    expect(result.problem).toBe("A pothole is visible in the road.");
  });

  it("reports missing configuration instead of inventing a photo analysis", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(isPhotoAnalysisConfigured()).toBe(false);

    await expect(detectProblemInPhoto(Buffer.from("image"), "image/png"))
      .rejects.toMatchObject({ status: 503, code: "AI_NOT_CONFIGURED" });
  });

  it("limits suggested categories to the deployment's active category names", async () => {
    const invalidCategoryResponse = structuredClone(successfulResponse);
    invalidCategoryResponse.candidates[0].content.parts[0].text = JSON.stringify({
      problem: "A pothole is visible in the road.",
      detectedIssueType: "Roads and Sidewalks",
      suggestedCategoryName: "Made-up category",
      suggestedTitle: "Pothole in roadway",
      suggestedDescription: "A pothole is visible in the roadway.",
      confidence: 0.91,
      detectedCues: ["Broken asphalt"],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(invalidCategoryResponse), { status: 200 }),
    ));

    const result = await detectProblemInPhoto(
      Buffer.from("image"),
      "image/png",
      ["Roads and Sidewalks"],
    );

    expect(result.suggestedCategoryName).toBe("");
  });

  it("reports provider failures instead of returning heuristic output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("provider unavailable", { status: 503 }),
    ));

    await expect(detectProblemInPhoto(Buffer.from("image"), "image/png"))
      .rejects.toMatchObject({ status: 503, code: "AI_PROVIDER_UNAVAILABLE" });
  });
});
