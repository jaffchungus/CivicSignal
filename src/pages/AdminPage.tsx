import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { Field } from "../components/Field";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import type {
  AdminUser,
  AuditEntry,
  Category,
  Organization,
  Report,
  ReportListResponse,
  UserRole,
} from "../../shared/contracts";

type Tab = "users" | "organizations" | "categories" | "moderation" | "audit";

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`chip chip-${status.toLowerCase()}`}>{status.toLowerCase()}</span>
  );
}

function UsersPanel() {
  const { user: currentAdmin } = useAuth();
  const usersFetch = useFetch<{ users: AdminUser[] }>("/api/admin/users");
  const organizationFetch = useFetch<{ organizations: Organization[] }>(
    "/api/admin/organizations",
  );
  const { pending: busy, error: actionError, notice, run: runAction } = useAction();
  const [verifying, setVerifying] = useState<AdminUser | null>(null);
  const [verifyForm, setVerifyForm] = useState<{ role: UserRole; organizationId: string }>({
    role: "OFFICIAL",
    organizationId: "",
  });

  const users = usersFetch.data?.users ?? [];
  const organizations = organizationFetch.data?.organizations ?? [];
  const error = actionError ?? usersFetch.error ?? organizationFetch.error;
  const load = () => {
    usersFetch.reload();
    organizationFetch.reload();
  };

  const perform = (action: () => Promise<unknown>, flash: string) =>
    runAction(async () => {
      await action();
      setVerifying(null);
      load();
    }, flash);

  const expectedKind =
    verifyForm.role === "LAW_ENFORCEMENT"
      ? "LAW_ENFORCEMENT"
      : verifyForm.role === "OFFICIAL"
        ? "PUBLIC_SERVICE"
        : null;
  const organizationOptions = expectedKind
    ? organizations.filter((organization) => organization.active && organization.kind === expectedKind)
    : [];

  return (
    <div className="stack">
      <p className="muted">
        Official accounts are never trusted automatically. Verify each account here to
        grant it access to the civic workflow.
      </p>
      {notice && <p className="flash">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {verifying && (
        <form
          className="card stack"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void perform(
              () =>
                api.post(`/api/admin/users/${verifying.id}/verify`, {
                  role: verifyForm.role,
                  organizationId: expectedKind
                    ? verifyForm.organizationId || undefined
                    : undefined,
                }),
              `${verifying.displayName} is now a verified ${verifyForm.role.toLowerCase().replace("_", " ")}.`,
            );
          }}
        >
          <h3>Verify {verifying.displayName}</h3>
          <Field label="Role">
            <select
              className="select"
              value={verifyForm.role}
              onChange={(event) =>
                setVerifyForm({
                  role: event.target.value as UserRole,
                  organizationId: "",
                })
              }
            >
              <option value="RESIDENT">Resident</option>
              <option value="OFFICIAL">Public-service official</option>
              <option value="LAW_ENFORCEMENT">Law enforcement</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </Field>
          {expectedKind && (
            <>
              <Field label="Organization">
                <select
                  className="select"
                  value={verifyForm.organizationId}
                  onChange={(event) =>
                    setVerifyForm({ ...verifyForm, organizationId: event.target.value })
                  }
                  required
                >
                  <option value="">Select an organization…</option>
                  {organizationOptions.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </Field>
              {organizationOptions.length === 0 && (
                <p className="warning" role="status">
                  Add an active organization of this type before verifying the account.
                </p>
              )}
            </>
          )}
          {verifyForm.role === "ADMIN" && (
            <p className="warning" role="alert">
              Administrator accounts can verify officials, configure routing, and moderate reports.
            </p>
          )}
          <div className="button-row">
            <button className="button primary" type="submit" disabled={busy}>
              {verifyForm.role === "ADMIN" ? "Grant administrator access" : "Verify account"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => setVerifying(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="table-scroll" role="region" aria-label="User accounts" tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Organization</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.displayName}</td>
              <td>{user.email}</td>
              <td>{user.role.toLowerCase().replace("_", " ")}</td>
              <td>
                <StatusChip status={user.status} />
              </td>
              <td>{user.organizationName ?? "—"}</td>
              <td className="table-actions">
                {user.status === "PENDING" && (
                  <button
                    className="button primary"
                    onClick={() => {
                      setVerifying(user);
                      setVerifyForm({
                        role: user.role === "ADMIN" ? "OFFICIAL" : user.role,
                        organizationId: user.organizationId ?? "",
                      });
                    }}
                  >
                    Verify
                  </button>
                )}
                {user.id !== currentAdmin?.id && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      void perform(
                        () =>
                          api.post(`/api/admin/users/${user.id}/status`, {
                            status: user.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
                          }),
                        user.status === "SUSPENDED"
                          ? `${user.displayName} was reinstated.`
                          : `${user.displayName} was suspended.`,
                      );
                    }}
                  >
                    {user.status === "SUSPENDED" ? "Reinstate" : "Suspend"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function OrganizationsPanel() {
  const { data, error: loadError, reload: load } = useFetch<{
    organizations: Organization[];
  }>("/api/admin/organizations");
  const { pending: busy, error: actionError, run } = useAction();
  const [form, setForm] = useState({ name: "", kind: "PUBLIC_SERVICE" });

  const organizations = data?.organizations ?? [];
  const error = actionError ?? loadError;

  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void run(async () => {
            await api.post("/api/admin/organizations", form);
            setForm({ name: "", kind: "PUBLIC_SERVICE" });
            load();
          });
        }}
      >
        <h3>Add an organization</h3>
        <Field label="Name">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </Field>
        <Field label="Kind">
          <select
            className="select"
            value={form.kind}
            onChange={(event) => setForm({ ...form, kind: event.target.value })}
          >
            <option value="PUBLIC_SERVICE">Public service</option>
            <option value="LAW_ENFORCEMENT">Law enforcement</option>
          </select>
        </Field>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary" type="submit" disabled={busy}>
          Add organization
        </button>
      </form>

      <div className="table-scroll" role="region" aria-label="Organizations" tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Members</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {organizations.map((organization) => (
            <tr key={organization.id}>
              <td>{organization.name}</td>
              <td>{organization.kind?.toLowerCase().replace("_", " ")}</td>
              <td>{organization.memberCount ?? 0}</td>
              <td>
                <StatusChip status={organization.active ? "active" : "inactive"} />
              </td>
              <td className="table-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await api.post(
                        `/api/admin/organizations/${organization.id}/active`,
                        { active: !organization.active },
                      );
                      load();
                    });
                  }}
                >
                  {organization.active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
          {organizations.length === 0 && (
            <tr><td colSpan={5} className="muted">No organizations configured yet.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function CategoriesPanel() {
  const categoryFetch = useFetch<{ categories: Category[] }>("/api/admin/categories");
  const organizationFetch = useFetch<{ organizations: Organization[] }>(
    "/api/admin/organizations",
  );
  const { pending: busy, error: actionError, run } = useAction();
  const [form, setForm] = useState({
    name: "",
    description: "",
    organizationId: "",
  });

  const categories = categoryFetch.data?.categories ?? [];
  const organizations = organizationFetch.data?.organizations ?? [];
  const error = actionError ?? categoryFetch.error ?? organizationFetch.error;
  const load = () => {
    categoryFetch.reload();
    organizationFetch.reload();
  };

  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void run(async () => {
            await api.post("/api/admin/categories", form);
            setForm({ name: "", description: "", organizationId: "" });
            load();
          });
        }}
      >
        <h3>Add a category</h3>
        {organizations.filter((organization) => organization.active).length === 0 && (
          <p className="warning" role="status">
            Add an active organization before configuring issue categories.
          </p>
        )}
        <Field label="Name">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </Field>
        <Field label="Description">
          <input
            className="input"
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </Field>
        <Field label="Handling organization">
          <select
            className="select"
            value={form.organizationId}
            onChange={(event) =>
              setForm({ ...form, organizationId: event.target.value })
            }
            required
          >
            <option value="">Select an organization…</option>
            {organizations.filter((organization) => organization.active).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary" type="submit" disabled={busy || organizations.filter((organization) => organization.active).length === 0}>
          Add category
        </button>
      </form>

      <div className="table-scroll" role="region" aria-label="Issue categories" tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Handling organization</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category.id}>
              <td>
                {category.name}
                {category.description && (
                  <div className="muted">{category.description}</div>
                )}
              </td>
              <td>{category.organizationName ?? "—"}</td>
              <td>
                <StatusChip status={category.active ? "active" : "inactive"} />
              </td>
              <td className="table-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await api.post(`/api/admin/categories/${category.id}/active`, {
                        active: !category.active,
                      });
                      load();
                    });
                  }}
                >
                  {category.active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
          {categories.length === 0 && (
            <tr><td colSpan={4} className="muted">No issue categories configured yet.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function AuditPanel() {
  const { data, error } = useFetch<{ entries: AuditEntry[] }>("/api/admin/audit?limit=100");
  const entries = data?.entries ?? [];

  return (
    <div className="stack">
      <p className="muted">
        Important official and administrative actions, with the responsible account and
        timestamp.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="table-scroll" role="region" aria-label="Audit history" tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{formatDateTime(entry.createdAt)}</td>
              <td>{entry.actor?.displayName ?? "System"}</td>
              <td>{entry.action.replaceAll("_", " ").toLowerCase()}</td>
              <td>
                {entry.targetType?.toLowerCase() ?? "—"} {entry.targetId}
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={4} className="muted">No audit activity recorded yet.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function ModerationPanel() {
  const { data, loading, error, reload } = useFetch<ReportListResponse>("/api/reports?scope=all");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const reports = data?.reports ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleReports = reports.filter((report) => {
    if (!showAll && report.moderationStatus === "VISIBLE") return false;
    if (!normalizedSearch) return true;
    return [report.referenceCode, report.title, report.location, report.category.name]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
  });

  return (
    <div className="stack">
      <p className="muted">
        Review reported content and open a report to hide it, restore it, or remove it from resident views.
      </p>
      <div className="filters">
        <Field label="Show" className="filter-field">
          <select className="select" value={showAll ? "all" : "review"} onChange={(event) => setShowAll(event.target.value === "all")}>
            <option value="review">Needs moderation review</option>
            <option value="all">All reports</option>
          </select>
        </Field>
        <Field label="Search reports" className="filter-field search-field">
          <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, issue, location, or category" />
        </Field>
      </div>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="button" type="button" onClick={reload}>Try again</button>
        </div>
      )}
      {loading ? (
        <p className="centered" role="status">Loading reports…</p>
      ) : visibleReports.length === 0 ? (
        <div className="card empty">
          <h3>{showAll ? "No reports match this search" : "No reports need moderation"}</h3>
          <p className="muted">{showAll ? "Try a different reference, title, location, or category." : "Reports hidden or removed from resident views will appear here."}</p>
        </div>
      ) : (
        <>
          <p className="muted" role="status">{visibleReports.length} report{visibleReports.length === 1 ? "" : "s"}</p>
          <div className="table-scroll" role="region" aria-label="Reports for moderation review" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Issue</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>Updated</th>
                  <th><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleReports.map((report: Report) => (
                  <tr key={report.id}>
                    <td className="reference">{report.referenceCode}</td>
                    <td>
                      <strong>{report.title}</strong>
                      <div className="muted">{report.location}</div>
                    </td>
                    <td>{report.category.name}</td>
                    <td><StatusBadge status={report.status} /></td>
                    <td><StatusChip status={report.moderationStatus ?? "VISIBLE"} /></td>
                    <td>{formatDateTime(report.updatedAt)}</td>
                    <td><Link className="button" to={`/reports/${report.id}`}>Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "users", label: "Users & verification" },
    { id: "organizations", label: "Organizations" },
    { id: "categories", label: "Categories" },
    { id: "moderation", label: "Report review" },
    { id: "audit", label: "Audit log" },
  ];

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Administration</h1>
          <p className="muted">
            Manage who can act as an official, how reports are routed, and what has
            happened on the platform.
          </p>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab${tab === item.id ? " active" : ""}`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersPanel />}
      {tab === "organizations" && <OrganizationsPanel />}
      {tab === "categories" && <CategoriesPanel />}
      {tab === "moderation" && <ModerationPanel />}
      {tab === "audit" && <AuditPanel />}
    </section>
  );
}
