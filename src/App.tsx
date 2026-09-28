import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Layout } from "./components/Layout";
import { useAuth } from "./lib/auth";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ReportCreatePage } from "./pages/ReportCreatePage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { SetupPage } from "./pages/SetupPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";

function AccountState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { signOut } = useAuth();
  return (
    <section className="card narrow">
      <h1>{title}</h1>
      <p>{description}</p>
      <button
        type="button"
        className="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
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
  const { user, setupRequired, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p className="centered">Loading…</p>;
  }
  if (!user) {
    return (
      <Navigate
        to={setupRequired ? "/setup" : "/signin"}
        replace
        state={{ from: location.pathname }}
      />
    );
  }
  if (user.status === "PENDING") {
    return (
      <AccountState
        title="Your account is awaiting verification"
        description="CivicSignal official accounts must be verified by an administrator before they can access the civic workflow. You will be able to sign in once your account is approved."
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

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <HomePage />
            </Protected>
          }
        />
        <Route
          path="/reports/new"
          element={
            <Protected>
              <ReportCreatePage />
            </Protected>
          }
        />
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
