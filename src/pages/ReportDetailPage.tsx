import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { Field } from "../components/Field";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAction, useFetch } from "../lib/hooks";
import { reportGuidance } from "../lib/report-guidance";
import {
  reportStatusLabel,
  type Report,
  type ReportStatus,
  type ReportTimelineEntry,
} from "../../shared/contracts";

const ACTION_LABELS: Record<string, string> = {
  REPORT_CREATED: "Report submitted",
  REPORT_CLAIMED: "An official took ownership",
  REPORT_STATUS_CHANGED: "Status changed",
  REPORT_UPDATE_ADDED: "Official update posted",
  REPORT_MODERATED: "Moderation action",
};

function timelineText(entry: ReportTimelineEntry): string {
  if (entry.action === "REPORT_STATUS_CHANGED") {
    return `Status changed from ${reportStatusLabel(entry.fromStatus ?? "")} to ${reportStatusLabel(entry.toStatus ?? "")}`;
  }
  return entry.message ?? ACTION_LABELS[entry.action ?? ""] ?? "Update";
}

export function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const {
    data: report,
    setData: setReport,
    error,
  } = useFetch<Report>(reportId ? `/api/reports/${reportId}` : null);
  const {
    pending: busy,
    error: actionError,
    fieldErrors: actionFieldErrors,
    notice,
    run: runAction,
  } = useAction();
  const [nextStatus, setNextStatus] = useState<ReportStatus | "">("");
  const [updateMessage, setUpdateMessage] = useState("");

  const run = (action: () => Promise<Report>, flash: string) =>
    runAction(async () => {
      setReport(await action());
      setUpdateMessage("");
      setNextStatus("");
    }, flash);

  if (error) {
    return (
      <section className="card narrow">
        <h1>Report unavailable</h1>
        <p className="error">{error}</p>
        <Link className="button" to="/">
          Back to home
        </Link>
      </section>
    );
  }
  if (!report) {
    return <p className="centered">Loading…</p>;
  }

  const capabilities = report.capabilities ?? {};
  const guidance = reportGuidance(report.status);

  return (
    <section className="detail">
      <Link className="back-link" to="/">
        ← Back
      </Link>

      <div className="card">
        <div className="detail-header">
          <div>
            <span className="reference">Reference {report.referenceCode ?? "unavailable"}</span>
            <h1>{report.title}</h1>
            <p className="muted">
              {report.category.name} · {report.organization?.name} ·{" "}
              {report.location}
            </p>
          </div>
          <StatusBadge status={report.status} />
        </div>
        <section className="next-step" aria-labelledby="next-step-heading">
          <div className="next-step-status"><span>Current step</span><strong>{reportStatusLabel(report.status)}</strong></div>
          <div>
            <h2 id="next-step-heading">{guidance.heading}</h2>
            <p>{guidance.explanation}</p>
            <p><strong>Your next step:</strong> {guidance.residentAction}</p>
          </div>
        </section>

        <dl className="meta-grid">
          <div>
            <dt>Submitted by</dt>
            <dd>{report.reporter?.displayName ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatDateTime(report.submittedAt)}</dd>
          </div>
          <div>
            <dt>Handled by</dt>
            <dd>{report.assignedTo?.displayName ?? "Not yet claimed"}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{formatDateTime(report.updatedAt)}</dd>
          </div>
        </dl>

        <h2>What was reported</h2>
        <p className="description">{report.description}</p>

        {report.attachments && report.attachments.length > 0 && (
          <div className="attachments">
            {report.attachments.map((attachment) => (
              <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                <img src={attachment.url} alt={attachment.filename} />
              </a>
            ))}
          </div>
        )}

        {report.moderationStatus && report.moderationStatus !== "VISIBLE" && (
          <p className="warning">
            This report is {report.moderationStatus.toLowerCase()} by moderator decision
            and is no longer part of the official workflow.
          </p>
        )}
      </div>

      {notice && <p className="flash">{notice}</p>}
      {actionError && <p className="error">{actionError}</p>}

      {(capabilities.canClaim ||
        capabilities.canUpdateStatus ||
        capabilities.canAddUpdate ||
        capabilities.canModerate) && (
        <div className="card">
          <h2>Actions</h2>
          <div className="action-grid">
            {capabilities.canClaim && (
              <div className="action">
                <h3>Ownership</h3>
                <p className="muted">Take ownership to show this report is being handled.</p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    void run(
                      () => api.post<Report>(`/api/reports/${report.id}/claim`),
                      "You are now handling this report.",
                    );
                  }}
                >
                  Take ownership
                </button>
              </div>
            )}

            {capabilities.canUpdateStatus &&
              (report.allowedTransitions ?? []).length > 0 && (
                <div className="action">
                  <h3>Status</h3>
                  <p className="muted">
                    Current status: {reportStatusLabel(report.status)}. Move it forward as work
                    progresses.
                  </p>
                  <div className="button-row">
                    <Field label="Next status" className="transition-field">
                      <select
                        className="select"
                        value={nextStatus}
                        onChange={(event) =>
                          setNextStatus(event.target.value as ReportStatus)
                        }
                      >
                        <option value="">Choose the next status…</option>
                        {(report.allowedTransitions ?? []).map((status) => (
                          <option key={status} value={status}>
                            {reportStatusLabel(status)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <button
                      className="button primary"
                      disabled={busy || !nextStatus}
                      onClick={() => {
                        if (!nextStatus) return;
                        void run(
                          () =>
                            api.post<Report>(`/api/reports/${report.id}/status`, {
                              status: nextStatus,
                            }),
                          `Status changed to ${reportStatusLabel(nextStatus)}.`,
                        );
                      }}
                    >
                      Update status
                    </button>
                  </div>
                </div>
              )}

            {capabilities.canAddUpdate && (
              <div className="action">
                <h3>Official update</h3>
                <p className="muted">
                  Post a response the resident will see on their report.
                </p>
                  <form
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void run(
                      () =>
                        api.post<Report>(`/api/reports/${report.id}/updates`, {
                          message: updateMessage,
                        }),
                      "Your update was posted.",
                    );
                  }}
                  className="stack"
                >
                  <Field label="Message" error={actionFieldErrors.message}>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={updateMessage}
                      onChange={(event) => setUpdateMessage(event.target.value)}
                      required
                    />
                  </Field>
                  <button className="button primary" type="submit" disabled={busy}>
                    Post update
                  </button>
                </form>
              </div>
            )}

            {capabilities.canModerate && (
              <div className="action">
                <h3>Moderation</h3>
                <p className="muted">
                  Hide reports from the official workflow or remove them from resident
                  views. Administrators can restore either action later.
                </p>
                <div className="button-row">
                  {report.moderationStatus !== "HIDDEN" && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        void run(
                          () =>
                            api.post<Report>(`/api/reports/${report.id}/moderation`, {
                              moderationStatus: "HIDDEN",
                            }),
                          "Report hidden from the official workflow.",
                        );
                      }}
                    >
                      Hide
                    </button>
                  )}
                  {report.moderationStatus !== "VISIBLE" && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        void run(
                          () =>
                            api.post<Report>(`/api/reports/${report.id}/moderation`, {
                              moderationStatus: "VISIBLE",
                            }),
                          "Report restored to the official workflow.",
                        );
                      }}
                    >
                      Restore
                    </button>
                  )}
                  {report.moderationStatus !== "REMOVED" && (
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm("Remove this report from resident views? An administrator can restore it later.")) {
                          return;
                        }
                        void run(
                          () =>
                            api.post<Report>(`/api/reports/${report.id}/moderation`, {
                              moderationStatus: "REMOVED",
                            }),
                          "Report removed from resident views.",
                        );
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Updates</h2>
        {report.updates && report.updates.length > 0 ? (
          <ul className="update-list">
            {report.updates.map((update) => (
              <li key={update.id}>
                <p>{update.message}</p>
                <p className="muted">
                  {update.author?.displayName ?? "Official"} ·{" "}
                  {formatDateTime(update.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No official updates have been posted yet.</p>
        )}
      </div>

      <div className="card">
        <h2>History</h2>
        <p className="muted">A record of activity entered in CivicSignal. Status changes show who recorded them and when; official updates appear above.</p>
        <ul className="timeline">
          {(report.timeline ?? []).map((entry) => (
            <li key={entry.id}>
              <span className="timeline-dot" />
              <div>
                <strong>{ACTION_LABELS[entry.action ?? ""] ?? "Update"}</strong>
                <p>{timelineText(entry)}</p>
                <p className="muted">
                  {entry.actor?.displayName ?? "System"} ·{" "}
                  {formatDateTime(entry.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
