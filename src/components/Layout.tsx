import { useEffect } from "react";
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
  const { user, setupRequired, signOut, loadError, refresh } = useAuth();
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

  useEffect(() => {
    const path = location.pathname;
    const page = path === "/privacy"
      ? { title: "Privacy", description: "What CivicSignal stores, who can access a report, and the limitations of this demo deployment." }
      : path === "/terms"
        ? { title: "Terms and limitations", description: "CivicSignal is an independent, non-emergency community-reporting project." }
        : path === "/signin"
          ? { title: "Sign in", description: "Sign in to submit a non-emergency community report or follow an existing report." }
          : path === "/signup"
            ? { title: "Create an account", description: "Create a CivicSignal account to report non-emergency community issues and follow updates." }
            : path === "/reports/new"
              ? { title: "Report an issue", description: "Submit a non-emergency community issue to a configured organization." }
              : path === "/admin"
                ? { title: "Administration", description: "Manage CivicSignal accounts, organizations, issue categories, and moderation." }
                : path === "/notifications"
                  ? { title: "Notifications", description: "Review updates about your CivicSignal reports." }
                  : path === "/profile"
                    ? { title: "Profile", description: "Manage your CivicSignal account details and password." }
                    : path.startsWith("/reports/")
                      ? { title: "Report details", description: "View the recorded status, official updates, and history for a CivicSignal report." }
                      : user
                        ? { title: homeLabel, description: "Track community reports and recorded responses in CivicSignal." }
                        : { title: "Community issue reporting", description: "Report a neighborhood issue and see what happens next. CivicSignal is not an emergency service." };
    document.title = `${page.title} · CivicSignal`;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = page.description;
  }, [location.pathname, user, homeLabel]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <MapPin aria-hidden="true" size={21} strokeWidth={2.4} />
            <span>CivicSignal</span>
          </Link>
          {user ? (
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
          ) : (
            <nav className="topnav" aria-label="Main navigation">
              <NavLink to="/signin">Sign in</NavLink>
              <NavLink className="button primary topbar-cta" to={setupRequired ? "/setup" : "/signup"}>Get started</NavLink>
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
        <span className="footer-links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms and limitations</Link></span>
      </footer>
    </div>
  );
}
