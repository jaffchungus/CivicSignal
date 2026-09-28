import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import type { Category, Report } from "../../shared/contracts";

export function ReportCreatePage() {
  const navigate = useNavigate();
  const { data: categoryData } = useFetch<{ categories: Category[] }>(
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
          flash: `Report ${report.referenceCode} was submitted. ${report.organization?.name ?? "The responsible organization"} has been notified.`,
        },
      });
    });
  }

  return (
    <section className="card narrow">
      <h1>Report an issue</h1>
      <p className="muted">
        Describe a non-emergency community issue. It will be routed to the responsible
        public-service organization.
      </p>
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
            required
          >
            <option value="">Select a category…</option>
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
          hint="JPEG, PNG, WebP, or GIF, up to 5 MB."
          error={fieldErrors.photo}
        >
          <input
            className="input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="button-row">
          <button className="button primary" type="submit" disabled={submitting}>
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
