import { useState, useEffect } from "react";
import { useFetch } from "../lib/hooks";
import { ReportMap } from "../components/ReportMap";
import type { ReportListResponse, Category, Municipality } from "../../shared/contracts";

export function MapPage() {
  const list = useFetch<ReportListResponse>("/api/reports?scope=all");
  const reports = list.data?.reports ?? [];
  const { loading, error, reload } = list;

  const { data: categoriesData } = useFetch<{ categories: Category[] }>("/api/categories");
  const categories = categoriesData?.categories ?? [];

  const { data: municipalitiesData } = useFetch<{ municipalities: Municipality[] }>("/api/municipalities");
  const municipalities = municipalitiesData?.municipalities ?? [];

  // Filter state
  const [filters, setFilters] = useState({
    status: [] as string[],
    category: [] as string[],
    municipality: [] as string[],
    timeRange: 30 as number, // days
  });

  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshInterval, setRefreshInterval] = useState(60); // seconds

  // Filter reports that have coordinates
  const reportsWithCoords = reports.filter(
    (report) => report.coordinates && report.coordinates.latitude && report.coordinates.longitude
  );

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      reload();
      setLastRefresh(new Date());
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, reload]);

  // Toggle filter
  const toggleFilter = (type: "status" | "category" | "municipality", value: string) => {
    setFilters((prev) => {
      const current = prev[type];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [type]: updated };
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      status: [],
      category: [],
      municipality: [],
      timeRange: 30,
    });
  };

  // Count reports by status
  const statusCounts = reportsWithCoords.reduce((acc, report) => {
    acc[report.status] = (acc[report.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Count reports by category
  const categoryCounts = reportsWithCoords.reduce((acc, report) => {
    acc[report.category.name] = (acc[report.category.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Count reports by municipality
  const municipalityCounts = reportsWithCoords.reduce((acc, report) => {
    if (report.municipality) {
      acc[report.municipality.name] = (acc[report.municipality.name] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const hasActiveFilters = filters.status.length > 0 ||
    filters.category.length > 0 ||
    filters.municipality.length > 0 ||
    filters.timeRange !== 30;

  return (
    <section className="map-page">
      <div className="page-header">
        <div>
          <h1>Community Issues Map</h1>
          <p className="muted">
            View all reported issues on an interactive map. Use filters to focus on specific areas or types of issues.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="button"
            onClick={reload}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "🔄 Refresh"}
          </button>
          <button
            className={`button ${autoRefresh ? "primary" : ""}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? "⏸️ Auto-refresh on" : "▶️ Auto-refresh off"}
          </button>
          {autoRefresh && (
            <select
              className="select"
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              style={{ width: "auto" }}
            >
              <option value={30}>30s</option>
              <option value={60}>1m</option>
              <option value={120}>2m</option>
              <option value={300}>5m</option>
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="button" type="button" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      <div className="map-layout">
        {/* Filter sidebar */}
        <aside className="map-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-header">
              <h3>Filters</h3>
              {hasActiveFilters && (
                <button
                  className="link-button"
                  onClick={clearFilters}
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Status filter */}
            <div className="filter-group">
              <h4>Status</h4>
              {["SUBMITTED", "UNDER_REVIEW", "IN_PROGRESS", "RESOLVED", "CLOSED"].map((status) => (
                <label key={status} className="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={filters.status.includes(status)}
                    onChange={() => toggleFilter("status", status)}
                  />
                  <span className="status-dot" data-status={status}></span>
                  {status.replace(/_/g, " ").toLowerCase()}
                  <span className="count">({statusCounts[status] || 0})</span>
                </label>
              ))}
            </div>

            {/* Category filter */}
            {categories.length > 0 && (
              <div className="filter-group">
                <h4>Category</h4>
                {categories.map((category) => (
                  <label key={category.id} className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={filters.category.includes(category.id)}
                      onChange={() => toggleFilter("category", category.id)}
                    />
                    {category.name}
                    <span className="count">({categoryCounts[category.name] || 0})</span>
                  </label>
                ))}
              </div>
            )}

            {/* Municipality filter */}
            {municipalities.length > 0 && (
              <div className="filter-group">
                <h4>Municipality</h4>
                {municipalities.map((municipality) => (
                  <label key={municipality.id} className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={filters.municipality.includes(municipality.id)}
                      onChange={() => toggleFilter("municipality", municipality.id)}
                    />
                    {municipality.name}
                    <span className="count">({municipalityCounts[municipality.name] || 0})</span>
                  </label>
                ))}
              </div>
            )}

            {/* Time range filter */}
            <div className="filter-group">
              <h4>Time Range</h4>
              <select
                className="select"
                value={filters.timeRange}
                onChange={(e) => setFilters({ ...filters, timeRange: Number(e.target.value) })}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last year</option>
                <option value={0}>All time</option>
              </select>
            </div>
          </div>

          {/* Stats */}
          <div className="sidebar-section">
            <h3>Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-value">{reportsWithCoords.length}</span>
                <span className="stat-label">Total reports</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{statusCounts.SUBMITTED || 0}</span>
                <span className="stat-label">Submitted</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{statusCounts.IN_PROGRESS || 0}</span>
                <span className="stat-label">In progress</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{statusCounts.RESOLVED || 0}</span>
                <span className="stat-label">Resolved</span>
              </div>
            </div>
          </div>

          {/* Last refresh */}
          <div className="sidebar-section">
            <p className="muted">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
        </aside>

        {/* Map area */}
        <div className="map-area">
          {loading ? (
            <div className="card">
              <p className="centered">Loading reports…</p>
            </div>
          ) : reportsWithCoords.length === 0 ? (
            <div className="card empty">
              <h2>No reports with location data</h2>
              <p className="muted">
                Reports will appear on the map once they include GPS coordinates.
              </p>
            </div>
          ) : (
            <>
              {hasActiveFilters && (
                <div className="filter-summary">
                  <span className="muted">
                    {filters.status.length > 0 && `${filters.status.length} status filter${filters.status.length > 1 ? "s" : ""} · `}
                    {filters.category.length > 0 && `${filters.category.length} category filter${filters.category.length > 1 ? "s" : ""} · `}
                    {filters.municipality.length > 0 && `${filters.municipality.length} municipality filter${filters.municipality.length > 1 ? "s" : ""} · `}
                    {filters.timeRange !== 30 && `Last ${filters.timeRange} days`}
                  </span>
                </div>
              )}
              <ReportMap
                reports={reportsWithCoords}
                filters={filters}
                onReportClick={setSelectedReport}
              />
            </>
          )}
        </div>
      </div>

      <style>{`
        .map-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .map-page .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
        }

        .map-page .header-actions {
          display: flex;
          gap: 10px;
        }

        .map-layout {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 20px;
          align-items: start;
        }

        .map-sidebar {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .sidebar-section {
          background: white;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #ddd;
        }

        .sidebar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .sidebar-header h3 {
          margin: 0;
          font-size: 16px;
        }

        .filter-group {
          margin-bottom: 16px;
        }

        .filter-group:last-child {
          margin-bottom: 0;
        }

        .filter-group h4 {
          margin: 0 0 8px 0;
          font-size: 14px;
          color: #555;
        }

        .filter-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          cursor: pointer;
          font-size: 13px;
        }

        .filter-checkbox input[type="checkbox"] {
          cursor: pointer;
        }

        .filter-checkbox .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .filter-checkbox .status-dot[data-status="SUBMITTED"] {
          background: #ff6b6b;
        }

        .filter-checkbox .status-dot[data-status="UNDER_REVIEW"] {
          background: #ffd93d;
        }

        .filter-checkbox .status-dot[data-status="IN_PROGRESS"] {
          background: #6bcf7f;
        }

        .filter-checkbox .status-dot[data-status="RESOLVED"] {
          background: #4d96ff;
        }

        .filter-checkbox .status-dot[data-status="CLOSED"] {
          background: #8b8b8b;
        }

        .filter-checkbox .count {
          margin-left: auto;
          color: #888;
          font-size: 12px;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .stat-item {
          text-align: center;
          padding: 12px;
          background: #f8f9fa;
          border-radius: 6px;
        }

        .stat-value {
          display: block;
          font-size: 24px;
          font-weight: bold;
          color: #007bff;
        }

        .stat-label {
          display: block;
          font-size: 12px;
          color: #666;
          margin-top: 4px;
        }

        .map-area {
          min-height: 600px;
        }

        .filter-summary {
          background: #e3f2fd;
          padding: 8px 12px;
          border-radius: 6px;
          margin-bottom: 12px;
          font-size: 13px;
        }

        @media (max-width: 1024px) {
          .map-layout {
            grid-template-columns: 1fr;
          }

          .map-sidebar {
            order: 2;
          }

          .map-area {
            order: 1;
          }
        }
      `}</style>
    </section>
  );
}
