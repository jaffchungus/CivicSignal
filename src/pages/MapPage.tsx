import { useFetch } from "../lib/hooks";
import { ReportMap } from "../components/ReportMap";
import type { ReportListResponse } from "../../shared/contracts";

export function MapPage() {
  const list = useFetch<ReportListResponse>("/api/reports?scope=all");
  const reports = list.data?.reports ?? [];
  const { loading, error } = list;

  // Filter reports that have coordinates
  const reportsWithCoords = reports.filter(
    (report) => report.coordinates && report.coordinates.latitude && report.coordinates.longitude
  );

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Community Issues Map</h1>
          <p className="muted">
            View all reported issues on an interactive map. Click or hover on markers to see details.
          </p>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="button" type="button" onClick={list.reload}>
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <p className="centered">Loading reports…</p>
      ) : reportsWithCoords.length === 0 ? (
        <div className="card empty">
          <h2>No reports with location data</h2>
          <p className="muted">
            Reports will appear on the map once they include GPS coordinates.
          </p>
        </div>
      ) : (
        <>
          <p className="muted">
            Showing {reportsWithCoords.length} report{reportsWithCoords.length === 1 ? "" : "s"} with location data
          </p>
          <ReportMap reports={reportsWithCoords} />
        </>
      )}
    </section>
  );
}
