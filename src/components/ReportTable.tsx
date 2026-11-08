import { Link } from "react-router-dom";

import { formatDate } from "../lib/format";
import type { Report } from "../../shared/contracts";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";

export function ReportTable({ reports }: { reports: Report[] }) {
  return (
    <ul className="report-list">
      {reports.map((report) => (
        <li key={report.id}>
          <Link to={`/reports/${report.id}`} className="report-row">
            <div className="report-row-main">
              <span className="reference">{report.referenceCode}</span>
              <strong>{report.title}</strong>
              <span className="muted report-context">
                <span>{report.location}</span>
                <span>{report.category.name} · {report.organization?.name ?? "Organization unavailable"}</span>
              </span>
              <span className="report-row-extra">
                {report.assignedTo
                  ? `Assigned to ${report.assignedTo.displayName}`
                  : "Unassigned — no staff member has taken ownership"}
                {report.latestUpdate ? ` · Latest update: ${report.latestUpdate.message}` : " · No official updates yet"}
              </span>
            </div>
            <div className="report-row-meta">
              <div className="report-row-badges">
                <PriorityBadge priority={report.priority} />
                <StatusBadge status={report.status} />
                {report.followUpNeeded && <span className="attention-chip">Resident follow-up</span>}
              </div>
              <span className="muted">Updated {formatDate(report.updatedAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
