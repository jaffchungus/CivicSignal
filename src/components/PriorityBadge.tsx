import {
  REPORT_PRIORITY_LABELS,
  type ReportPriority,
} from "../../shared/contracts";

export function PriorityBadge({ priority }: { priority?: ReportPriority | null }) {
  if (!priority) return null;
  const label = REPORT_PRIORITY_LABELS[priority.level];
  const reports = `${priority.reportCount} active report${priority.reportCount === 1 ? "" : "s"}`;
  const people = `${priority.reporterCount} ${priority.reporterCount === 1 ? "person" : "people"}`;
  const explanation =
    `${reports} from ${people} in this category within ${priority.radiusMeters} m. ` +
    "Priority reflects corroborating nearby reports, not emergency severity.";

  return (
    <span
      className={`priority-badge priority-${priority.level.toLowerCase()}`}
      title={`${label} priority. ${explanation}`}
      aria-label={`${label} priority. ${explanation}`}
    >
      {label} priority
    </span>
  );
}
