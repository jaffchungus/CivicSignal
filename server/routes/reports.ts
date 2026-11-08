import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";

import {
  isStaffRole,
  MODERATION_STATUSES,
  reportStatusLabel,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  type ModerationStatus,
  MAX_REPORT_PHOTO_BYTES,
  type OrganizationKind,
  type ReportStatus,
  type UserRole,
} from "../../shared/contracts.js";
import { isCoordinateOnlyLocation, reportLocationLabel } from "../../shared/report-location.js";
import type { CivicDatabase } from "../database.js";
import {
  createNotification,
  notifyOrganization,
  recordAudit,
  recordReportEvent,
} from "../activity.js";
import { ApiError, isoTime, pathId } from "../http.js";
import { routeReportToOrganization } from "../jurisdiction.js";
import { detectProblemInPhoto } from "../ai-photo-analyzer.js";
import {
  findSimilarReports,
  generateImageEmbedding,
  serializeEmbedding,
  detectPersistentProblem,
} from "../image-similarity.js";
import { sendWebPushToUser } from "../web-push.js";
import type { PhotoStore } from "../photo-store.js";
import { authenticate, currentUser, requireRole, requireStaff } from "../session.js";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function actualImageType(buffer: Buffer): string | null {
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.toString("ascii", 12, 16) === "IHDR"
  ) return "image/png";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

const EVENT_TYPES: Record<string, string> = {
  REPORT_CREATED: "created",
  REPORT_STATUS_CHANGED: "status",
  REPORT_UPDATE_ADDED: "update",
  REPORT_CLAIMED: "assignment",
  REPORT_HANDED_OFF: "assignment",
  REPORT_TRANSFERRED: "assignment",
  REPORT_STILL_HAPPENING: "resident_feedback",
  REPORTER_CONFIRMATION: "resident_feedback",
  REPORT_MODERATED: "moderation",
};

function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return Math.round(value * 10) / 10;
}

type ReportRow = {
  id: string;
  reference_code: string;
  title: string;
  description: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  status: ReportStatus;
  moderation_status: ModerationStatus;
  created_at: number;
  updated_at: number;
  category_id: string;
  category_name: string;
  category_description: string;
  organization_id: string;
  organization_name: string;
  organization_kind: OrganizationKind;
  municipality_id: string | null;
  municipality_name: string | null;
  reporter_user_id: string | null;
  reporter_display_name: string | null;
  assigned_user_id: string | null;
  assigned_display_name: string | null;
  assigned_role: UserRole | null;
  reporter_confirmation: string | null;
  reporter_confirmed_at: number | null;
  first_attachment_id: string | null;
  routing_source: "AI" | "RESIDENT" | "AI_FALLBACK" | "LEGACY" | null;
  routing_confidence: number | null;
  routing_review_required: number | boolean | null;
  latest_update_id: string | null;
  latest_update_message: string | null;
  latest_update_created_at: number | null;
  latest_update_author: string | null;
  similar_report_id?: string | null;
  similarity_score?: number | null;
};

const REPORT_SELECT = `
  SELECT reports.id, reports.reference_code, reports.title, reports.description,
         reports.location, reports.latitude, reports.longitude, reports.accuracy_meters,
         reports.status, reports.moderation_status,
         reports.created_at, reports.updated_at,
         categories.id AS category_id, categories.name AS category_name,
         categories.description AS category_description,
         organizations.id AS organization_id, organizations.name AS organization_name,
         organizations.kind AS organization_kind,
         municipalities.id AS municipality_id, municipalities.name AS municipality_name,
         reporter.id AS reporter_user_id, reporter.display_name AS reporter_display_name,
         assignee.id AS assigned_user_id, assignee.display_name AS assigned_display_name,
         assignee.role AS assigned_role,
         reports.reporter_confirmation, reports.reporter_confirmed_at,
         reports.routing_source, reports.routing_confidence, reports.routing_review_required,
         (SELECT attachments.id FROM attachments
          WHERE attachments.report_id = reports.id
          ORDER BY attachments.created_at, attachments.id LIMIT 1) AS first_attachment_id,
         (SELECT report_updates.id FROM report_updates
          WHERE report_updates.report_id = reports.id
          ORDER BY report_updates.created_at DESC, report_updates.id DESC LIMIT 1) AS latest_update_id,
         (SELECT report_updates.message FROM report_updates
          WHERE report_updates.report_id = reports.id
          ORDER BY report_updates.created_at DESC, report_updates.id DESC LIMIT 1) AS latest_update_message,
         (SELECT report_updates.created_at FROM report_updates
          WHERE report_updates.report_id = reports.id
          ORDER BY report_updates.created_at DESC, report_updates.id DESC LIMIT 1) AS latest_update_created_at,
         (SELECT users.display_name FROM report_updates
          LEFT JOIN users ON users.id = report_updates.author_user_id
          WHERE report_updates.report_id = reports.id
          ORDER BY report_updates.created_at DESC, report_updates.id DESC LIMIT 1) AS latest_update_author
  FROM reports
  JOIN categories ON categories.id = reports.category_id
  JOIN organizations ON organizations.id = reports.organization_id
  LEFT JOIN municipalities ON municipalities.id = reports.municipality_id
  LEFT JOIN users AS reporter ON reporter.id = reports.reporter_user_id
  LEFT JOIN users AS assignee ON assignee.id = reports.assigned_user_id`;

const coordinateSchema = z.preprocess(
  (value) => value === "" || value === null ? undefined : typeof value === "string" ? Number(value) : value,
  z.number().finite().optional(),
);

const routingConfidenceSchema = z.preprocess(
  (value) => value === "" || value === null ? undefined : typeof value === "string" ? Number(value) : value,
  z.number().min(0).max(1).optional(),
);

const createReportSchema = z.object({
  categoryId: z.string().trim().min(1),
  municipalityId: z.string().trim().optional(),
  title: z.string().trim().min(4, "Add a short title for the problem.").max(140),
  description: z.string().trim().min(10, "Describe what is happening and where.").max(4000),
  location: z.string().trim().max(300).optional().default(""),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  accuracyMeters: coordinateSchema,
  routingSource: z.enum(["AI", "RESIDENT", "AI_FALLBACK"]).optional().default("RESIDENT"),
  routingConfidence: routingConfidenceSchema,
}).superRefine((input, context) => {
  if ((input.latitude === undefined) !== (input.longitude === undefined)) {
    context.addIssue({ code: "custom", path: ["location"], message: "A complete GPS pin is required." });
  }
  const hasCoordinates = input.latitude !== undefined && input.longitude !== undefined;
  if (input.accuracyMeters !== undefined && (input.accuracyMeters < 0 || input.accuracyMeters > 100_000)) {
    context.addIssue({ code: "custom", path: ["accuracyMeters"], message: "GPS accuracy must be between 0 and 100,000 meters." });
  }
  if (input.accuracyMeters !== undefined && !hasCoordinates) {
    context.addIssue({ code: "custom", path: ["accuracyMeters"], message: "GPS accuracy requires a location pin." });
  }
  if (input.latitude !== undefined && (input.latitude < -90 || input.latitude > 90)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Latitude must be between -90 and 90." });
  }
  if (input.longitude !== undefined && (input.longitude < -180 || input.longitude > 180)) {
    context.addIssue({ code: "custom", path: ["longitude"], message: "Longitude must be between -180 and 180." });
  }
  if (input.location.length < 3 && !hasCoordinates) {
    context.addIssue({ code: "custom", path: ["location"], message: "Enter a street address, intersection, landmark, or save a GPS pin." });
  }
  if (isCoordinateOnlyLocation(input.location) && !hasCoordinates) {
    context.addIssue({ code: "custom", path: ["location"], message: "Enter a street address, intersection, or landmark instead of coordinates." });
  }
});

const listQuerySchema = z.object({
  scope: z.enum(["mine", "queue", "all"]).optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  categoryId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
  assignment: z.enum(["mine", "unassigned"]).optional(),
  followUp: z.enum(["needs"]).optional(),
});

const impactQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

const updateSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

const handoffSchema = z.object({
  toUserId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(500),
});

const transferSchema = z.object({
  categoryId: z.string().trim().min(1),
  reason: z.string().trim().min(5).max(500),
});

const statusSchema = z.object({
  status: z.enum(REPORT_STATUSES),
});

const moderationSchema = z.object({
  moderationStatus: z.enum(MODERATION_STATUSES),
});

async function loadReport(database: CivicDatabase, id: string): Promise<ReportRow> {
  const row = (await database.prepare(`${REPORT_SELECT} WHERE reports.id = ?`).get(id)) as
    | ReportRow
    | undefined;
  if (!row) {
    throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
  }
  return row;
}

function canView(
  row: ReportRow,
  user: { id: string; role: UserRole; organizationId: string | null },
): boolean {
  if (user.role === "ADMIN") return true;
  if (row.reporter_user_id === user.id) return row.moderation_status !== "REMOVED";
  return (
    isStaffRole(user.role) &&
    row.organization_id === user.organizationId &&
    row.moderation_status === "VISIBLE"
  );
}

function assertCanView(
  row: ReportRow,
  user: { id: string; role: UserRole; organizationId: string | null },
): void {
  if (!canView(row, user)) {
    throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
  }
}

/** Official workflow actions are limited to verified staff of the handling organization. */
function assertCanManage(
  row: ReportRow,
  user: { id: string; role: UserRole; organizationId: string | null },
): void {
  if (!isStaffRole(user.role) || row.organization_id !== user.organizationId) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your account does not have permission to perform this action.",
    );
  }
}

function serializeSummary(row: ReportRow) {
  const followUpNeeded =
    (row.status === "RESOLVED" || row.status === "CLOSED") &&
    (row.reporter_confirmation === "STILL_HAPPENING" || row.reporter_confirmation === "DONT_KNOW");
  return {
    id: row.id,
    referenceCode: row.reference_code,
    title: row.title,
    description: row.description,
    location: reportLocationLabel(row.location),
    coordinates: row.latitude !== null && row.longitude !== null
      ? {
          latitude: row.latitude,
          longitude: row.longitude,
          ...(row.accuracy_meters === null ? {} : { accuracyMeters: row.accuracy_meters }),
        }
      : null,
    status: row.status,
    moderationStatus: row.moderation_status,
    category: {
      id: row.category_id,
      name: row.category_name,
      description: row.category_description,
    },
    organization: {
      id: row.organization_id,
      name: row.organization_name,
      kind: row.organization_kind,
    },
    municipality: row.municipality_id
      ? {
          id: row.municipality_id,
          name: row.municipality_name ?? "Unknown Municipality",
        }
      : null,
    reporter: row.reporter_user_id
      ? { id: row.reporter_user_id, displayName: row.reporter_display_name ?? "Resident" }
      : { id: null, displayName: "Guest resident" },
    assignedTo: row.assigned_user_id
      ? {
          id: row.assigned_user_id,
          displayName: row.assigned_display_name,
          role: row.assigned_role,
        }
      : null,
    submittedAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
    reporterConfirmation: row.reporter_confirmation as "STILL_HAPPENING" | "FIXED" | "DONT_KNOW" | null,
    reporterConfirmedAt: row.reporter_confirmed_at ? isoTime(row.reporter_confirmed_at) : null,
    followUpNeeded,
    routing: row.routing_source
      ? {
          source: row.routing_source,
          confidence: row.routing_confidence,
          reviewRequired: Boolean(row.routing_review_required),
        }
      : null,
    latestUpdate: row.latest_update_id
      ? {
          id: row.latest_update_id,
          message: row.latest_update_message ?? "",
          createdAt: isoTime(row.latest_update_created_at ?? row.updated_at),
          author: row.latest_update_author ? { displayName: row.latest_update_author } : null,
        }
      : null,
    attachments: row.first_attachment_id
      ? [{
          id: row.first_attachment_id,
          url: `/api/reports/${row.id}/attachments/${row.first_attachment_id}`,
        }]
      : [],
    similarReportId: row.similar_report_id ?? null,
    similarityScore: row.similarity_score ?? null,
  };
}

async function serializeDetail(
  database: CivicDatabase,
  row: ReportRow,
  user: { id: string; role: UserRole; organizationId: string | null },
) {
  const attachments = (await database
    .prepare(
      `SELECT id, filename, content_type
       FROM attachments WHERE report_id = ? ORDER BY created_at`,
    )
    .all(row.id)) as Array<{
    id: string;
    filename: string;
    content_type: string;
  }>;

  const updates = (await database
    .prepare(
      `SELECT report_updates.id, report_updates.message, report_updates.created_at,
              users.id AS author_id, users.display_name AS author_display_name,
              users.role AS author_role
       FROM report_updates
       LEFT JOIN users ON users.id = report_updates.author_user_id
       WHERE report_updates.report_id = ?
       ORDER BY report_updates.created_at`,
    )
    .all(row.id)) as Array<{
    id: string;
    message: string;
    created_at: number;
    author_id: string | null;
    author_display_name: string | null;
    author_role: UserRole | null;
  }>;

  const events = (await database
    .prepare(
      `SELECT report_events.id, report_events.action, report_events.from_status,
              report_events.to_status, report_events.message, report_events.created_at,
              users.id AS actor_id, users.display_name AS actor_display_name,
              users.role AS actor_role
       FROM report_events
       LEFT JOIN users ON users.id = report_events.actor_user_id
       WHERE report_events.report_id = ?
       ORDER BY report_events.created_at, report_events.id`,
    )
    .all(row.id)) as Array<{
    id: string;
    action: string;
    from_status: string | null;
    to_status: string | null;
    message: string | null;
    created_at: number;
    actor_id: string | null;
    actor_display_name: string | null;
    actor_role: UserRole | null;
  }>;

  const staffScope =
    isStaffRole(user.role) && row.organization_id === user.organizationId;
  const canReadStaffNotes = user.role === "ADMIN" || staffScope;
  const internalAssignmentActions = new Set(["REPORT_HANDED_OFF", "REPORT_TRANSFERRED"]);

  // Check if this is a persistent problem
  let isPersistentProblem = false;
  let relatedReportCount = 0;
  if (row.similar_report_id) {
    const persistenceCheck = await detectPersistentProblem(database, row.id);
    isPersistentProblem = persistenceCheck.isPersistent;
    relatedReportCount = persistenceCheck.relatedReportCount;
  }

  return {
    ...serializeSummary(row),
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      url: `/api/reports/${row.id}/attachments/${attachment.id}`,
      contentType: attachment.content_type,
    })),
    updates: updates.map((update) => ({
      id: update.id,
      message: update.message,
      createdAt: isoTime(update.created_at),
      author: update.author_id
        ? {
            id: update.author_id,
            displayName: update.author_display_name,
            role: update.author_role,
          }
        : null,
    })),
    timeline: events.map((event) => ({
      id: event.id,
      type: EVENT_TYPES[event.action] ?? "event",
      action: event.action,
      message: !canReadStaffNotes && internalAssignmentActions.has(event.action)
        ? "This report was reassigned to the responsible organization."
        : event.message,
      fromStatus: event.from_status as ReportStatus | null,
      toStatus: event.to_status as ReportStatus | null,
      createdAt: isoTime(event.created_at),
      actor: event.actor_id
        ? {
            id: event.actor_id,
            displayName: event.actor_display_name,
            role: event.actor_role,
          }
        : null,
    })),
    allowedTransitions: REPORT_TRANSITIONS[row.status],
    canClaim: staffScope && row.assigned_user_id === null,
    capabilities: {
      canClaim: staffScope && row.assigned_user_id === null,
      canHandoff: staffScope && row.assigned_user_id === user.id,
      canTransfer: staffScope && row.assigned_user_id === user.id,
      canUpdateStatus: staffScope,
      canAddUpdate: staffScope,
      canModerate: user.role === "ADMIN",
    },
    isPersistentProblem,
    relatedReportCount,
  };
}

/** Must run inside the same transaction as the report insert. */
async function nextReferenceCode(database: CivicDatabase): Promise<string> {
  // Seed from existing reports once, preserving numbering on upgraded databases.
  // The unique settings key and atomic UPDATE serialize concurrent allocations
  // on Postgres across instances, and on SQLite within its write transaction.
  await database.prepare(
    `INSERT INTO settings (key, value)
     VALUES ('report_reference_counter', CAST((SELECT COUNT(*) FROM reports) AS TEXT))
     ON CONFLICT (key) DO NOTHING`,
  ).run();
  const { value } = (await database.prepare(
    `UPDATE settings SET value = CAST(CAST(value AS BIGINT) + 1 AS TEXT)
     WHERE key = 'report_reference_counter' RETURNING value`,
  ).get()) as { value: string };
  return `CS-${new Date().getFullYear()}-${value.padStart(4, "0")}`;
}

async function notifyReporterOfReport(
  database: CivicDatabase,
  row: ReportRow,
  type: string,
  title: string,
  message: string,
  deferPush = false,
): Promise<string | null> {
  if (row.reporter_user_id) {
    await createNotification(database, {
      userId: row.reporter_user_id,
      reportId: row.id,
      type,
      title,
      message,
      deferPush,
    });
    return deferPush ? row.reporter_user_id : null;
  }
  return null;
}

export function createReportsRouter(deps: {
  database: CivicDatabase;
  photos: PhotoStore;
}): Router {
  const { database, photos } = deps;
  const router = Router();
  const reportCreationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many reports were submitted from this connection. Wait before sending another report." } },
  });
  const photoAnalysisLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many photos were sent for analysis from this connection. Try again later." } },
  });
  const residentConfirmationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "You have sent several follow-up confirmations. Try again later." } },
  });

  // Photos are buffered and handed to the photo store only once accepted, so
  // nothing is written for requests rejected by the file filter or size limit.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_REPORT_PHOTO_BYTES, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype.toLowerCase())) {
        callback(
          new ApiError(
            415,
            "UNSUPPORTED_FILE_TYPE",
            "Only JPEG, PNG, WebP, or GIF images can be attached to a report.",
          ),
        );
        return;
      }
      callback(null, true);
    },
  });

  async function submitReport(
    request: import("express").Request,
    reporterUserId: string | null,
    guestToken?: string,
  ): Promise<{ report: Awaited<ReturnType<typeof serializeDetail>>; guestAccessToken?: string }> {
    const input = createReportSchema.parse(request.body);

    // Validate municipality if provided
    let municipalityId = input.municipalityId ?? null;
    if (municipalityId) {
      const municipality = (await database
        .prepare("SELECT id, name FROM municipalities WHERE id = ? AND active = 1")
        .get(municipalityId)) as { id: string; name: string } | undefined;
      if (!municipality) {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "The request contains invalid fields.",
          { municipalityId: ["The selected municipality is not valid."] },
        );
      }
    }

    // Route only to the configured organization for the selected category.
    const coordinates = input.latitude !== undefined && input.longitude !== undefined
      ? { latitude: input.latitude, longitude: input.longitude }
      : null;
    const routing = await routeReportToOrganization(
      database,
      input.categoryId,
      municipalityId,
      coordinates,
    );

    // Get the category name for the title
    const categoryRow = (await database
      .prepare("SELECT name FROM categories WHERE id = ?")
      .get(routing.categoryId)) as { name: string } | undefined;

    const category = {
      id: routing.categoryId,
      name: categoryRow?.name || "Issue",
      organization_id: routing.organizationId,
    };

    // Override municipalityId with the routed municipality
    municipalityId = routing.municipalityId;

    const title = input.title;
    const description = input.description;
    const location = input.location || "Precise GPS pin attached";
    const latitude = input.latitude ?? null;
    const longitude = input.longitude ?? null;
    const accuracyMeters = input.accuracyMeters ?? null;
    const now = Date.now();
    const reportId = randomUUID();
    const file = request.file;
    const fileContentType = file ? actualImageType(file.buffer) : null;
    if (file && (!fileContentType || fileContentType !== file.mimetype.toLowerCase())) {
      throw new ApiError(
        415,
        "INVALID_IMAGE_CONTENT",
        "The file contents do not match a supported image type.",
      );
    }
    const storedPhoto = file && fileContentType
      ? await photos.save(file.buffer, file.originalname, fileContentType)
      : null;

    // Photo comparison is optional, and only runs when a photo was supplied.
    const imageEmbedding = file ? await generateImageEmbedding(file.buffer) : null;
    const similarReport = imageEmbedding
      ? await findSimilarReports(
          database,
          reportId,
          latitude,
          longitude,
          category.id,
          imageEmbedding,
        )
      : null;
    const routingReviewRequired =
      input.routingSource === "AI_FALLBACK" ||
      (input.routingSource === "AI" && (input.routingConfidence ?? 0) < 0.6);

    let referenceCode = "";
    let pushRecipients: string[] = [];
    await database.transaction(async () => {
      referenceCode = await nextReferenceCode(database);
      await database
        .prepare(
          `INSERT INTO reports
            (id, reference_code, title, description, location, latitude, longitude, accuracy_meters, category_id,
             organization_id, municipality_id, reporter_user_id, assigned_user_id, status,
             moderation_status, image_embedding, similar_report_id, similarity_score,
             routing_source, routing_confidence, routing_review_required, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'SUBMITTED', 'VISIBLE', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reportId,
          referenceCode,
          title,
          description,
          location,
          latitude,
          longitude,
          accuracyMeters,
          category.id,
          category.organization_id,
          municipalityId,
          reporterUserId,
          imageEmbedding ? serializeEmbedding(imageEmbedding) : null,
          similarReport?.similarReportId ?? null,
          similarReport?.similarityScore ?? null,
          input.routingSource,
          input.routingConfidence ?? null,
          routingReviewRequired ? 1 : 0,
          now,
          now,
        );

      if (guestToken) {
        await database
          .prepare(
            `INSERT INTO guest_report_access (report_id, token_hash, created_at, expires_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(reportId, hashGuestToken(guestToken), now, now + 90 * 24 * 60 * 60 * 1000);
      }

      await recordReportEvent(database, {
        reportId,
        actorUserId: reporterUserId,
        action: "REPORT_CREATED",
        toStatus: "SUBMITTED",
        message: title,
      });

      if (file && storedPhoto && fileContentType) {
        await database
          .prepare(
            `INSERT INTO attachments
              (id, report_id, filename, stored_name, content_type, size_bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            reportId,
            file.originalname,
            storedPhoto.storedName,
            fileContentType,
            file.size,
            now,
          );
      }

      pushRecipients = await notifyOrganization(database, category.organization_id, {
        reportId,
        type: "REPORT_SUBMITTED",
        title: `New report: ${title}`,
        message: `${referenceCode} was submitted to ${category.name} and needs review.`,
      }, true);

      // Check if this is a persistent problem and notify appropriate staff
      if (similarReport) {
        const persistenceCheck = await detectPersistentProblem(database, reportId);
        if (persistenceCheck.isPersistent) {
          // Notify the staff who handled the original similar report
          const originalReport = (await database
            .prepare(
              `SELECT assigned_user_id, reporter_user_id
               FROM reports
               WHERE id = ?`,
            )
            .get(similarReport.similarReportId)) as
            | { assigned_user_id: string | null; reporter_user_id: string | null }
            | undefined;

          if (originalReport?.assigned_user_id) {
            await createNotification(database, {
              userId: originalReport.assigned_user_id,
              reportId,
              type: "PERSISTENT_PROBLEM",
              title: `Persistent problem detected: ${referenceCode}`,
              message: `This report appears to be a repeat of a similar issue you previously handled. ${persistenceCheck.relatedReportCount} related reports have been submitted for this location and category.`,
              deferPush: true,
            });
            pushRecipients.push(originalReport.assigned_user_id);
          }
        }
      }
    }, async () => {
      if (storedPhoto) {
        try {
          await photos.remove(storedPhoto.storedName);
        } catch {
          console.error("Photo cleanup failed after report persistence rolled back.");
        }
      }
    });

    await Promise.all(pushRecipients.map((userId) => sendWebPushToUser(database, userId, {
      title: `New report: ${title}`,
      message: `${referenceCode} was submitted to ${category.name} and needs review.`,
      reportId,
    })));
    const row = await loadReport(database, reportId);
    const viewer = { id: reporterUserId ?? "", role: "RESIDENT" as const, organizationId: null };
    return {
      report: await serializeDetail(database, row, viewer),
      ...(guestToken ? { guestAccessToken: guestToken } : {}),
    };
  }

  async function assertGuestAccess(reportId: string, token: string): Promise<void> {
    const grant = (await database
      .prepare("SELECT token_hash, expires_at FROM guest_report_access WHERE report_id = ?")
      .get(reportId)) as { token_hash: string; expires_at: number } | undefined;
    if (!grant || grant.expires_at < Date.now() || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report link is invalid or has expired.");
    }
    const presented = Buffer.from(hashGuestToken(token), "hex");
    const stored = Buffer.from(grant.token_hash, "hex");
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report link is invalid or has expired.");
    }
  }

  function assertFollowUpWindow(row: ReportRow): void {
    if (row.status !== "RESOLVED" && row.status !== "CLOSED") {
      throw new ApiError(
        409,
        "FOLLOW_UP_NOT_AVAILABLE",
        "Resident follow-up is available after the organization marks the report resolved or closed.",
      );
    }
  }

  async function recordStillHappening(row: ReportRow, actorUserId: string | null) {
    assertFollowUpWindow(row);
    const now = Date.now();
    // Resident feedback is independent of the official status. It never rewinds
    // the organization's recorded status; staff decide whether to reopen work.
    await database
      .prepare("UPDATE reports SET reporter_confirmation = 'STILL_HAPPENING', reporter_confirmed_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, row.id);
    await recordReportEvent(database, {
      reportId: row.id,
      actorUserId,
      action: "REPORT_STILL_HAPPENING",
      message: "A resident reported that this issue is still happening.",
    });
    await recordAudit(database, {
      actorUserId,
      action: "REPORT_STILL_HAPPENING",
      targetType: "REPORT",
      targetId: row.id,
      details: { referenceCode: row.reference_code, status: row.status },
    });

    let notifyUserId = row.assigned_user_id;
    if (!notifyUserId) {
      const resolver = (await database
        .prepare(
          `SELECT actor_user_id
           FROM report_events
           WHERE report_id = ? AND action = 'REPORT_STATUS_CHANGED' AND to_status IN ('RESOLVED', 'CLOSED')
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(row.id)) as { actor_user_id: string | null } | undefined;
      notifyUserId = resolver?.actor_user_id ?? null;
    }

    if (notifyUserId) {
      await createNotification(database, {
        userId: notifyUserId,
        reportId: row.id,
        type: "REPORT_STILL_HAPPENING",
        title: `Problem persists: ${row.reference_code}`,
        message: `A resident reports that "${row.title}" is still happening after the report was marked ${row.status.toLowerCase()}. The official status has not changed; review whether follow-up is needed.`,
        metadata: { previousStatus: row.status },
      });
    }

    await notifyOrganization(database, row.organization_id, {
      reportId: row.id,
      type: "REPORT_STILL_HAPPENING",
      title: `Resident follow-up: ${row.reference_code}`,
      message: `A resident says “${row.title}” is still happening. The official status remains ${row.status.toLowerCase()}; review whether follow-up is needed.`,
    });
    const refreshed = await loadReport(database, row.id);
    return serializeDetail(database, refreshed, {
      id: actorUserId ?? "",
      role: "RESIDENT",
      organizationId: null,
    });
  }

  async function recordConfirmation(row: ReportRow, confirmation: "FIXED" | "DONT_KNOW", actorUserId: string | null) {
    assertFollowUpWindow(row);
    const now = Date.now();
    await database
      .prepare("UPDATE reports SET reporter_confirmation = ?, reporter_confirmed_at = ?, updated_at = ? WHERE id = ?")
      .run(confirmation, now, now, row.id);
    await recordReportEvent(database, {
      reportId: row.id,
      actorUserId,
      action: "REPORTER_CONFIRMATION",
      message: confirmation === "FIXED"
        ? "A resident confirmed this issue has been fixed."
        : "A resident is unsure about the current status of this issue.",
    });
    await recordAudit(database, {
      actorUserId,
      action: "REPORTER_CONFIRMATION",
      targetType: "REPORT",
      targetId: row.id,
      details: { referenceCode: row.reference_code, confirmation },
    });

    // Notify the staff who handled this report
    let notifyUserId = row.assigned_user_id;
    if (!notifyUserId && (row.status === "RESOLVED" || row.status === "CLOSED")) {
      // If no assigned user, try to find who recorded the completion from timeline.
      const resolver = (await database
        .prepare(
          `SELECT actor_user_id
           FROM report_events
           WHERE report_id = ? AND action = 'REPORT_STATUS_CHANGED' AND to_status IN ('RESOLVED', 'CLOSED')
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(row.id)) as { actor_user_id: string | null } | undefined;
      notifyUserId = resolver?.actor_user_id ?? null;
    }

    if (notifyUserId) {
      await createNotification(database, {
        userId: notifyUserId,
        reportId: row.id,
        type: "REPORTER_CONFIRMATION",
        title: `Resident confirmation: ${row.reference_code}`,
        message: confirmation === "FIXED"
          ? `A resident confirmed "${row.title}" has been fixed.`
          : `A resident is unsure about the status of "${row.title}".`,
        metadata: { confirmation },
      });
    }

    await notifyOrganization(database, row.organization_id, {
      reportId: row.id,
      type: "REPORTER_CONFIRMATION",
      title: `Resident confirmation: ${row.reference_code}`,
      message: confirmation === "FIXED"
        ? `A resident confirmed "${row.title}" has been fixed.`
        : `A resident is unsure about the status of "${row.title}".`,
    });
    const refreshed = await loadReport(database, row.id);
    return serializeDetail(database, refreshed, {
      id: actorUserId ?? "",
      role: "RESIDENT",
      organizationId: null,
    });
  }

  router.get("/", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const query = listQuerySchema.parse(request.query);

    let scope = query.scope;
    if (!scope) {
      scope = user.role === "ADMIN" ? "all" : isStaffRole(user.role) ? "queue" : "mine";
    }
    if (scope === "queue" && !isStaffRole(user.role)) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Your account does not have permission to perform this action.",
      );
    }
    if (scope === "all" && user.role !== "ADMIN") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Your account does not have permission to perform this action.",
      );
    }

    const filters: string[] = [];
    const parameters: unknown[] = [];
    if (scope === "mine") {
      filters.push("reports.reporter_user_id = ?");
      parameters.push(user.id);
      filters.push("reports.moderation_status != 'REMOVED'");
    } else if (scope === "queue") {
      filters.push("reports.organization_id = ?");
      parameters.push(user.organizationId);
      filters.push("reports.moderation_status = 'VISIBLE'");
    }
    if (query.status) {
      filters.push("reports.status = ?");
      parameters.push(query.status);
    }
    if (query.categoryId) {
      filters.push("reports.category_id = ?");
      parameters.push(query.categoryId);
    }
    if (query.q) {
      filters.push(
        "(LOWER(reports.title) LIKE ? OR LOWER(reports.description) LIKE ? OR LOWER(reports.reference_code) LIKE ?)",
      );
      const pattern = `%${query.q.toLowerCase()}%`;
      parameters.push(pattern, pattern, pattern);
    }
    if (query.assignment) {
      if (!isStaffRole(user.role)) {
        throw new ApiError(403, "FORBIDDEN", "Your account does not have permission to perform this action.");
      }
      if (query.assignment === "mine") {
        filters.push("reports.assigned_user_id = ?");
        parameters.push(user.id);
      } else {
        filters.push("reports.assigned_user_id IS NULL");
      }
    }
    if (query.followUp === "needs") {
      filters.push("reports.status IN ('RESOLVED', 'CLOSED')");
      filters.push("reports.reporter_confirmation IN ('STILL_HAPPENING', 'DONT_KNOW')");
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const rows = (await database
      .prepare(`${REPORT_SELECT} ${where} ORDER BY reports.created_at DESC`)
      .all(...parameters)) as ReportRow[];
    const { total } = (await database
      .prepare(`SELECT COUNT(*) AS total FROM reports ${where}`)
      .get(...parameters)) as { total: number };

    response.json({
      reports: rows.map((row) => serializeSummary(row)),
      total,
    });
  });

  router.get("/impact", authenticate(database), requireStaff(), async (request, response) => {
    const user = currentUser(request);
    const { days } = impactQuerySchema.parse(request.query);
    const now = Date.now();
    const rangeStart = now - days * 24 * 60 * 60 * 1000;
    const reports = (await database
      .prepare(
        `SELECT id, category_id, location, status, created_at
         FROM reports
         WHERE organization_id = ? AND moderation_status = 'VISIBLE'`,
      )
      .all(user.organizationId)) as Array<{
        id: string;
        category_id: string;
        location: string;
        status: ReportStatus;
        created_at: number;
      }>;
    const recent = reports.filter((report) => report.created_at >= rangeStart);
    const recentIds = new Set(recent.map((report) => report.id));
    const eventRows = (await database
      .prepare(
        `SELECT report_events.report_id, report_events.action, report_events.to_status,
                report_events.created_at
         FROM report_events
         JOIN reports ON reports.id = report_events.report_id
         WHERE reports.organization_id = ? AND reports.moderation_status = 'VISIBLE'
           AND report_events.created_at >= ?`,
      )
      .all(user.organizationId, rangeStart)) as Array<{
        report_id: string;
        action: string;
        to_status: string | null;
        created_at: number;
      }>;
    const firstReviews = new Map<string, number>();
    for (const event of eventRows) {
      if (event.action !== "REPORT_STATUS_CHANGED" || event.to_status !== "UNDER_REVIEW" || !recentIds.has(event.report_id)) continue;
      const existing = firstReviews.get(event.report_id);
      if (existing === undefined || event.created_at < existing) firstReviews.set(event.report_id, event.created_at);
    }
    const reviewHours = recent.flatMap((report) => {
      const firstReview = firstReviews.get(report.id);
      return firstReview === undefined ? [] : [(firstReview - report.created_at) / (60 * 60 * 1000)];
    });
    const openReports = reports.filter((report) => report.status !== "RESOLVED" && report.status !== "CLOSED");
    const repeatGroups = new Map<string, number>();
    for (const report of recent) {
      const normalizedLocation = report.location.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (!normalizedLocation) continue;
      const key = `${report.category_id}\u0000${normalizedLocation}`;
      repeatGroups.set(key, (repeatGroups.get(key) ?? 0) + 1);
    }
    response.json({
      range: { days, from: new Date(rangeStart).toISOString(), through: new Date(now).toISOString() },
      source: "Visible CivicSignal report and report-event records for this organization.",
      reportsReceived: recent.length,
      openReports: openReports.length,
      completedReports: reports.length - openReports.length,
      medianHoursToFirstReview: median(reviewHours),
      medianAgeDaysOfOpenReports: median(openReports.map((report) => (now - report.created_at) / (24 * 60 * 60 * 1000))),
      possibleRepeatCategoryLocationGroups: [...repeatGroups.values()].filter((count) => count > 1).length,
      stillHappeningConfirmations: eventRows.filter((event) => event.action === "REPORT_STILL_HAPPENING").length,
    });
  });

  router.post(
    "/analyze-photo",
    photoAnalysisLimiter,
    upload.single("photo"),
    async (request, response) => {
      const file = request.file;
      if (!file) {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "Upload or take a photo to analyze it.",
          { photo: ["Please upload or take a photo to analyze."] },
        );
      }
      const fileContentType = actualImageType(file.buffer);
      if (!fileContentType || fileContentType !== file.mimetype.toLowerCase()) {
        throw new ApiError(
          415,
          "INVALID_IMAGE_CONTENT",
          "The file contents do not match a supported image type.",
        );
      }
      const categories = (await database
        .prepare(`SELECT categories.id, categories.name, categories.description,
                         organizations.name AS organizationName
                  FROM categories
                  JOIN organizations ON organizations.id = categories.organization_id
                  WHERE categories.active = 1 AND organizations.active = 1
                  ORDER BY categories.name`)
        .all()) as Array<{
          id: string;
          name: string;
          description: string | null;
          organizationName: string;
        }>;
      const analysis = await detectProblemInPhoto(
        file.buffer,
        fileContentType,
        categories,
      );
      response.json({ analysis });
    },
  );

  router.post(
    "/guest",
    reportCreationLimiter,
    upload.single("photo"),
    async (request, response) => {
      const guestAccessToken = randomBytes(32).toString("base64url");
      const result = await submitReport(request, null, guestAccessToken);
      response.status(201).json({ ...result.report, guestAccessToken: result.guestAccessToken });
    },
  );

  router.post(
    "/",
    authenticate(database),
    requireRole("RESIDENT"),
    reportCreationLimiter,
    upload.single("photo"),
    async (request, response) => {
      const user = currentUser(request);
      const result = await submitReport(request, user.id);
      response.status(201).json(result.report);
    },
  );

  router.get("/:reportId/guest", async (request, response) => {
    const reportId = pathId(request, "reportId");
    await assertGuestAccess(reportId, request.get("X-Guest-Access") ?? "");
    const row = await loadReport(database, reportId);
    if (row.reporter_user_id !== null) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
    }
    response.json(await serializeDetail(database, row, {
      id: "",
      role: "RESIDENT",
      organizationId: null,
    }));
  });

  router.post("/:reportId/guest/still-happening", residentConfirmationLimiter, async (request, response) => {
    const reportId = pathId(request, "reportId");
    await assertGuestAccess(reportId, request.get("X-Guest-Access") ?? "");
    const row = await loadReport(database, reportId);
    if (row.reporter_user_id !== null) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
    }
    response.json(await recordStillHappening(row, null));
  });

  router.post("/:reportId/guest/confirm-fixed", residentConfirmationLimiter, async (request, response) => {
    const reportId = pathId(request, "reportId");
    await assertGuestAccess(reportId, request.get("X-Guest-Access") ?? "");
    const row = await loadReport(database, reportId);
    if (row.reporter_user_id !== null) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
    }
    response.json(await recordConfirmation(row, "FIXED", null));
  });

  router.post("/:reportId/guest/confirm-unknown", residentConfirmationLimiter, async (request, response) => {
    const reportId = pathId(request, "reportId");
    await assertGuestAccess(reportId, request.get("X-Guest-Access") ?? "");
    const row = await loadReport(database, reportId);
    if (row.reporter_user_id !== null) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
    }
    response.json(await recordConfirmation(row, "DONT_KNOW", null));
  });

  router.get("/:reportId/guest/attachments/:attachmentId", async (request, response) => {
    const reportId = pathId(request, "reportId");
    const attachmentId = pathId(request, "attachmentId");
    await assertGuestAccess(reportId, request.get("X-Guest-Access") ?? "");
    const attachment = (await database
      .prepare("SELECT stored_name, content_type FROM attachments WHERE id = ? AND report_id = ?")
      .get(attachmentId, reportId)) as { stored_name: string; content_type: string } | undefined;
    if (!attachment) {
      throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "This report attachment does not exist.");
    }
    const photo = await photos.read(attachment.stored_name);
    response
      .status(200)
      .set("Content-Type", attachment.content_type)
      .set("Content-Length", String(photo.byteLength))
      .set("Content-Disposition", "inline")
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .send(photo);
  });

  router.get("/:reportId", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const row = await loadReport(database, pathId(request, "reportId"));
    assertCanView(row, user);
    response.json(await serializeDetail(database, row, user));
  });

  router.post("/:reportId/still-happening", authenticate(database), requireRole("RESIDENT"), residentConfirmationLimiter, async (request, response) => {
    const user = currentUser(request);
    const row = await loadReport(database, pathId(request, "reportId"));
    if (row.reporter_user_id !== user.id) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
    }
    response.json(await recordStillHappening(row, user.id));
  });

  router.post("/:reportId/confirm-fixed", authenticate(database), requireRole("RESIDENT"), residentConfirmationLimiter, async (request, response) => {
    const user = currentUser(request);
    const row = await loadReport(database, pathId(request, "reportId"));
    if (row.reporter_user_id !== user.id) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
    }
    response.json(await recordConfirmation(row, "FIXED", user.id));
  });

  router.post("/:reportId/confirm-unknown", authenticate(database), requireRole("RESIDENT"), residentConfirmationLimiter, async (request, response) => {
    const user = currentUser(request);
    const row = await loadReport(database, pathId(request, "reportId"));
    if (row.reporter_user_id !== user.id) {
      throw new ApiError(404, "REPORT_NOT_FOUND", "This report does not exist.");
    }
    response.json(await recordConfirmation(row, "DONT_KNOW", user.id));
  });

  router.get(
    "/:reportId/attachments/:attachmentId",
    authenticate(database),
    async (request, response) => {
      const user = currentUser(request);
      const reportId = pathId(request, "reportId");
      const attachmentId = pathId(request, "attachmentId");
      const report = await loadReport(database, reportId);
      assertCanView(report, user);
      const attachment = (await database
        .prepare(
          `SELECT stored_name, content_type FROM attachments
           WHERE id = ? AND report_id = ?`,
        )
        .get(attachmentId, reportId)) as
        | { stored_name: string; content_type: string }
        | undefined;
      if (!attachment) {
        throw new ApiError(404, "ATTACHMENT_NOT_FOUND", "This report attachment does not exist.");
      }
      const photo = await photos.read(attachment.stored_name);
      response
        .status(200)
        .set("Content-Type", attachment.content_type)
        .set("Content-Length", String(photo.byteLength))
        .set("Content-Disposition", "inline")
        .set("Cache-Control", "private, no-store")
        .set("X-Content-Type-Options", "nosniff")
        .send(photo);
    },
  );

  router.post(
    "/:reportId/claim",
    authenticate(database),
    requireStaff(),
    async (request, response) => {
      const user = currentUser(request);
      const row = await loadReport(database, pathId(request, "reportId"));
      assertCanView(row, user);
      assertCanManage(row, user);

      if (row.assigned_user_id === user.id) {
        response.json(await serializeDetail(database, row, user));
        return;
      }
      if (row.assigned_user_id) {
        throw new ApiError(
          409,
          "ALREADY_CLAIMED",
          "Another official is already handling this report.",
        );
      }

      const claim = await database
        .prepare(
          `UPDATE reports SET assigned_user_id = ?, updated_at = ?
           WHERE id = ? AND assigned_user_id IS NULL RETURNING id`,
        )
        .get(user.id, Date.now(), row.id) as { id: string } | undefined;
      if (!claim) {
        const current = await loadReport(database, row.id);
        if (current.assigned_user_id === user.id) {
          response.json(await serializeDetail(database, current, user));
          return;
        }
        throw new ApiError(
          409,
          "ALREADY_CLAIMED",
          "Another official is already handling this report.",
        );
      }
      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_CLAIMED",
      });
      await notifyReporterOfReport(
        database,
        row,
        "REPORT_ASSIGNED",
        `An official is handling ${row.reference_code}`,
        `${user.displayName} took ownership of your report “${row.title}”.`,
      );
      await recordAudit(database, {
        actorUserId: user.id,
        action: "REPORT_CLAIMED",
        targetType: "REPORT",
        targetId: row.id,
        details: { referenceCode: row.reference_code },
      });

      response.json(
        await serializeDetail(database, await loadReport(database, row.id), user),
      );
    },
  );

  router.get("/:reportId/handoff-options", authenticate(database), requireStaff(), async (request, response) => {
    const user = currentUser(request);
    const row = await loadReport(database, pathId(request, "reportId"));
    assertCanView(row, user);
    assertCanManage(row, user);
    response.json({
      staff: await database
        .prepare(
          `SELECT id, display_name AS displayName, role
           FROM users
           WHERE organization_id = ? AND status = 'ACTIVE' AND verified_at IS NOT NULL
             AND role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
           ORDER BY display_name`,
        )
        .all(row.organization_id),
    });
  });

  router.post("/:reportId/handoff", authenticate(database), requireStaff(), async (request, response) => {
    const user = currentUser(request);
    const input = handoffSchema.parse(request.body);
    const row = await loadReport(database, pathId(request, "reportId"));
    assertCanView(row, user);
    assertCanManage(row, user);
    if (row.assigned_user_id !== user.id) {
      throw new ApiError(409, "NOT_REPORT_OWNER", "Only the staff member currently handling this report can hand it off.");
    }
    if (input.toUserId === user.id) {
      throw new ApiError(422, "INVALID_HANDOFF", "Choose another verified staff member in your organization.");
    }
    const recipient = (await database
      .prepare(
        `SELECT id, display_name FROM users
         WHERE id = ? AND organization_id = ? AND status = 'ACTIVE'
           AND verified_at IS NOT NULL AND role IN ('OFFICIAL', 'LAW_ENFORCEMENT')`,
      )
      .get(input.toUserId, row.organization_id)) as { id: string; display_name: string } | undefined;
    if (!recipient) {
      throw new ApiError(422, "INVALID_HANDOFF", "Choose an active, verified staff member in your organization.");
    }

    const now = Date.now();
    let pushRecipient: string | null = null;
    await database.transaction(async () => {
      const stillVerified = await database.prepare(
        `SELECT id FROM users
         WHERE id = ? AND organization_id = ? AND status = 'ACTIVE'
           AND verified_at IS NOT NULL AND role IN ('OFFICIAL', 'LAW_ENFORCEMENT')`,
      ).get(recipient.id, row.organization_id) as { id: string } | undefined;
      if (!stillVerified) {
        throw new ApiError(409, "STAFF_UNAVAILABLE", "That staff account is no longer active for this organization.");
      }
      const transferred = await database.prepare(
        `UPDATE reports SET assigned_user_id = ?, updated_at = ?
         WHERE id = ? AND assigned_user_id = ? RETURNING id`,
      ).get(recipient.id, now, row.id, user.id) as { id: string } | undefined;
      if (!transferred) {
        throw new ApiError(409, "REPORT_OWNERSHIP_CHANGED", "Another staff member changed ownership. Reload the report and try again.");
      }
      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_HANDED_OFF",
        message: input.reason,
      });
      const residentMessage = "The staff member handling your report has changed. The receiving organization remains the same.";
      await database.prepare(
        `INSERT INTO report_updates (id, report_id, author_user_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), row.id, user.id, residentMessage, now);
      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_UPDATE_ADDED",
        message: residentMessage,
      });
      pushRecipient = await notifyReporterOfReport(
        database,
        row,
        "REPORT_REASSIGNED",
        `A new staff member is handling ${row.reference_code}`,
        residentMessage,
        true,
      );
      await recordAudit(database, {
        actorUserId: user.id,
        action: "REPORT_HANDED_OFF",
        targetType: "REPORT",
        targetId: row.id,
        details: {
          referenceCode: row.reference_code,
          fromUserId: user.id,
          toUserId: recipient.id,
          reason: input.reason,
        },
      });
    });
    if (pushRecipient) {
      await sendWebPushToUser(database, pushRecipient, {
        title: `A new staff member is handling ${row.reference_code}`,
        message: "The staff member handling your report has changed. The receiving organization remains the same.",
        reportId: row.id,
      });
    }
    response.json(await serializeDetail(database, await loadReport(database, row.id), user));
  });

  router.post("/:reportId/transfer", authenticate(database), requireStaff(), async (request, response) => {
    const user = currentUser(request);
    const input = transferSchema.parse(request.body);
    const row = await loadReport(database, pathId(request, "reportId"));
    assertCanView(row, user);
    assertCanManage(row, user);
    if (row.assigned_user_id !== user.id) {
      throw new ApiError(409, "NOT_REPORT_OWNER", "Only the staff member currently handling this report can transfer it.");
    }

    const target = (await database
      .prepare(
        `SELECT categories.id, categories.name AS category_name,
                organizations.id AS organization_id, organizations.name AS organization_name,
                organizations.municipality_id, municipalities.name AS municipality_name
         FROM categories
         JOIN organizations ON organizations.id = categories.organization_id
         LEFT JOIN municipalities ON municipalities.id = organizations.municipality_id
         WHERE categories.id = ?
           AND categories.active = 1
           AND organizations.active = 1
           AND (organizations.municipality_id IS NULL OR municipalities.active = 1)`,
      )
      .get(input.categoryId)) as
      | {
          id: string;
          category_name: string;
          organization_id: string;
          organization_name: string;
          municipality_id: string | null;
          municipality_name: string | null;
        }
      | undefined;

    if (!target || target.organization_id === row.organization_id) {
      throw new ApiError(
        422,
        "INVALID_TRANSFER",
        "Choose an active category handled by a different organization.",
      );
    }
    const targetStaff = (await database
      .prepare(
        `SELECT id FROM users
         WHERE organization_id = ? AND status = 'ACTIVE'
           AND verified_at IS NOT NULL AND role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
         LIMIT 1`,
      )
      .get(target.organization_id)) as { id: string } | undefined;
    if (!targetStaff) {
      throw new ApiError(
        422,
        "TARGET_UNAVAILABLE",
        "That department has no active verified staff member to receive the report.",
      );
    }

    const now = Date.now();
    let pushRecipient: string | null = null;
    await database.transaction(async () => {
      const updated = await database
        .prepare(
          `UPDATE reports
           SET category_id = ?, organization_id = ?, municipality_id = ?,
               assigned_user_id = NULL, status = 'SUBMITTED', updated_at = ?
           WHERE id = ? AND assigned_user_id = ?
           RETURNING id`,
        )
        .get(
          target.id,
          target.organization_id,
          target.municipality_id,
          now,
          row.id,
          user.id,
        ) as { id: string } | undefined;
      if (!updated) {
        throw new ApiError(
          409,
          "REPORT_OWNERSHIP_CHANGED",
          "Another staff member changed ownership. Reload the report and try again.",
        );
      }

      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_TRANSFERRED",
        fromStatus: row.status,
        toStatus: "SUBMITTED",
        message: `Transferred to ${target.organization_name} (${target.category_name}). Reason: ${input.reason}`,
      });
      const residentMessage =
        `Your report was transferred to ${target.organization_name} so the right team can review it. ` +
        "The report is back in the submitted stage while the receiving department reviews it.";
      await database
        .prepare(
          `INSERT INTO report_updates (id, report_id, author_user_id, message, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), row.id, user.id, residentMessage, now);
      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_UPDATE_ADDED",
        message: residentMessage,
      });

      pushRecipient = await notifyReporterOfReport(
        database,
        row,
        "REPORT_TRANSFERRED",
        `Your report was transferred to ${target.organization_name}`,
        residentMessage,
        true,
      );
      await notifyOrganization(database, target.organization_id, {
        reportId: row.id,
        type: "REPORT_TRANSFERRED",
        title: `Transferred report: ${row.reference_code}`,
        message: `${row.reference_code} was transferred to ${target.organization_name} for review.`,
      }, true);
      await recordAudit(database, {
        actorUserId: user.id,
        action: "REPORT_TRANSFERRED",
        targetType: "REPORT",
        targetId: row.id,
        details: {
          referenceCode: row.reference_code,
          fromOrganizationId: row.organization_id,
          fromCategoryId: row.category_id,
          toOrganizationId: target.organization_id,
          toCategoryId: target.id,
          reason: input.reason,
        },
      });
    });

    if (pushRecipient) {
      await sendWebPushToUser(database, pushRecipient, {
        title: `Your report was transferred to ${target.organization_name}`,
        message: "The receiving department will review it. Track the current status from your account.",
        reportId: row.id,
      });
    }

    response.json(await serializeDetail(database, await loadReport(database, row.id), user));
  });

  router.post(
    "/:reportId/status",
    authenticate(database),
    requireStaff(),
    async (request, response) => {
      const user = currentUser(request);
      const input = statusSchema.parse(request.body);
      const row = await loadReport(database, pathId(request, "reportId"));
      assertCanView(row, user);
      assertCanManage(row, user);

      const allowed = REPORT_TRANSITIONS[row.status];
      if (!allowed.includes(input.status)) {
        throw new ApiError(
          409,
          "INVALID_TRANSITION",
          `A report cannot move from ${row.status} to ${input.status}.`,
        );
      }

      const transition = await database
        .prepare(
          `UPDATE reports SET status = ?, updated_at = ?
           WHERE id = ? AND status = ? RETURNING id`,
        )
        .get(input.status, Date.now(), row.id, row.status) as { id: string } | undefined;
      if (!transition) {
        throw new ApiError(
          409,
          "REPORT_CHANGED",
          "This report changed while you were updating it. Reload the report and try again.",
        );
      }
      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_STATUS_CHANGED",
        fromStatus: row.status,
        toStatus: input.status,
      });
      await notifyReporterOfReport(
        database,
        row,
        "REPORT_STATUS_CHANGED",
        `${row.reference_code} is now ${reportStatusLabel(input.status).toLowerCase()}`,
        `Your report “${row.title}” moved from ${reportStatusLabel(row.status).toLowerCase()} to ${reportStatusLabel(input.status).toLowerCase()}.`,
      );
      await recordAudit(database, {
        actorUserId: user.id,
        action: "REPORT_STATUS_CHANGED",
        targetType: "REPORT",
        targetId: row.id,
        details: {
          referenceCode: row.reference_code,
          fromStatus: row.status,
          toStatus: input.status,
        },
      });

      response.json(
        await serializeDetail(database, await loadReport(database, row.id), user),
      );
    },
  );

  router.post(
    "/:reportId/updates",
    authenticate(database),
    requireStaff(),
    async (request, response) => {
      const user = currentUser(request);
      const input = updateSchema.parse(request.body);
      const row = await loadReport(database, pathId(request, "reportId"));
      assertCanView(row, user);
      assertCanManage(row, user);

      await database
        .prepare(
          `INSERT INTO report_updates (id, report_id, author_user_id, message, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), row.id, user.id, input.message, Date.now());
      await database
        .prepare("UPDATE reports SET updated_at = ? WHERE id = ?")
        .run(Date.now(), row.id);
      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_UPDATE_ADDED",
        message: input.message,
      });
      await notifyReporterOfReport(
        database,
        row,
        "REPORT_UPDATE",
        `Update on ${row.reference_code}`,
        `${user.displayName} posted an update on your report “${row.title}”.`,
      );
      await recordAudit(database, {
        actorUserId: user.id,
        action: "REPORT_UPDATE_ADDED",
        targetType: "REPORT",
        targetId: row.id,
        details: { referenceCode: row.reference_code },
      });

      response
        .status(201)
        .json(await serializeDetail(database, await loadReport(database, row.id), user));
    },
  );

  router.post(
    "/:reportId/moderation",
    authenticate(database),
    requireRole("ADMIN"),
    async (request, response) => {
      const user = currentUser(request);
      const input = moderationSchema.parse(request.body);
      const row = await loadReport(database, pathId(request, "reportId"));

      await database
        .prepare("UPDATE reports SET moderation_status = ?, updated_at = ? WHERE id = ?")
        .run(input.moderationStatus, Date.now(), row.id);
      await recordReportEvent(database, {
        reportId: row.id,
        actorUserId: user.id,
        action: "REPORT_MODERATED",
        message: `Moderation status changed to ${input.moderationStatus}.`,
      });
      await recordAudit(database, {
        actorUserId: user.id,
        action: "REPORT_MODERATED",
        targetType: "REPORT",
        targetId: row.id,
        details: {
          referenceCode: row.reference_code,
          moderationStatus: input.moderationStatus,
        },
      });

      response.json(
        await serializeDetail(database, await loadReport(database, row.id), user),
      );
    },
  );

  return router;
}
