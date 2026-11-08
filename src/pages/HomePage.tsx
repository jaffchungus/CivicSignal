import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { ReportTable } from "../components/ReportTable";
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
  const needsFollowUp = reports.filter((report) => report.followUpNeeded);
  const { loading, error } = list;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Your reports</h1>
          <p className="muted">
            Track the issues you have reported and review updates recorded by their receiving organizations.
          </p>
        </div>
        <Link className="button primary" to="/reports/new">
          Report an issue
        </Link>
      </div>

      {needsFollowUp.length > 0 && (
        <section className="card follow-up-panel" aria-labelledby="resident-follow-up-title">
          <div>
            <p className="eyebrow">Needs your attention</p>
            <h2 id="resident-follow-up-title">Is the problem still happening?</h2>
            <p className="muted">
              The organization marked {needsFollowUp.length === 1 ? "a report" : `${needsFollowUp.length} reports`} resolved or closed.
              Your follow-up is recorded separately from the official status; staff decide whether to reopen work.
            </p>
          </div>
          <ReportTable reports={needsFollowUp} />
        </section>
      )}

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="button" type="button" onClick={list.reload}>Try again</button>
        </div>
      )}
      {loading ? (
        <p className="centered" role="status">Loading…</p>
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
      ) : (
        <>
          <div className="section-heading">
            <h2>All your reports</h2>
            <span className="muted">{reports.length} total</span>
          </div>
          <ReportTable reports={reports} />
        </>
      )}
    </section>
  );
}

function StaffHome() {
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [assignment, setAssignment] = useState<"" | "mine" | "unassigned">("");
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const { user } = useAuth();

  const params = new URLSearchParams({ scope: "queue" });
  if (status) params.set("status", status);
  if (categoryId) params.set("categoryId", categoryId);
  if (query) params.set("q", query);
  if (assignment) params.set("assignment", assignment);
  if (followUpOnly) params.set("followUp", "needs");
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
  const resetView = () => {
    setStatus("");
    setCategoryId("");
    setSearch("");
    setQuery("");
    setAssignment("");
    setFollowUpOnly(false);
  };

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

      <div className="queue-tools">
        <div className="queue-view-switch" role="group" aria-label="Queue view">
          <button
            type="button"
            className={`filter-chip${!assignment && !followUpOnly ? " active" : ""}`}
            aria-pressed={!assignment && !followUpOnly}
            onClick={() => { setAssignment(""); setFollowUpOnly(false); }}
          >
            All work
          </button>
          <button
            type="button"
            className={`filter-chip${followUpOnly ? " active" : ""}`}
            aria-pressed={followUpOnly}
            onClick={() => { setFollowUpOnly(true); setAssignment(""); setStatus("RESOLVED"); }}
          >
            Resident follow-up
          </button>
          <button
            type="button"
            className={`filter-chip${assignment === "mine" ? " active" : ""}`}
            aria-pressed={assignment === "mine"}
            onClick={() => { setAssignment("mine"); setFollowUpOnly(false); }}
          >
            Assigned to me
          </button>
          <button
            type="button"
            className={`filter-chip${assignment === "unassigned" ? " active" : ""}`}
            aria-pressed={assignment === "unassigned"}
            onClick={() => { setAssignment("unassigned"); setFollowUpOnly(false); }}
          >
            Unassigned
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
          {(status || categoryId || query || assignment || followUpOnly) && (
            <button className="button" type="button" onClick={resetView}>
              Clear filters
            </button>
          )}
        </form>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="button" type="button" onClick={list.reload}>Try again</button>
        </div>
      )}
      {categoryList.error && <p className="muted">Category filters could not be loaded.</p>}
      {loading ? (
        <p className="centered" role="status">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="card empty">
          <h2>No reports match this view</h2>
          <p className="muted">
            Try clearing the filters. New reports submitted by residents appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="section-heading">
            <h2>{followUpOnly ? "Resident follow-up" : assignment === "mine" ? "Assigned to you" : assignment === "unassigned" ? "Unassigned reports" : "Work queue"}</h2>
            <span className="muted">{total} report{total === 1 ? "" : "s"}</span>
          </div>
          {followUpOnly && (
            <p className="muted queue-guidance">
              These reports are resolved or closed, but the resident said the problem is still happening or is unsure.
              Resident feedback does not change the official status; review the report and decide whether to reopen work.
            </p>
          )}
          <ReportTable reports={reports} />
        </>
      )}

      <details className="card impact-panel">
        <summary>
          <span>Service activity</span>
          <span className="muted">Recorded report measures for the last 30 days</span>
        </summary>
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
      </details>
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
  const setupIncomplete = overview && (
    (overview.organizations ?? 0) === 0 ||
    (overview.categories ?? 0) === 0 ||
    (overview.pendingVerifications ?? 0) > 0
  );

  const cards = [
    { label: "Pending verifications", value: overview?.pendingVerifications },
    { label: "Open reports", value: overview?.openReports },
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

      {setupIncomplete && (
        <section className="card setup-checklist" aria-labelledby="setup-checklist-title">
          <h2 id="setup-checklist-title">Setup and verification</h2>
          <p className="muted">These checks come from live platform records, not sample data.</p>
          <ul>
            <li>{overview.organizations ? `✓ ${overview.organizations} organization${overview.organizations === 1 ? "" : "s"} configured` : "Add at least one active organization."}</li>
            <li>{overview.categories ? `✓ ${overview.categories} categor${overview.categories === 1 ? "y" : "ies"} configured` : "Add at least one active category so residents can submit reports."}</li>
            <li>{overview.pendingVerifications ? `${overview.pendingVerifications} account${overview.pendingVerifications === 1 ? "" : "s"} awaiting verification.` : "No accounts are awaiting verification."}</li>
          </ul>
          <Link className="button" to="/admin">Review setup</Link>
        </section>
      )}

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
      <div className="section-heading">
        <h2>Recent reports</h2>
        <Link to="/admin">Review all</Link>
      </div>
      {loading ? (
        <p className="centered" role="status">Loading…</p>
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
