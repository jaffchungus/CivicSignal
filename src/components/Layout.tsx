import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { useNotifications } from "../lib/notifications";

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadCount } = useNotifications();
  const flash = (location.state as { flash?: string } | null)?.flash ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          CivicSignal
        </Link>
        {user && (
          <nav className="topnav">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/notifications">
              Notifications
              {unreadCount > 0 && <span className="pill">{unreadCount}</span>}
            </NavLink>
            {user.role === "ADMIN" && <NavLink to="/admin">Administration</NavLink>}
            <span className="user-chip">{user.displayName}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                void signOut().then(() => navigate("/signin"));
              }}
            >
              Sign out
            </button>
          </nav>
        )}
      </header>
      {flash && <div className="flash">{flash}</div>}
      <main className="content">
        <Outlet />
      </main>
      <footer className="footer">
        CivicSignal is for non-emergency civic issues and communication with local
        public-service organizations. It is not an emergency service — if someone is in
        immediate danger, call 911.
      </footer>
    </div>
  );
}
