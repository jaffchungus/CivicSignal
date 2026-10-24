import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { Field } from "../components/Field";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAction, useFetch } from "../lib/hooks";
import { reportGuidance } from "../lib/report-guidance";
import { useAuth } from "../lib/auth";
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
  REPORT_STILL_HAPPENING: "Resident follow-up received",
  REPORT_MODERATED: "Moderation action",
};

function timelineText(entry: ReportTimelineEntry): string {
  if (entry.action === "REPORT_STATUS_CHANGED") {
    return `Status changed from ${reportStatusLabel(entry.fromStatus ?? "")} to ${reportStatusLabel(entry.toStatus ?? "")}`;
  }
  return entry.message ?? ACTION_LABELS[entry.action ?? ""] ?? "Update";
}

export function ReportDetailPage({ publicTracking = false }: { publicTracking?: boolean }) {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [guestToken, setGuestToken] = useState<string | null>(() => {
    if (!publicTracking || !reportId) return null;
    return sessionStorage.getItem(`civicsignal.guest-report.${reportId}`);
  });
  const [guestReport, setGuestReport] = useState<Report | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestPhotoUrls, setGuestPhotoUrls] = useState<Record<string, string>>({});
  const guestPhotoUrlsRef = useRef<string[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const {
    data: accountReport,
    setData: setAccountReport,
    error,
  } = useFetch<Report>(!publicTracking && reportId ? `/api/reports/${reportId}` : null);
  const handoffOptions = useFetch<{ staff: Array<{ id: string; displayName: string; role: string }> }>(
    accountReport?.capabilities?.canHandoff ? `/api/reports/${accountReport.id}/handoff-options` : null,
  );
  const {
    pending: busy,
    error: actionError,
    fieldErrors: actionFieldErrors,
    notice,
    run: runAction,
  } = useAction();
  const [nextStatus, setNextStatus] = useState<ReportStatus | "">("");
  const [updateMessage, setUpdateMessage] = useState("");
  const [handoffTo, setHandoffTo] = useState("");
  const [handoffReason, setHandoffReason] = useState("");

  useEffect(() => {
    if (!publicTracking || !reportId || !location.hash) return;
    const suppliedToken = location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(suppliedToken)) return;
    sessionStorage.setItem(`civicsignal.guest-report.${reportId}`, suppliedToken);
    setGuestToken(suppliedToken);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: location.state });
  }, [location.hash, location.pathname, location.search, location.state, navigate, publicTracking, reportId]);

  useEffect(() => {
    if (!publicTracking || !reportId || !guestToken) return;
    let current = true;
    api.getWithGuestAccess<Report>(`/api/reports/${reportId}/guest`, guestToken)
      .then((result) => { if (current) { setGuestReport(result); setGuestError(null); } })
      .catch((caught: unknown) => { if (current) setGuestError(caught instanceof Error ? caught.message : "This report link is unavailable."); });
    return () => { current = false; };
  }, [guestToken, publicTracking, reportId]);

  useEffect(() => {
    if (!publicTracking || !reportId || !guestToken || !guestReport?.attachments?.length) return;
    let current = true;
    const photoRequests = guestReport.attachments.map(async (attachment) => {
      const blob = await api.getGuestPhoto(
        `/api/reports/${reportId}/guest/attachments/${attachment.id}`,
        guestToken,
      );
      return [attachment.id, URL.createObjectURL(blob)] as const;
    });
    void Promise.all(photoRequests).then((entries) => {
      if (current) {
        guestPhotoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        guestPhotoUrlsRef.current = entries.map(([, url]) => url);
        setGuestPhotoUrls(Object.fromEntries(entries));
      }
      else entries.forEach(([, url]) => URL.revokeObjectURL(url));
    }).catch(() => undefined);
    return () => {
      current = false;
      guestPhotoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      guestPhotoUrlsRef.current = [];
    };
  }, [guestReport, guestToken, publicTracking, reportId]);

  const activeReport = publicTracking ? guestReport : accountReport;
  const activeError = publicTracking
    ? guestError ?? (!guestToken ? "This secure tracking link is missing its access code. Open the original link you saved." : null)
    : error;
  const updateReport = publicTracking ? setGuestReport : setAccountReport;

  const run = (action: () => Promise<Report>, flash: string) =>
    runAction(async () => {
      updateReport(await action());
      setUpdateMessage("");
      setNextStatus("");
    }, flash);

  if (activeError) {
    return (
      <section className="card narrow">
        <h1>Report unavailable</h1>
        <p className="error">{activeError}</p>
        <Link className="button" to="/">
          Back to home
        </Link>
      </section>
    );
  }
  if (!activeReport) {
    return <p className="centered">Loading…</p>;
  }

  const report = activeReport as Report;
  const mapUrl = report.coordinates
    ? `https://www.openstreetmap.org/?mlat=${report.coordinates.latitude}&mlon=${report.coordinates.longitude}#map=18/${report.coordinates.latitude}/${report.coordinates.longitude}`
    : null;

  const capabilities = report.capabilities ?? {};
  const guidance = reportGuidance(report.status);

  return (
    <section className="detail">
      <Link className="back-link" to="/">
        ← Back
      </Link>

      {publicTracking && guestToken && reportId && (
        <aside className="secure-link-card" aria-label="Secure report tracking link">
          <div>
            <strong>Save this secure tracking link</strong>
            <p className="muted">Anyone with this link can view this report. Keep it private. The access link expires after 90 days.</p>
          </div>
          <label className="field">
            <span className="field-label">Tracking link</span>
            <input className="input" readOnly value={`${window.location.origin}/track/${reportId}#${guestToken}`} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <button
            type="button"
            className="button"
            onClick={() => {
              if (!navigator.clipboard?.writeText) {
                setLinkCopied(false);
                return;
              }
              void navigator.clipboard.writeText(`${window.location.origin}/track/${reportId}#${guestToken}`)
                .then(() => setLinkCopied(true))
                .catch(() => setLinkCopied(false));
            }}
          >{linkCopied ? "Copied" : "Copy secure link"}</button>
        </aside>
      )}

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

        <section className="incident-location" aria-label="Incident location">
          <span className="field-label">Incident location</span>
          <p>{report.location}</p>
          {report.coordinates && mapUrl && (
            <p className="gps-pin-detail">
              <strong>Precise GPS pin:</strong> {report.coordinates.latitude.toFixed(6)}, {report.coordinates.longitude.toFixed(6)}
              {" · "}<a href={mapUrl} target="_blank" rel="noreferrer">Open map</a>
            </p>
          )}
        </section>

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
            <dt>Municipal Representative</dt>
            <dd>
              {report.assignedTo?.displayName ?? report.nearestRepresentative?.displayName ?? "Municipal Staff"}
              {report.nearestRepresentative?.municipalityName ? ` (${report.nearestRepresentative.municipalityName})` : ""}
            </dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{formatDateTime(report.updatedAt)}</dd>
          </div>
        </dl>

        <h2>What was reported</h2>
        <p className="description">{report.description || "No additional details were provided."}</p>

        {report.attachments && report.attachments.length > 0 && (
          <div className="attachments">
            {report.attachments.map((attachment) => {
              const imageUrl = publicTracking ? guestPhotoUrls[attachment.id] : attachment.url;
              return imageUrl
                ? <a key={attachment.id} href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt={attachment.filename ?? "Report attachment"} /></a>
                : <span key={attachment.id} className="muted" role="status">Loading private photo…</span>;
            })}
          </div>
        )}

        {(publicTracking || report.reporter?.id === user?.id) &&
          ["IN_PROGRESS", "RESOLVED", "CLOSED"].includes(report.status) &&
          !report.timeline?.some((event) => event.action === "REPORT_STILL_HAPPENING") && (
          <div className="resident-follow-up">
            <h2>Is this still happening?</h2>
            <p className="muted">Your confirmation is recorded for staff to review. It does not reveal your location to other residents.</p>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                const action = publicTracking && guestToken
                  ? () => api.postWithGuestAccess<Report>(`/api/reports/${report.id}/guest/still-happening`, guestToken)
                  : () => api.post<Report>(`/api/reports/${report.id}/still-happening`);
                void run(action, "Your follow-up was recorded for the responsible organization.");
              }}
            >Still happening</button>
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

            {capabilities.canHandoff && (
              <div className="action">
                <h3>Hand off ownership</h3>
                <p className="muted">Choose an active, verified colleague in your organization. The reason appears in the report history, and the resident sees that ownership changed.</p>
                {handoffOptions.error && <p className="error" role="alert">{handoffOptions.error}</p>}
                <form
                  className="stack"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void run(
                      () => api.post<Report>(`/api/reports/${report.id}/handoff`, { toUserId: handoffTo, reason: handoffReason }),
                      "Ownership was transferred and recorded.",
                    );
                  }}
                >
                  <Field label="Transfer to" error={actionFieldErrors.toUserId}>
                    <select className="select" value={handoffTo} onChange={(event) => setHandoffTo(event.target.value)} required disabled={handoffOptions.loading}>
                      <option value="">{handoffOptions.loading ? "Loading verified staff…" : "Choose a staff member…"}</option>
                      {(handoffOptions.data?.staff ?? []).filter((member) => member.id !== user?.id).map((member) => (
                        <option key={member.id} value={member.id}>{member.displayName} · {member.role.toLowerCase().replace("_", " ")}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Reason (shown in report history)" error={actionFieldErrors.reason}>
                    <textarea className="textarea" rows={2} maxLength={500} value={handoffReason} onChange={(event) => setHandoffReason(event.target.value)} required />
                  </Field>
                  {(handoffOptions.data?.staff ?? []).filter((member) => member.id !== user?.id).length === 0 && !handoffOptions.loading && (
                    <p className="warning" role="status">No other active, verified colleague is configured for this organization. An administrator must verify another staff account before you can hand off ownership.</p>
                  )}
                  <button className="button" type="submit" disabled={busy || !handoffTo || !handoffReason.trim() || !(handoffOptions.data?.staff ?? []).some((member) => member.id !== user?.id)}>
                    Transfer ownership
                  </button>
                </form>
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
                  {entry.actor?.displayName ?? (entry.action === "REPORT_STILL_HAPPENING" ? "Resident" : "System")} ·{" "}
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
