// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectProblemInPhoto, isPhotoAnalysisConfigured } from "../server/ai-photo-analyzer.js";

const successfulResponse: {
  candidates: Array<{ content: { parts: Array<{ text: string; thought?: boolean }> } }>;
} = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              problem: "A pothole is visible in the road.",
              suggestedCategoryId: "roads",
              suggestedTitle: "Pothole in roadway",
              suggestedDescription: "A pothole is visible in the roadway.",
              confidence: 0.91,
              detectedCues: ["Broken asphalt", "Road surface depression"],
              isSpam: false,
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
    vi.stubEnv("DISABLE_GEMINI_PHOTO_ANALYSIS", "false");
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
    const result = await detectProblemInPhoto(image, "image/png", [{
      id: "roads",
      name: "Roads and Sidewalks",
      description: "Road and sidewalk repairs",
      organizationName: "Public Works",
    }]);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(options.body));

    expect(url).toContain("/models/gemini-3-flash-preview:generateContent");
    expect(url).not.toContain("test-gemini-key");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-gemini-key",
    });
    expect(requestBody.contents[0].parts[1].inline_data).toEqual({
      mime_type: "image/png",
      data: image.toString("base64"),
    });
    expect(requestBody.contents[0].parts[0].text).toContain("Public Works");
    expect(result.problem).toBe("A pothole is visible in the road.");
    expect(result.suggestedCategoryId).toBe("roads");
  });

  it("ignores Gemini thought parts and parses the final JSON response", async () => {
    const responseWithThought = structuredClone(successfulResponse);
    responseWithThought.candidates[0].content.parts.unshift({
      text: "I should inspect the image and choose a category.",
      thought: true,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseWithThought), { status: 200 }),
    ));

    await expect(detectProblemInPhoto(Buffer.from("image"), "image/png", [{
      id: "roads",
      name: "Roads and Sidewalks",
      description: "Road and sidewalk repairs",
      organizationName: "Public Works",
    }]))
      .resolves.toMatchObject({
        problem: "A pothole is visible in the road.",
        suggestedCategoryId: "roads",
      });
  });

  it("reports missing configuration instead of inventing a photo analysis", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(isPhotoAnalysisConfigured()).toBe(false);

    await expect(detectProblemInPhoto(Buffer.from("image"), "image/png"))
      .rejects.toMatchObject({ status: 503, code: "AI_NOT_CONFIGURED" });
  });

  it("limits suggested categories to deployment routes and organizations", async () => {
    const invalidCategoryResponse = structuredClone(successfulResponse);
    invalidCategoryResponse.candidates[0].content.parts[0].text = JSON.stringify({
      problem: "A pothole is visible in the road.",
      suggestedCategoryId: "not-configured",
      suggestedTitle: "Pothole in roadway",
      suggestedDescription: "A pothole is visible in the roadway.",
      confidence: 0.91,
      detectedCues: ["Broken asphalt"],
      isSpam: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(invalidCategoryResponse), { status: 200 }),
    ));

    const result = await detectProblemInPhoto(
      Buffer.from("image"),
      "image/png",
      [{
        id: "roads",
        name: "Roads and Sidewalks",
        description: "Road and sidewalk repairs",
        organizationName: "Public Works",
      }],
    );

    expect(result.suggestedCategoryId).toBe("");
  });

  it("reports provider failures instead of returning heuristic output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("provider unavailable", { status: 503 }),
    ));

    await expect(detectProblemInPhoto(Buffer.from("image"), "image/png"))
      .rejects.toMatchObject({ status: 503, code: "AI_PROVIDER_UNAVAILABLE" });
  });

  it("detects spam images", async () => {
    const spamResponse = structuredClone(successfulResponse);
    spamResponse.candidates[0].content.parts[0].text = JSON.stringify({
      problem: "A meme image with text overlay",
      suggestedCategoryId: "roads",
      suggestedTitle: "Meme image",
      suggestedDescription: "This appears to be a meme or unrelated content.",
      confidence: 0.5,
      detectedCues: ["Text overlay", "Meme format"],
      isSpam: true,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(spamResponse), { status: 200 }),
    ));

    const result = await detectProblemInPhoto(
      Buffer.from("image"),
      "image/png",
      [{
        id: "roads",
        name: "Roads and Sidewalks",
        description: "Road and sidewalk repairs",
        organizationName: "Public Works",
      }],
    );

    expect(result.isSpam).toBe(true);
  });
});
