import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import type { Category, Report } from "../../shared/contracts";

export function ReportCreatePage() {
  const navigate = useNavigate();
  const {
    data: categoryData,
    loading: categoriesLoading,
    error: categoriesError,
    reload: reloadCategories,
  } = useFetch<{ categories: Category[] }>(
    "/api/categories",
  );
  const categories = categoryData?.categories ?? [];
  const [form, setForm] = useState({
    categoryId: "",
    title: "",
    description: "",
    location: "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const {
    pending: submitting,
    error,
    fieldErrors,
    run,
  } = useAction();
  const routingUnavailable = !categoriesLoading && !categoriesError && categories.length === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const data = new FormData();
      data.set("categoryId", form.categoryId);
      data.set("title", form.title);
      data.set("description", form.description);
      data.set("location", form.location);
      if (photo) {
        data.set("photo", photo);
      }
      const report = await api.postForm<Report>("/api/reports", data);
      navigate(`/reports/${report.id}`, {
        state: {
          flash: `Report ${report.referenceCode} was routed to ${report.organization?.name ?? "the configured organization"}. You can follow updates on this page.`,
        },
      });
    });
  }

  return (
    <section className="card narrow">
      <h1>Report an issue</h1>
      <p className="muted">
        Share the issue, its location, and the details that will help local staff respond.
      </p>
      <aside className="emergency-notice" role="note">
        <strong>Not for emergencies.</strong> CivicSignal is not monitored for urgent
        situations. If someone is in immediate danger, call 911.
      </aside>
      {categoriesError && (
        <div className="error" role="alert">
          <span>{categoriesError} You can try loading the categories again.</span>
          <button className="button" type="button" onClick={reloadCategories}>Try again</button>
        </div>
      )}
      {routingUnavailable && (
        <div className="warning" role="status">
          No issue categories are configured for active organizations yet. Contact your
          CivicSignal administrator; this report cannot be routed until one is available.
        </div>
      )}
      <form onSubmit={submit} className="stack">
        <Field
          label="Category"
          hint={
            form.categoryId
              ? categories.find((category) => category.id === form.categoryId)
                  ?.description
              : "Choose the category that best fits the issue."
          }
          error={fieldErrors.categoryId}
        >
          <select
            className="select"
            value={form.categoryId}
            onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            disabled={categoriesLoading || Boolean(categoriesError) || categories.length === 0}
            required
          >
            <option value="">{categoriesLoading ? "Loading categories…" : "Select a category…"}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} — {category.organizationName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" error={fieldErrors.title}>
          <input
            className="input"
            value={form.title}
            placeholder="Short summary, e.g. “Deep pothole on Main Street”"
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            required
          />
        </Field>
        <Field
          label="Description"
          hint="Include details that will help the organization act on this."
          error={fieldErrors.description}
        >
          <textarea
            className="textarea"
            rows={5}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            required
          />
        </Field>
        <Field
          label="Location"
          hint="Street address, intersection, or landmark."
          error={fieldErrors.location}
        >
          <input
            className="input"
            value={form.location}
            onChange={(event) => setForm({ ...form, location: event.target.value })}
            required
          />
        </Field>
        <Field
          label="Photo (optional)"
          hint="Optional. JPEG, PNG, WebP, or GIF, up to 5 MB. Only authorized people who can view this report can access its photo. Avoid faces, license plates, or personal documents where possible."
          error={fieldErrors.photo}
        >
          <input
            className="input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
        </Field>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="button-row">
          <button
            className="button primary"
            type="submit"
            disabled={submitting || categoriesLoading || Boolean(categoriesError) || categories.length === 0}
          >
            {submitting ? "Submitting…" : "Submit report"}
          </button>
          <button
            className="button"
            type="button"
            onClick={() => navigate(-1)}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
