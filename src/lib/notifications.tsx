// One owner for the current user's notifications. The header badge and the
// notifications page read the same state, so they can never disagree.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

import type { Notification } from "../../shared/contracts";
import { useAuth } from "./auth";
import { useFetch } from "./hooks";

type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
};

type NotificationsContextValue = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const active = user?.status === "ACTIVE";
  const store = useFetch<NotificationsResponse>(active ? "/api/notifications" : null);
  const previousNotifications = useRef<{ userId: string; ids: Set<string> } | null>(null);

  // Poll as a fallback when the browser's background push provider is unavailable.
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => store.reload(), 20_000);
    return () => window.clearInterval(interval);
  }, [active, store.reload]);

  // Turn newly created in-app notifications into foreground system alerts.
  useEffect(() => {
    if (!active || !user?.id) {
      previousNotifications.current = null;
      return;
    }
    const current = store.data?.notifications;
    if (!current) return;

    const previous = previousNotifications.current;
    previousNotifications.current = {
      userId: user.id,
      ids: new Set(current.map((notification) => notification.id)),
    };
    if (!previous || previous.userId !== user.id || !("Notification" in window) || window.Notification.permission !== "granted") return;

    const fresh = current.filter((notification) => !notification.read && !previous.ids.has(notification.id));
    if (fresh.length === 0 || !("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.ready.then(async (registration) => {
      for (const notification of fresh.reverse()) {
        const url = notification.reportId
          ? `/reports/${encodeURIComponent(notification.reportId)}`
          : "/notifications";
        await registration.showNotification(notification.title, {
          body: notification.message,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: notification.reportId ? `report-${notification.reportId}` : `notification-${notification.id}`,
          data: { url },
        });
      }
    }).catch(() => undefined);
  }, [active, store.data, user?.id]);

  // Keep the count fresh as the user moves between pages (mirrors the badge's
  // old refresh-on-navigation behavior). The initial load — and any transition
  // into an active session — is useFetch's job, so navigation-triggered
  // reloads skip when the session state changed in the same commit.
  const previous = useRef({ pathname, active });
  useEffect(() => {
    const pathChanged = previous.current.pathname !== pathname;
    const sessionChanged = previous.current.active !== active;
    previous.current = { pathname, active };
    if (pathChanged && !sessionChanged) {
      store.reload();
    }
  }, [pathname, active, store.reload]);

  const value = useMemo<NotificationsContextValue>(() => {
    const response = active ? store.data : null;
    return {
      notifications: response?.notifications ?? [],
      unreadCount: response?.unreadCount ?? 0,
      loading: store.loading,
      error: store.error,
      reload: store.reload,
    };
  }, [active, store.data, store.loading, store.error, store.reload]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used inside a NotificationsProvider.");
  }
  return context;
}
