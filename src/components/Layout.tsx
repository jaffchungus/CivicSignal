import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";

import { useAuth } from "../lib/auth";
import { useNotifications } from "../lib/notifications";
import { useAction } from "../lib/hooks";

function roleLabel(role: string): string {
  if (role === "LAW_ENFORCEMENT") return "Law enforcement";
  if (role === "OFFICIAL") return "Public-service official";
  if (role === "ADMIN") return "Administrator";
  return "Resident";
}

export function Layout() {
  const { user, signOut, loadError, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadCount } = useNotifications();
  const signOutAction = useAction();
  const flash = (location.state as { flash?: string } | null)?.flash ?? null;
  const homeLabel = user?.role === "ADMIN"
    ? "Overview"
    : user?.role === "OFFICIAL" || user?.role === "LAW_ENFORCEMENT"
      ? "Department queue"
      : "My reports";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <MapPin aria-hidden="true" size={21} strokeWidth={2.4} />
            <span>CivicSignal</span>
          </Link>
          {user && (
            <nav className="topnav" aria-label="Main navigation">
              <NavLink to="/" end>
                {homeLabel}
              </NavLink>
              <NavLink to="/notifications">
                Notifications
                {unreadCount > 0 && (
                  <>
                    <span className="notification-count" aria-hidden="true">{unreadCount}</span>
                    <span className="sr-only">{unreadCount} unread</span>
                  </>
                )}
              </NavLink>
              {user.role === "ADMIN" && <NavLink to="/admin">Administration</NavLink>}
              <NavLink to="/profile">Profile</NavLink>
              <span className="user-chip">
                <span>{user.displayName}</span>
                <span className="role-label">{roleLabel(user.role)}</span>
              </span>
              <button
                type="button"
                className="link-button"
                disabled={signOutAction.pending}
                onClick={() => {
                  void signOutAction.run(async () => {
                    await signOut();
                    navigate("/signin");
                  });
                }}
              >
                {signOutAction.pending ? "Signing out…" : "Sign out"}
              </button>
            </nav>
          )}
        </div>
      </header>
      <div className="content">
        {loadError && (
          <div className="error connection-error" role="alert">
            <span>{loadError}</span>
            <button
              className="button"
              type="button"
              onClick={() => void refresh().catch(() => undefined)}
            >
              Try again
            </button>
          </div>
        )}
        {flash && <div className="flash" role="status" aria-live="polite">{flash}</div>}
        {signOutAction.error && <div className="error" role="alert">{signOutAction.error}</div>}
      </div>
      <main className="content main-content">
        <Outlet />
      </main>
      <footer className="footer">
        <strong>Not for emergencies.</strong> CivicSignal is not monitored as an emergency
        service. If someone is in immediate danger, call 911.
      </footer>
    </div>
  );
}
