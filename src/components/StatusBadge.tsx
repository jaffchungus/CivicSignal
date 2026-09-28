import { reportStatusLabel, type ReportStatus } from "../../shared/contracts";

export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase().replace("_", "-")}`}>
      {reportStatusLabel(status)}
    </span>
  );
}
