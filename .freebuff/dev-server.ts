import { createApp } from "../server/app.js";
import type { PhotoAnalysisCategory } from "../server/ai-photo-analyzer.js";
import { createSqliteDatabase } from "../server/database-sqlite.js";
import { ApiError } from "../server/http.js";
import { DiskPhotoStore } from "../server/photo-store.js";
import type { PhotoAnalysisResult } from "../shared/contracts.js";

const port = Number(process.env.PORT ?? 3001);
const database = await createSqliteDatabase(process.env.DATABASE_PATH ?? "./data/civicsignal.db");
const captionSpace = "https://hysts-image-captioning-with-blip.hf.space";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const value: unknown = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Text model returned a non-object.");
  }
  return value as Record<string, unknown>;
}

async function captionImage(imageBuffer: Buffer, mimeType: string): Promise<string> {
  const started = await fetch(`${captionSpace}/gradio_api/call/caption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        {
          url: `data:${mimeType};base64,${imageBuffer.toString("base64")}`,
          meta: { _type: "gradio.FileData" },
        },
        "A picture of",
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!started.ok) {
    throw new ApiError(503, "AI_PROVIDER_UNAVAILABLE", `Vision model start failed (${started.status}).`);
  }
  const { event_id: eventId } = (await started.json()) as { event_id?: string };
  if (!eventId) throw new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "Vision model returned no event id.");

  const events = await fetch(`${captionSpace}/gradio_api/call/caption/${eventId}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!events.ok) {
    throw new ApiError(503, "AI_PROVIDER_UNAVAILABLE", `Vision model stream failed (${events.status}).`);
  }
  const text = await events.text();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const data: unknown = JSON.parse(line.slice(5).trim());
      if (Array.isArray(data) && typeof data[0] === "string" && data[0].trim()) {
        return data[0].trim();
      }
    } catch {
      // Keep reading until the completion data frame.
    }
  }
  throw new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "Vision model returned no caption.");
}

async function writeReport(
  caption: string,
  categories: PhotoAnalysisCategory[],
): Promise<PhotoAnalysisResult> {
  const prompt = `A vision model described the submitted civic issue photo as: "${caption}".
Choose exactly one category id from this list:
${JSON.stringify(categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    organization: category.organizationName,
  })))}
Write a short factual report title and one-sentence problem description based only on that visual description.
Return only JSON: {"title":"...","problem":"...","categoryId":"...","confidence":0.0,"isSpam":false}`;

  let lastError = "No text-model response.";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai-fast",
        temperature: 0,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (response.status === 402 || response.status === 503) {
      lastError = `Text model busy (${response.status}).`;
      console.log(`[local-classifier] ${lastError} Waiting before retry ${attempt + 1}.`);
      await wait(response.status === 402 ? 46_000 : 12_000);
      continue;
    }
    if (!response.ok) {
      lastError = `Text model HTTP ${response.status}.`;
      break;
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      lastError = "Text model returned no content.";
      continue;
    }
    try {
      const parsed = parseJson(content);
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const problem = typeof parsed.problem === "string" ? parsed.problem.trim() : "";
      const categoryId = typeof parsed.categoryId === "string" ? parsed.categoryId.trim() : "";
      const category = categories.find((entry) => entry.id === categoryId);
      if (!title || !problem || !category) {
        lastError = `Text model JSON incomplete: title=${Boolean(title)} problem=${Boolean(problem)} category=${Boolean(category)}.`;
        continue;
      }
      return {
        problem,
        suggestedCategoryId: category.id,
        suggestedTitle: title.slice(0, 140),
        suggestedDescription: problem.slice(0, 240),
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
        detectedCues: ["BLIP vision caption", caption],
        isSpam: parsed.isSpam === true,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Could not parse text-model JSON.";
    }
  }

  throw new ApiError(
    503,
    "AI_PROVIDER_UNAVAILABLE",
    `The local verification models could not complete: ${lastError}`,
  );
}

async function analyzeWithLocalStandIn(
  imageBuffer: Buffer,
  mimeType: string,
  categories: PhotoAnalysisCategory[] = [],
): Promise<PhotoAnalysisResult> {
  const caption = await captionImage(imageBuffer, mimeType);
  console.log("[local-classifier] Vision caption:", caption);
  const result = await writeReport(caption, categories);
  const category = categories.find((entry) => entry.id === result.suggestedCategoryId);
  console.log("[local-classifier] Report copy and route:", {
    title: result.suggestedTitle,
    category: category?.name,
    organization: category?.organizationName,
  });
  return result;
}

const { app } = createApp({
  database,
  photos: new DiskPhotoStore(process.env.UPLOAD_DIR ?? "./uploads"),
  reportPhotoAnalyzer: analyzeWithLocalStandIn,
});

const server = app.listen(port, () => {
  console.log(`CivicSignal local verification server listening on http://127.0.0.1:${port}`);
  console.log("Classifier: BLIP vision Space + text.pollinations.ai text model.");
});

function shutdown() {
  server.close(() => {
    void database.close().then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
