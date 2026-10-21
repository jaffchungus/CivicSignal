import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { useAuth } from "../lib/auth";
import { useAction, useFetch } from "../lib/hooks";
import type { Organization } from "../../shared/contracts";

type RequestRole = "RESIDENT" | "OFFICIAL" | "LAW_ENFORCEMENT";

export function SignUpPage() {
  const { user, loading, signUp } = useAuth();
  const navigate = useNavigate();
  const {
    data: organizationData,
    loading: organizationsLoading,
    error: organizationsError,
    reload: reloadOrganizations,
  } = useFetch<{
    organizations: Organization[];
  }>("/api/organizations");
  const organizations = organizationData?.organizations ?? [];
  const [form, setForm] = useState<{
    displayName: string;
    email: string;
    password: string;
    role: RequestRole;
    organizationId: string;
  }>({
    displayName: "",
    email: "",
    password: "",
    role: "RESIDENT",
    organizationId: "",
  });
  const {
    pending: submitting,
    error,
    fieldErrors,
    run,
  } = useAction();

  if (loading) {
    return <p className="centered">Loading…</p>;
  }
  if (user) {
    return <Navigate to="/" replace />;
  }

  const expectedKind =
    form.role === "LAW_ENFORCEMENT" ? "LAW_ENFORCEMENT" : "PUBLIC_SERVICE";
  const organizationOptions = organizations.filter(
    (organization) => organization.kind === expectedKind,
  );
  const needsOrganization = form.role !== "RESIDENT";
  const organizationConfigurationMissing =
    needsOrganization && !organizationsLoading && !organizationsError && organizationOptions.length === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await signUp({
        displayName: form.displayName,
        email: form.email,
        password: form.password,
        role: form.role,
        organizationId:
          form.role === "RESIDENT" ? undefined : form.organizationId || undefined,
      });
      navigate("/");
    });
  }

  return (
    <section className="card narrow">
      <h1>Create your account</h1>
      <p className="muted">
        Residents can report issues right away. Official and law-enforcement accounts
        are reviewed by an administrator before they are activated.
      </p>
      <form onSubmit={submit} className="stack">
        <Field label="Your name" error={fieldErrors.displayName}>
          <input
            className="input"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            required
          />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </Field>
        <Field
          label="Password"
          hint="At least 12 characters."
          error={fieldErrors.password}
        >
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required
          />
        </Field>
        <Field
          label="Account type"
          hint={
            form.role === "RESIDENT"
              ? undefined
              : "Your account stays inactive until an administrator verifies it."
          }
          error={fieldErrors.role}
        >
          <select
            className="select"
            value={form.role}
            onChange={(event) =>
              setForm({
                ...form,
                role: event.target.value as RequestRole,
                organizationId: "",
              })
            }
          >
            <option value="RESIDENT">Resident — report and track issues</option>
            <option value="OFFICIAL">Public-service official</option>
            <option value="LAW_ENFORCEMENT">Law enforcement</option>
          </select>
        </Field>
        {needsOrganization && (
          <>
            <Field
              label="Organization"
              hint="Official access remains pending until an administrator verifies your account."
              error={fieldErrors.organizationId}
            >
            <select
              className="select"
              value={form.organizationId}
              disabled={organizationsLoading || Boolean(organizationsError) || organizationOptions.length === 0}
              onChange={(event) =>
                setForm({ ...form, organizationId: event.target.value })
              }
              required
            >
              <option value="">
                {organizationsLoading ? "Loading organizations…" : "Select your organization…"}
              </option>
              {organizationOptions.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
            </Field>
            {organizationsError && (
              <div className="error" role="alert">
                <span>{organizationsError}</span>
                <button className="button" type="button" onClick={reloadOrganizations}>Try again</button>
              </div>
            )}
            {organizationConfigurationMissing && (
              <p className="warning" role="status">
                No {form.role === "LAW_ENFORCEMENT" ? "law-enforcement" : "public-service"} organizations are configured.
                Ask your CivicSignal administrator to add yours before requesting official access.
              </p>
            )}
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button
          className="button primary"
          type="submit"
          disabled={submitting || (needsOrganization && (organizationsLoading || Boolean(organizationsError) || organizationOptions.length === 0))}
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </section>
  );
}
