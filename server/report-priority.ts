import type {
  ReportPriority,
  ReportPriorityLevel,
  ReportStatus,
} from "../shared/contracts.js";
import type { CivicDatabase } from "./database.js";
import { haversineDistanceMeters } from "./image-similarity.js";

export const NEARBY_REPORT_RADIUS_METERS = 100;
export const NEARBY_REPORT_WINDOW_DAYS = 30;

const ACTIVE_REPORT_STATUSES: readonly ReportStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "IN_PROGRESS",
];

const PRIORITY_RANK: Record<ReportPriorityLevel, number> = {
  STANDARD: 0,
  ELEVATED: 1,
  HIGH: 2,
};

export type NearbyReportPriorityInput = {
  id: string;
  category_id: string;
  latitude: number | null;
  longitude: number | null;
  created_at: number;
  reporter_user_id: string | null;
  status: ReportStatus;
};

/** A report count is only a priority signal when different people corroborate it. */
export function priorityLevelForReporterCount(reporterCount: number): ReportPriorityLevel {
  if (reporterCount >= 4) return "HIGH";
  if (reporterCount >= 2) return "ELEVATED";
  return "STANDARD";
}

export function reportPriorityRank(level: ReportPriorityLevel | null | undefined): number {
  return level ? PRIORITY_RANK[level] : 0;
}

function reporterKey(report: NearbyReportPriorityInput): string {
  return report.reporter_user_id
    ? `user:${report.reporter_user_id}`
    : `guest:${report.id}`;
}

/**
 * Counts open, visible reports in the same category near the target. The target
 * is always included; other reports inside the window are counted only when
 * they are recent. Guest submissions count as separate people because the app
 * has no stable identity to deduplicate them.
 */
export function calculateReportPriority(
  target: NearbyReportPriorityInput,
  candidates: readonly NearbyReportPriorityInput[],
  now = Date.now(),
): ReportPriority | null {
  if (
    !ACTIVE_REPORT_STATUSES.includes(target.status) ||
    target.latitude === null ||
    target.longitude === null
  ) {
    return null;
  }

  const cutoff = now - NEARBY_REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const reporters = new Set<string>();
  let reportCount = 0;

  for (const candidate of candidates) {
    if (
      candidate.category_id !== target.category_id ||
      !ACTIVE_REPORT_STATUSES.includes(candidate.status) ||
      candidate.latitude === null ||
      candidate.longitude === null
    ) {
      continue;
    }
    if (candidate.id !== target.id && candidate.created_at < cutoff) {
      continue;
    }
    const distance = haversineDistanceMeters(
      target.latitude,
      target.longitude,
      candidate.latitude,
      candidate.longitude,
    );
    if (distance > NEARBY_REPORT_RADIUS_METERS) {
      continue;
    }
    reportCount += 1;
    reporters.add(reporterKey(candidate));
  }

  // Defensive fallback for callers that did not include the target in the list.
  if (reportCount === 0) {
    reportCount = 1;
    reporters.add(reporterKey(target));
  }

  return {
    level: priorityLevelForReporterCount(reporters.size),
    reportCount,
    reporterCount: reporters.size,
    radiusMeters: NEARBY_REPORT_RADIUS_METERS,
    windowDays: NEARBY_REPORT_WINDOW_DAYS,
  };
}

/** Loads the staff-only priority signal for the requested active reports. */
export async function loadReportPriorities(
  database: CivicDatabase,
  reportIds?: ReadonlySet<string>,
  now = Date.now(),
): Promise<Map<string, ReportPriority>> {
  const rows = (await database
    .prepare(
      `SELECT id, category_id, latitude, longitude, created_at, reporter_user_id, status
       FROM reports
       WHERE moderation_status = 'VISIBLE'
         AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS')
         AND latitude IS NOT NULL
         AND longitude IS NOT NULL`,
    )
    .all()) as NearbyReportPriorityInput[];

  const byCategory = new Map<string, NearbyReportPriorityInput[]>();
  for (const row of rows) {
    const categoryRows = byCategory.get(row.category_id);
    if (categoryRows) categoryRows.push(row);
    else byCategory.set(row.category_id, [row]);
  }

  const priorities = new Map<string, ReportPriority>();
  for (const row of rows) {
    if (reportIds && !reportIds.has(row.id)) continue;
    const priority = calculateReportPriority(
      row,
      byCategory.get(row.category_id) ?? [row],
      now,
    );
    if (priority) priorities.set(row.id, priority);
  }
  return priorities;
}
