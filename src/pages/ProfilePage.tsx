import { useState, type FormEvent } from "react";

import { Field } from "../components/Field";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAction } from "../lib/hooks";

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
  });
  const profile = useAction();
  const password = useAction();

  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    await profile.run(async () => {
      await api.patch("/api/auth/profile", { displayName });
      await refresh();
    }, "Your profile has been updated.");
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    await password.run(async () => {
      await api.patch("/api/auth/password", passwords);
      setPasswords({ currentPassword: "", newPassword: "" });
    }, "Your password has been changed.");
  }

  return (
    <section className="card narrow">
      <h1>Your profile</h1>
      <p className="muted">Signed in as {user?.email}.</p>
      <form onSubmit={submitProfile} className="stack">
        <h2>Display name</h2>
        <Field label="Display name" error={profile.fieldErrors.displayName}>
          <input
            className="input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>
        {profile.error && <p className="error">{profile.error}</p>}
        {profile.notice && <p className="flash">{profile.notice}</p>}
        <button className="button primary" type="submit" disabled={profile.pending}>
          {profile.pending ? "Saving…" : "Save changes"}
        </button>
      </form>
      <form onSubmit={submitPassword} className="stack">
        <h2>Change password</h2>
        <Field label="Current password" error={password.fieldErrors.currentPassword}>
          <input
            className="input"
            type="password"
            value={passwords.currentPassword}
            onChange={(event) =>
              setPasswords({ ...passwords, currentPassword: event.target.value })
            }
            required
          />
        </Field>
        <Field
          label="New password"
          hint="At least 12 characters."
          error={password.fieldErrors.newPassword}
        >
          <input
            className="input"
            type="password"
            value={passwords.newPassword}
            onChange={(event) =>
              setPasswords({ ...passwords, newPassword: event.target.value })
            }
            required
          />
        </Field>
        {password.error && <p className="error">{password.error}</p>}
        {password.notice && <p className="flash">{password.notice}</p>}
        <button className="button primary" type="submit" disabled={password.pending}>
          {password.pending ? "Changing…" : "Change password"}
        </button>
      </form>
    </section>
  );
}
