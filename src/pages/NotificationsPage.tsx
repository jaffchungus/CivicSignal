import { useNavigate } from "react-router-dom";

import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useNotifications } from "../lib/notifications";
import { useAction } from "../lib/hooks";
import type { Notification } from "../../shared/contracts";

export function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, error, reload } = useNotifications();
  const action = useAction();

  function openNotification(notification: Notification) {
    if (notification.read) {
      if (notification.reportId) navigate(`/reports/${notification.reportId}`);
      return;
    }
    void action.run(async () => {
      await api.post(`/api/notifications/${notification.id}/read`);
      reload();
      if (notification.reportId) navigate(`/reports/${notification.reportId}`);
    }, "Notification marked as read.");
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p className="muted">
            Confirmations and updates about your CivicSignal activity.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            className="button"
            disabled={action.pending}
            onClick={() => {
              void action.run(async () => {
                await api.post("/api/notifications/read-all");
                reload();
              }, "All notifications marked as read.");
            }}
          >
            {action.pending ? "Saving…" : "Mark all as read"}
          </button>
        )}
      </div>

      {action.notice && <p className="flash" role="status">{action.notice}</p>}
      {(action.error ?? error) && <p className="error" role="alert">{action.error ?? error}</p>}
      {loading ? (
        <p className="centered">Loading…</p>
      ) : notifications.length === 0 ? (
        <div className="card empty">
          <h2>Nothing here yet</h2>
          <p className="muted">
            You will see notifications when reports are submitted to your organization,
            when your reports change status, and when officials post updates.
          </p>
        </div>
      ) : (
        <ul className="notification-list">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className={`notification-row${notification.read ? "" : " unread"}`}
                disabled={action.pending}
                onClick={() => openNotification(notification)}
              >
                <span className="notification-copy">
                  <span className="notification-title">{notification.title}</span>
                  <span className="muted">{notification.message}</span>
                  <span className="muted">{formatDateTime(notification.createdAt)}</span>
                </span>
                {!notification.read && <span className="pill">New</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
