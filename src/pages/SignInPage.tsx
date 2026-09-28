import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { useAuth } from "../lib/auth";
import { useAction } from "../lib/hooks";

export function SignInPage() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await signIn(form.email, form.password);
      navigate("/");
    });
  }

  return (
    <section className="card narrow">
      <h1>Sign in</h1>
      <p className="muted">
        Report a community issue or handle the ones your organization has received.
      </p>
      <form onSubmit={submit} className="stack">
        <Field label="Email" error={fieldErrors.email}>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </Field>
        <Field label="Password" error={fieldErrors.password}>
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="muted">
        New to CivicSignal? <Link to="/signup">Create an account</Link>
      </p>
    </section>
  );
}
