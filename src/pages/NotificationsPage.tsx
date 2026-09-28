import { useNavigate } from "react-router-dom";

import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useNotifications } from "../lib/notifications";
import type { Notification } from "../../shared/contracts";

export function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, error, reload } = useNotifications();

  function openNotification(notification: Notification) {
    if (!notification.read) {
      void api
        .post(`/api/notifications/${notification.id}/read`)
        .then(reload)
        .catch(() => undefined);
    }
    if (notification.reportId) {
      navigate(`/reports/${notification.reportId}`);
    }
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
            onClick={() => {
              void api.post("/api/notifications/read-all").then(reload);
            }}
          >
            Mark all as read
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
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
                onClick={() => openNotification(notification)}
              >
                <div>
                  <strong>{notification.title}</strong>
                  <p className="muted">{notification.message}</p>
                  <p className="muted">{formatDateTime(notification.createdAt)}</p>
                </div>
                {!notification.read && <span className="pill">New</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
