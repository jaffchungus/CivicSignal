// Activity recording: the single owner of "who did what, when". Audit events,
// report history, and notifications are written only through this module.
import { randomUUID } from "node:crypto";

import type { CivicDatabase } from "./database";

export function recordAudit(
  database: CivicDatabase,
  input: {
    actorUserId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
  },
): void {
  database
    .prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, target_type, target_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      JSON.stringify(input.details ?? {}),
      Date.now(),
    );
}

/** Appends an entry to the report history timeline. */
export function recordReportEvent(
  database: CivicDatabase,
  input: {
    reportId: string;
    actorUserId: string | null;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    message?: string | null;
  },
): string {
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO report_events
        (id, report_id, actor_user_id, action, from_status, to_status, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.reportId,
      input.actorUserId,
      input.action,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.message ?? null,
      Date.now(),
    );
  return id;
}

export function createNotification(
  database: CivicDatabase,
  input: {
    userId: string;
    reportId: string | null;
    type: string;
    title: string;
    message: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO notifications
        (id, user_id, report_id, type, title, message, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      randomUUID(),
      input.userId,
      input.reportId,
      input.type,
      input.title,
      input.message,
      Date.now(),
    );
}

/** Notifies every active staff member of an organization. */
export function notifyOrganization(
  database: CivicDatabase,
  organizationId: string,
  input: { reportId: string | null; type: string; title: string; message: string },
): void {
  const members = database
    .prepare(
      `SELECT id FROM users
       WHERE organization_id = ? AND status = 'ACTIVE'
         AND role IN ('OFFICIAL', 'LAW_ENFORCEMENT')`,
    )
    .all(organizationId) as Array<{ id: string }>;
  for (const member of members) {
    createNotification(database, { userId: member.id, ...input });
  }
}
