import type { CivicDatabase } from "./database.js";

export type ImageEmbedding = number[];

const LOCATION_BUFFER_METERS = 100; // 100 meters for GPS error tolerance
const SIMILARITY_THRESHOLD = 0.85; // Threshold for considering images similar

/**
 * Calculates the Euclidean distance between two image embeddings.
 * Lower distance means more similar images.
 */
export function embeddingDistance(embedding1: ImageEmbedding, embedding2: ImageEmbedding): number {
  if (embedding1.length !== embedding2.length) {
    throw new Error("Embeddings must have the same length");
  }

  let sum = 0;
  for (let i = 0; i < embedding1.length; i++) {
    const diff = embedding1[i] - embedding2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Converts Euclidean distance to a similarity score (0-1).
 * Higher score means more similar.
 */
export function distanceToSimilarity(distance: number, embeddingLength: number): number {
  // Normalize by embedding length and convert to similarity
  const maxDistance = Math.sqrt(embeddingLength * 4); // Assuming values are in [-1, 1] range
  return Math.max(0, 1 - distance / maxDistance);
}

/**
 * Calculates the Haversine distance between two coordinates in meters.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Finds similar reports based on image embeddings, location, and category.
 *
 * This is a simplified implementation that uses a brute-force search.
 * For production with many reports, consider using a vector database like
 * Pinecone, Weaviate, or pgvector for efficient similarity search.
 */
export async function findSimilarReports(
  database: CivicDatabase,
  newReportId: string,
  newReportLatitude: number | null,
  newReportLongitude: number | null,
  newReportCategoryId: string,
  newReportEmbedding: ImageEmbedding | null,
): Promise<{ similarReportId: string; similarityScore: number; distanceMeters: number | null } | null> {
  if (!newReportEmbedding || newReportLatitude === null || newReportLongitude === null) {
    return null;
  }

  // Get all recent reports with embeddings (last 90 days)
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const reports = (await database
    .prepare(
      `SELECT id, latitude, longitude, category_id, image_embedding
       FROM reports
       WHERE id != ?
         AND category_id = ?
         AND image_embedding IS NOT NULL
         AND latitude IS NOT NULL
         AND longitude IS NOT NULL
         AND created_at > ?
         AND status NOT IN ('CLOSED')
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all(newReportId, newReportCategoryId, ninetyDaysAgo)) as Array<{
    id: string;
    latitude: number;
    longitude: number;
    category_id: string;
    image_embedding: Buffer;
  }>;

  let bestMatch: {
    similarReportId: string;
    similarityScore: number;
    distanceMeters: number | null;
  } | null = null;

  for (const report of reports) {
    // Check location proximity
    const distanceMeters = haversineDistanceMeters(
      newReportLatitude,
      newReportLongitude,
      report.latitude,
      report.longitude,
    );

    if (distanceMeters > LOCATION_BUFFER_METERS) {
      continue; // Too far away
    }

    // Parse the embedding from the buffer
    const existingEmbedding = parseEmbedding(report.image_embedding);

    // Calculate similarity
    const distance = embeddingDistance(newReportEmbedding, existingEmbedding);
    const similarity = distanceToSimilarity(distance, newReportEmbedding.length);

    if (similarity >= SIMILARITY_THRESHOLD) {
      // This is a match - keep the best one
      if (!bestMatch || similarity > bestMatch.similarityScore) {
        bestMatch = {
          similarReportId: report.id,
          similarityScore: similarity,
          distanceMeters,
        };
      }
    }
  }

  return bestMatch;
}

/**
 * Parses an embedding from a database buffer.
 */
export function parseEmbedding(buffer: Buffer): ImageEmbedding {
  // Assuming float32 encoding
  const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  return Array.from(floatArray);
}

/**
 * Serializes an embedding to a database buffer.
 */
export function serializeEmbedding(embedding: ImageEmbedding): Buffer {
  const floatArray = new Float32Array(embedding);
  return Buffer.from(floatArray.buffer);
}

/**
 * Generates a dummy embedding for testing purposes.
 * In production, this should use a real image embedding model like:
 * - CLIP (OpenAI)
 * - ResNet (TensorFlow/PyTorch)
 * - ImageBind
 * - A dedicated image similarity API
 *
 * This is a placeholder that generates pseudo-random embeddings
 * based on image hash or other simple features.
 */
export async function generateImageEmbedding(imageBuffer: Buffer): Promise<ImageEmbedding> {
  // Placeholder: Generate a simple hash-based embedding
  // In production, replace this with actual model inference

  const hash = simpleHash(imageBuffer);
  const embeddingSize = 512; // Common embedding size
  const embedding: ImageEmbedding = [];

  // Generate deterministic but pseudo-random embedding
  let seed = hash;
  for (let i = 0; i < embeddingSize; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // Normalize to [-1, 1] range
    embedding.push((seed / 0x7fffffff) * 2 - 1);
  }

  return embedding;
}

/**
 * Simple hash function for generating pseudo-random values.
 */
function simpleHash(buffer: Buffer): number {
  let hash = 0;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    hash = ((hash << 5) - hash) + byte;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Checks if a report is a persistent problem based on:
 * - Multiple similar reports over time
 * - Different reporters
 * - Same location and category
 */
export async function detectPersistentProblem(
  database: CivicDatabase,
  reportId: string,
): Promise<{ isPersistent: boolean; relatedReportCount: number; similarReports: string[] }> {
  const report = (await database
    .prepare(
      `SELECT similar_report_id, similarity_score, category_id, latitude, longitude
       FROM reports
       WHERE id = ?`,
    )
    .get(reportId)) as
    | {
        similar_report_id: string | null;
        similarity_score: number | null;
        category_id: string;
        latitude: number | null;
        longitude: number | null;
      }
    | undefined;

  if (!report || !report.similar_report_id) {
    return { isPersistent: false, relatedReportCount: 0, similarReports: [] };
  }

  // Find all reports in the same similarity chain
  const similarReports = (await database
    .prepare(
      `SELECT id
       FROM reports
       WHERE (id = ? OR similar_report_id = ? OR id = ?)
         AND category_id = ?
         AND latitude IS NOT NULL
         AND longitude IS NOT NULL`,
    )
    .all(report.similar_report_id, report.similar_report_id, reportId, report.category_id)) as Array<{ id: string }>;

  const reportIds = similarReports.map((r) => r.id);

  // Check if there are multiple unique reporters
  const reporters = (await database
    .prepare(
      `SELECT DISTINCT reporter_user_id
       FROM reports
       WHERE id IN (${reportIds.map(() => "?").join(",")})`,
    )
    .all(...reportIds)) as Array<{ reporter_user_id: string | null }>;

  const uniqueReporters = new Set(reporters.map((r) => r.reporter_user_id)).size;

  // Consider persistent if:
  // - At least 3 related reports
  // - At least 2 different reporters
  const isPersistent = reportIds.length >= 3 && uniqueReporters >= 2;

  return {
    isPersistent,
    relatedReportCount: reportIds.length,
    similarReports: reportIds,
  };
}
