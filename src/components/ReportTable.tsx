import { Link } from "react-router-dom";

import { formatDate } from "../lib/format";
import type { Report } from "../../shared/contracts";
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
            </div>
            <div className="report-row-meta">
              <StatusBadge status={report.status} />
              <span className="muted">Updated {formatDate(report.updatedAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
