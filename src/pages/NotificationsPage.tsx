import { useNavigate } from "react-router-dom";
import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useNotifications } from "../lib/notifications";
import { useAction } from "../lib/hooks";
import type { Notification } from "../../shared/contracts";

type PushConfig = { publicKey: string | null; deviceCount: number };

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function PushPreferences() {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "enabled" | "unsupported" | "install-required" | "denied" | "unavailable">("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      if (ios && !standalone) {
        if (active) setState("install-required");
        return;
      }
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setState("unsupported");
        return;
      }
      try {
        const result = await api.get<PushConfig>("/api/notifications/push/config");
        if (!active) return;
        setConfig(result);
        if (!result.publicKey) {
          setState("unavailable");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await api.put("/api/notifications/push/subscription", subscription.toJSON());
          if (active) setState("enabled");
        } else if (Notification.permission === "denied") {
          if (active) setState("denied");
        } else if (active) {
          setState("ready");
        }
      } catch {
        if (active) setState("unavailable");
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function enable() {
    if (!config?.publicKey) return;
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "ready");
        setMessage(permission === "denied"
          ? "Alerts are blocked by your browser. Change CivicSignal's notification permission in browser settings to enable them."
          : "Allow notifications in the browser prompt to turn on alerts.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() ??
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(config.publicKey) as BufferSource,
        });
      await api.put("/api/notifications/push/subscription", subscription.toJSON());
      setState("enabled");
      setConfig({ ...config, deviceCount: config.deviceCount + 1 });
      setMessage("System alerts are on for this device.");
    } catch {
      setMessage("Alerts could not be enabled. Check your browser permission and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.delete("/api/notifications/push/subscription", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState("ready");
      setConfig(config ? { ...config, deviceCount: Math.max(0, config.deviceCount - 1) } : null);
      setMessage("System alerts are off for this device.");
    } catch {
      setMessage("Alerts could not be turned off. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const description = state === "enabled"
    ? "This device can show report alerts while CivicSignal is closed."
    : state === "install-required"
      ? "On iPhone or iPad, add CivicSignal to your Home Screen first. Open it from the new icon, then enable alerts here."
      : state === "unsupported"
        ? "This browser cannot receive background alerts. Your in-app notification history still works."
        : state === "denied"
          ? "Notification permission is blocked. Allow CivicSignal alerts in your browser or device settings."
          : state === "unavailable"
            ? "Background alerts are temporarily unavailable. Your in-app notification history still works."
            : "Get a system alert when a report arrives or changes, even when CivicSignal is closed.";

  return (
    <section className="card push-preferences" aria-labelledby="push-preferences-title">
      <div className="push-preferences-copy">
        <span className="push-icon" aria-hidden="true"><BellRing size={19} /></span>
        <div>
          <h2 id="push-preferences-title">Phone and computer alerts</h2>
          <p className="muted">{description}</p>
          {state === "enabled" && config && config.deviceCount > 1 && (
            <p className="muted">Alerts are set up on {config.deviceCount} devices for this account.</p>
          )}
          {message && <p className="push-message" role="status" aria-live="polite">{message}</p>}
        </div>
      </div>
      <div className="push-preferences-action">
        {state === "enabled" ? (
          <button className="button" type="button" onClick={() => void disable()} disabled={busy}>
            {busy ? "Updating…" : "Turn off on this device"}
          </button>
        ) : state === "ready" ? (
          <button className="button primary" type="button" onClick={() => void enable()} disabled={busy}>
            {busy ? "Enabling…" : "Enable alerts"}
          </button>
        ) : state === "checking" ? (
          <span className="muted" role="status">Checking this device…</span>
        ) : null}
      </div>
    </section>
  );
}

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

      <PushPreferences />

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
