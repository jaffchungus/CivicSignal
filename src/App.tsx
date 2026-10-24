import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Layout } from "./components/Layout";
import { useAuth } from "./lib/auth";
import { useAction } from "./lib/hooks";
import { AboutPage } from "./pages/AboutPage";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { LandingPage } from "./pages/LandingPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ReportCreatePage } from "./pages/ReportCreatePage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { SetupPage } from "./pages/SetupPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { PrivacyPage, TermsPage } from "./pages/TrustPages";

function AccountState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { signOut } = useAuth();
  const action = useAction();
  return (
    <section className="card narrow">
      <h1>{title}</h1>
      <p>{description}</p>
      {action.error && <p className="error" role="alert">{action.error}</p>}
      <button
        type="button"
        className="button"
        disabled={action.pending}
        onClick={() => {
          void action.run(signOut);
        }}
      >
        {action.pending ? "Signing out…" : "Sign out"}
      </button>
    </section>
  );
}

function Protected({
  children,
  adminOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
}) {
  const { user, setupRequired, loading, sessionExpired } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p className="centered">Loading…</p>;
  }
  if (!user) {
    return (
      <Navigate
        to={setupRequired ? "/setup" : "/signin"}
        replace
        state={{ from: location.pathname, sessionExpired }}
      />
    );
  }
  if (user.status === "PENDING") {
    return (
      <AccountState
        title="Your account is awaiting verification"
        description="Your request is recorded. An administrator must verify your role and organization before you can use the official workflow. After approval, sign in again to continue."
      />
    );
  }
  if (user.status === "SUSPENDED") {
    return (
      <AccountState
        title="Your account is suspended"
        description="This account has been suspended by an administrator. Contact your public-service organization if you believe this is a mistake."
      />
    );
  }
  if (adminOnly && user.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function HomeRoute() {
  const { user, loading, setupRequired } = useAuth();
  if (loading) return <p className="centered" role="status">Loading CivicSignal…</p>;
  if (!user) return <LandingPage setupRequired={setupRequired} />;
  return <Protected><HomePage /></Protected>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route
          path="/"
          element={<HomeRoute />}
        />
        <Route
          path="/reports/new"
          element={<ReportCreatePage />}
        />
        <Route path="/track/:reportId" element={<ReportDetailPage publicTracking />} />
        <Route
          path="/reports/:reportId"
          element={
            <Protected>
              <ReportDetailPage />
            </Protected>
          }
        />
        <Route
          path="/notifications"
          element={
            <Protected>
              <NotificationsPage />
            </Protected>
          }
        />
        <Route
          path="/profile"
          element={
            <Protected>
              <ProfilePage />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected adminOnly>
              <AdminPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
