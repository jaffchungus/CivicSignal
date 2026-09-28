import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAction } from "../lib/hooks";

export function SetupPage() {
  const { user, setupRequired, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    municipalityName: "",
    displayName: "",
    email: "",
    password: "",
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
  if (!setupRequired) {
    return <Navigate to={user ? "/" : "/signin"} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.post("/api/setup", form);
      await refresh();
      navigate("/", {
        state: {
          flash: `CivicSignal is ready for ${form.municipalityName}. Verify official accounts from the Administration page.`,
        },
      });
    });
  }

  return (
    <section className="card narrow">
      <h1>Set up CivicSignal</h1>
      <p className="muted">
        Create the first administrator account and name your municipality. This runs
        once.
      </p>
      <form onSubmit={submit} className="stack">
        <Field label="Municipality name" error={fieldErrors.municipalityName}>
          <input
            className="input"
            value={form.municipalityName}
            onChange={(event) =>
              setForm({ ...form, municipalityName: event.target.value })
            }
            required
          />
        </Field>
        <Field label="Administrator name" error={fieldErrors.displayName}>
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
        {error && <p className="error">{error}</p>}
        <button className="button primary" type="submit" disabled={submitting}>
          {submitting ? "Setting up…" : "Create administrator"}
        </button>
      </form>
    </section>
  );
}
