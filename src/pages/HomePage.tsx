import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { ReportTable } from "../components/ReportTable";
import { ReportMap } from "../components/ReportMap";
import { useAuth } from "../lib/auth";
import { useFetch } from "../lib/hooks";
import { formatDate } from "../lib/format";
import { Field } from "../components/Field";
import type {
  AdminOverview,
  Category,
  ReportListResponse,
} from "../../shared/contracts";

function ResidentHome() {
  const list = useFetch<ReportListResponse>("/api/reports?scope=mine");
  const reports = list.data?.reports ?? [];
  const { loading, error } = list;
  const [viewMode, setViewMode] = useState<"table" | "map">("table");

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Your reports</h1>
          <p className="muted">
            Track the issues you have reported and review updates recorded by their receiving organizations.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className={`button ${viewMode === "table" ? "primary" : ""}`}
            onClick={() => setViewMode("table")}
          >
            Table View
          </button>
          <button
            className={`button ${viewMode === "map" ? "primary" : ""}`}
            onClick={() => setViewMode("map")}
          >
            Map View
          </button>
          <Link className="button primary" to="/reports/new">
            Report an issue
          </Link>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="button" type="button" onClick={list.reload}>Try again</button>
        </div>
      )}
      {loading ? (
        <p className="centered">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="card empty">
          <h2>No reports yet</h2>
          <p className="muted">
            Potholes, broken streetlights, sanitation problems, and park maintenance issues are examples
            of non-emergency reports you can submit. Check here later for any recorded updates.
          </p>
          <Link className="button primary" to="/reports/new">
            Report your first issue
          </Link>
        </div>
      ) : viewMode === "map" ? (
        <ReportMap reports={reports.filter(r => r.coordinates)} />
      ) : (
        <ReportTable reports={reports} />
      )}
    </section>
  );
}

function StaffHome() {
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "map">("table");
  const { user } = useAuth();

  const params = new URLSearchParams({ scope: "queue" });
  if (status) params.set("status", status);
  if (categoryId) params.set("categoryId", categoryId);
  if (query) params.set("q", query);
  const list = useFetch<ReportListResponse>(`/api/reports?${params.toString()}`);
  const categoryList = useFetch<{ categories: Category[] }>("/api/categories");
  const impact = useFetch<{
    range: { days: number; from: string; through: string };
    source: string;
    reportsReceived: number;
    openReports: number;
    completedReports: number;
    medianHoursToFirstReview: number | null;
    medianAgeDaysOfOpenReports: number | null;
    possibleRepeatCategoryLocationGroups: number;
    stillHappeningConfirmations: number;
  }>("/api/reports/impact?days=30");

  const categories = categoryList.data?.categories ?? [];
  const reports = list.data?.reports ?? [];
  const total = list.data?.total ?? reports.length;
  const { loading, error } = list;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{user?.organizationName ?? "Department"} queue</h1>
          <p className="muted">
            Review new reports, take ownership, post updates, and resolve the issues your
            organization is responsible for.
          </p>
        </div>
      </div>

      <section className="card impact-panel" aria-labelledby="service-activity-title">
        <h2 id="service-activity-title">Service activity</h2>
        {impact.error ? (
          <div className="error" role="alert">
            <span>{impact.error}</span>
            <button className="button" type="button" onClick={impact.reload}>Try again</button>
          </div>
        ) : impact.loading || !impact.data ? (
          <p className="muted" role="status">Loading report measures…</p>
        ) : (
          <>
            <p className="muted">Reports received {formatDate(impact.data.range.from)}–{formatDate(impact.data.range.through)} ({impact.data.range.days} days). Open and completed are current totals for this organization.</p>
            <div className="stat-grid impact-grid">
              <Metric label="Reports received" value={impact.data.reportsReceived} />
              <Metric label="Open reports" value={impact.data.openReports} />
              <Metric label="Completed reports" value={impact.data.completedReports} />
              <Metric label="Median time to first review" value={impact.data.medianHoursToFirstReview === null ? "—" : `${impact.data.medianHoursToFirstReview} h`} />
              <Metric label="Median age of open reports" value={impact.data.medianAgeDaysOfOpenReports === null ? "—" : `${impact.data.medianAgeDaysOfOpenReports} days`} />
              <Metric label="Still happening confirmations" value={impact.data.stillHappeningConfirmations} />
              <Metric label="Possible repeat category/location groups" value={impact.data.possibleRepeatCategoryLocationGroups} />
            </div>
            <p className="impact-source">Source: {impact.data.source} “Possible repeat” means the same selected category and normalized location text; it is not a verified duplicate. Submitted reports and status measures are not independently verified damage or completed work.</p>
          </>
        )}
      </section>

      <div style={{ marginBottom: "16px", display: "flex", gap: "8px" }}>
        <button
          className={`button ${viewMode === "table" ? "primary" : ""}`}
          onClick={() => setViewMode("table")}
        >
          Table View
        </button>
        <button
          className={`button ${viewMode === "map" ? "primary" : ""}`}
          onClick={() => setViewMode("map")}
        >
          Map View
        </button>
      </div>

      <form
        className="filters"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <Field label="Status" className="filter-field">
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="UNDER_REVIEW">Under review</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
        </Field>
        <Field label="Category" className="filter-field">
          <select
            className="select"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search reports" className="filter-field search-field">
          <input
            className="input"
            placeholder="Title, description, or reference"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <button className="button" type="submit">
          Search
        </button>
      </form>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="button" type="button" onClick={list.reload}>Try again</button>
        </div>
      )}
      {categoryList.error && <p className="muted">Category filters could not be loaded.</p>}
      {loading ? (
        <p className="centered">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="card empty">
          <h2>The queue is empty</h2>
          <p className="muted">
            No reports match these filters right now. New reports submitted by residents
            appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <p className="muted">
            {total} report{total === 1 ? "" : "s"}
          </p>
          {viewMode === "map" ? (
            <ReportMap reports={reports.filter(r => r.coordinates)} />
          ) : (
            <ReportTable reports={reports} />
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="stat-card"><span className="stat-value">{value}</span><span className="stat-label">{label}</span></div>;
}

function AdminHome() {
  const overviewFetch = useFetch<AdminOverview>("/api/admin/overview");
  const list = useFetch<ReportListResponse>("/api/reports?scope=all");
  const overview = overviewFetch.data;
  const reports = list.data?.reports ?? [];
  const { loading } = list;

  const cards = [
    { label: "Open reports", value: overview?.openReports },
    { label: "Pending verifications", value: overview?.pendingVerifications },
    { label: "Moderation queue", value: overview?.moderationQueue },
    { label: "Users", value: overview?.users },
    { label: "Organizations", value: overview?.organizations },
    { label: "Categories", value: overview?.categories },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Platform overview</h1>
          <p className="muted">
            Manage users, official verification, organizations, categories, and
            moderation.
          </p>
        </div>
        <Link className="button primary" to="/admin">
          Open administration
        </Link>
      </div>
      <div className="stat-grid">
        {cards.map((card) => (
          <div key={card.label} className="stat-card">
            <span className="stat-value">{card.value ?? "—"}</span>
            <span className="stat-label">{card.label}</span>
          </div>
        ))}
      </div>
      {(overviewFetch.error || list.error) && (
        <div className="error" role="alert">
          <span>{overviewFetch.error ?? list.error}</span>
          <button className="button" type="button" onClick={() => { overviewFetch.reload(); list.reload(); }}>
            Try again
          </button>
        </div>
      )}
      <h2>All reports</h2>
      {loading ? (
        <p className="centered">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="card empty">
          <h3>No reports have been submitted</h3>
          <p className="muted">Reports appear here after residents submit them through a configured category.</p>
          <Link className="button" to="/admin">Review local setup</Link>
        </div>
      ) : (
        <>
          <ReportTable reports={reports.slice(0, 8)} />
          {reports.length > 8 && (
            <p className="muted">Showing the 8 most recent reports. Use Administration to review all reports.</p>
          )}
        </>
      )}
    </section>
  );
}

export function HomePage() {
  const { user } = useAuth();
  if (!user) {
    return null;
  }
  if (user.role === "ADMIN") {
    return <AdminHome />;
  }
  if (user.role === "OFFICIAL" || user.role === "LAW_ENFORCEMENT") {
    return <StaffHome />;
  }
  return <ResidentHome />;
}
