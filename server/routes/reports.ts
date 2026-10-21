import { randomUUID } from "node:crypto";

import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import {
  isStaffRole,
  MODERATION_STATUSES,
  reportStatusLabel,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  type ModerationStatus,
  type OrganizationKind,
  type ReportStatus,
  type UserRole,
} from "../../shared/contracts.js";
import type { CivicDatabase } from "../database.js";
import {
  createNotification,
  notifyOrganization,
  recordAudit,
  recordReportEvent,
} from "../activity.js";
import { ApiError, isoTime, pathId } from "../http.js";
import type { PhotoStore } from "../photo-store.js";
import { authenticate, currentUser, requireRole, requireStaff } from "../session.js";

const ATTACHMENT_LIMIT_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const EVENT_TYPES: Record<string, string> = {
  REPORT_CREATED: "created",
  REPORT_STATUS_CHANGED: "status",
  REPORT_UPDATE_ADDED: "update",
  REPORT_CLAIMED: "assignment",
  REPORT_MODERATED: "moderation",
};

type ReportRow = {
  id: string;
  reference_code: string;
  title: string;
  description: string;
  location: string;
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
  reporter_user_id: string;
  reporter_display_name: string;
  assigned_user_id: string | null;
  assigned_display_name: string | null;
  assigned_role: UserRole | null;
};

const REPORT_SELECT = `
  SELECT reports.id, reports.reference_code, reports.title, reports.description,
         reports.location, reports.status, reports.moderation_status,
         reports.created_at, reports.updated_at,
         categories.id AS category_id, categories.name AS category_name,
         categories.description AS category_description,
         organizations.id AS organization_id, organizations.name AS organization_name,
         organizations.kind AS organization_kind,
         reporter.id AS reporter_user_id, reporter.display_name AS reporter_display_name,
         assignee.id AS assigned_user_id, assignee.display_name AS assigned_display_name,
         assignee.role AS assigned_role
  FROM reports
  JOIN categories ON categories.id = reports.category_id
  JOIN organizations ON organizations.id = reports.organization_id
  JOIN users AS reporter ON reporter.id = reports.reporter_user_id
  LEFT JOIN users AS assignee ON assignee.id = reports.assigned_user_id`;

const createReportSchema = z.object({
  categoryId: z.string().trim().min(1),
  title: z.string().trim().min(4).max(140),
  description: z.string().trim().min(10).max(4000),
  location: z.string().trim().min(3).max(300),
});

const listQuerySchema = z.object({
  scope: z.enum(["mine", "queue", "all"]).optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  categoryId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(200).optional(),
});

const updateSchema = z.object({
  message: z.string().trim().min(1).max(4000),
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
  return {
    id: row.id,
    referenceCode: row.reference_code,
    title: row.title,
    description: row.description,
    location: row.location,
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
    reporter: { id: row.reporter_user_id, displayName: row.reporter_display_name },
    assignedTo: row.assigned_user_id
      ? {
          id: row.assigned_user_id,
          displayName: row.assigned_display_name,
          role: row.assigned_role,
        }
      : null,
    submittedAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
  };
}

async function serializeDetail(
  database: CivicDatabase,
  photos: PhotoStore,
  row: ReportRow,
  user: { id: string; role: UserRole; organizationId: string | null },
) {
  const attachments = (await database
    .prepare(
      `SELECT id, filename, stored_name, content_type
       FROM attachments WHERE report_id = ? ORDER BY created_at`,
    )
    .all(row.id)) as Array<{
    id: string;
    filename: string;
    stored_name: string;
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

  const availableAttachments = await Promise.all(attachments.map(async (attachment) => {
    try {
      return {
        id: attachment.id,
        filename: attachment.filename,
        url: await photos.url(attachment.stored_name),
        contentType: attachment.content_type,
      };
    } catch {
      // Optional photo delivery must not fail a saved report. Keep the stored
      // attachment for a later read; never fall back to its private storage name.
      return null;
    }
  }));

  const staffScope =
    isStaffRole(user.role) && row.organization_id === user.organizationId;

  return {
    ...serializeSummary(row),
    attachments: availableAttachments.filter((attachment) => attachment !== null),
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
      message: event.message,
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
      canUpdateStatus: staffScope,
      canAddUpdate: staffScope,
      canModerate: user.role === "ADMIN",
    },
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
): Promise<void> {
  if (row.reporter_user_id) {
    await createNotification(database, {
      userId: row.reporter_user_id,
      reportId: row.id,
      type,
      title,
      message,
    });
  }
}

export function createReportsRouter(deps: {
  database: CivicDatabase;
  photos: PhotoStore;
}): Router {
  const { database, photos } = deps;
  const router = Router();

  // Photos are buffered and handed to the photo store only once accepted, so
  // nothing is written for requests rejected by the file filter or size limit.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_LIMIT_BYTES, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
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

  router.post(
    "/",
    authenticate(database),
    upload.single("photo"),
    async (request, response) => {
      const user = currentUser(request);
      const input = createReportSchema.parse(request.body);

      const category = (await database
        .prepare(
          `SELECT id, name, organization_id FROM categories
           WHERE id = ? AND active = 1`,
        )
        .get(input.categoryId)) as
        | { id: string; name: string; organization_id: string }
        | undefined;
      if (!category) {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "The request contains invalid fields.",
          { categoryId: ["Select an active issue category."] },
        );
      }

      const now = Date.now();
      const reportId = randomUUID();

      const file = request.file;
      const storedPhoto = file
        ? await photos.save(file.buffer, file.originalname, file.mimetype)
        : null;

      await database.transaction(async () => {
        const referenceCode = await nextReferenceCode(database);
        await database
          .prepare(
            `INSERT INTO reports
              (id, reference_code, title, description, location, category_id,
               organization_id, reporter_user_id, assigned_user_id, status,
               moderation_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'SUBMITTED', 'VISIBLE', ?, ?)`,
          )
          .run(
            reportId,
            referenceCode,
            input.title,
            input.description,
            input.location,
            category.id,
            category.organization_id,
            user.id,
            now,
            now,
          );

        await recordReportEvent(database, {
          reportId,
          actorUserId: user.id,
          action: "REPORT_CREATED",
          toStatus: "SUBMITTED",
          message: input.title,
        });

        if (file && storedPhoto) {
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
              file.mimetype,
              file.size,
              now,
            );
        }

        await notifyOrganization(database, category.organization_id, {
          reportId,
          type: "REPORT_SUBMITTED",
          title: `New report: ${input.title}`,
          message: `${referenceCode} was submitted to ${category.name} and needs review.`,
        });
      }, async () => {
        if (storedPhoto) {
          try {
            await photos.remove(storedPhoto.storedName);
          } catch {
            // Do not mask the persistence failure or log private storage details.
            console.error("Photo cleanup failed after report persistence rolled back.");
          }
        }
      });

      const row = await loadReport(database, reportId);
      response.status(201).json(await serializeDetail(database, photos, row, user));
    },
  );

  router.get("/:reportId", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const row = await loadReport(database, pathId(request, "reportId"));
    assertCanView(row, user);
    response.json(await serializeDetail(database, photos, row, user));
  });

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
        response.json(await serializeDetail(database, photos, row, user));
        return;
      }
      if (row.assigned_user_id) {
        throw new ApiError(
          409,
          "ALREADY_CLAIMED",
          "Another official is already handling this report.",
        );
      }

      await database
        .prepare("UPDATE reports SET assigned_user_id = ?, updated_at = ? WHERE id = ?")
        .run(user.id, Date.now(), row.id);
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
        await serializeDetail(database, photos, await loadReport(database, row.id), user),
      );
    },
  );

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

      await database
        .prepare("UPDATE reports SET status = ?, updated_at = ? WHERE id = ?")
        .run(input.status, Date.now(), row.id);
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
        await serializeDetail(database, photos, await loadReport(database, row.id), user),
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
        .json(await serializeDetail(database, photos, await loadReport(database, row.id), user));
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
        await serializeDetail(database, photos, await loadReport(database, row.id), user),
      );
    },
  );

  return router;
}
