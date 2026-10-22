import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import type { Category, Report } from "../../shared/contracts";

type Draft = { categoryId: string; title: string; description: string; location: string };
type RoutingReadiness = {
  jurisdiction?: { status: string; reason?: string };
  photoClassification?: { status: string };
};
const emptyDraft: Draft = { categoryId: "", title: "", description: "", location: "" };

function readDraft(key: string): Draft {
  try {
    return { ...emptyDraft, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
  } catch {
    return emptyDraft;
  }
}

function removeDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Draft storage is optional. */ }
}

export function ReportCreatePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const identity = user?.id ?? "guest";
  const draftKey = `civicsignal.report-draft.${identity}`;
  const identityRef = useRef(identity);
  const [form, setForm] = useState<Draft>(() => readDraft(draftKey));
  const changingIdentity = identityRef.current !== identity;
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [locationMessage, setLocationMessage] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const { data, loading: categoriesLoading, error: categoriesError, reload } =
    useFetch<{ categories: Category[] }>("/api/categories");
  const categories = data?.categories ?? [];
  const { data: routingReadiness } = useFetch<RoutingReadiness>("/api/routing/readiness");
  const { pending, error, fieldErrors, run } = useAction();

  useEffect(() => {
    if (identityRef.current === identity) return;
    removeDraft(`civicsignal.report-draft.${identityRef.current}`);
    identityRef.current = identity;
    setForm(emptyDraft);
    setPhoto(null);
    setStep("details");
    setHasDraft(false);
  }, [identity]);

  useEffect(() => {
    if (authLoading || changingIdentity) return;
    const serialized = JSON.stringify(form);
    if (serialized === JSON.stringify(emptyDraft)) {
      removeDraft(draftKey);
      setHasDraft(false);
      return;
    }
    try {
      localStorage.setItem(draftKey, serialized);
      setHasDraft(true);
    } catch {
      setHasDraft(false);
    }
  }, [authLoading, changingIdentity, draftKey, form]);

  function updateLocationFromDevice() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocationMessage("This browser cannot share a location. Enter a street, intersection, or landmark instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pin = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
        setForm((current) => ({ ...current, location: `Pinned location: ${pin}` }));
        setLocationMessage("Location added. Review it below and edit the address or landmark before continuing.");
      },
      () => setLocationMessage("We could not read your location. You can enter an address or landmark instead."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const payload = new FormData();
      payload.set("categoryId", form.categoryId);
      payload.set("title", form.title);
      payload.set("description", form.description);
      payload.set("location", form.location);
      if (photo) payload.set("photo", photo);

      const guest = !user;
      const result = await api.postForm<Report & { guestAccessToken?: string }>(
        guest ? "/api/reports/guest" : "/api/reports",
        payload,
      );
      removeDraft(draftKey);
      const responsible = result.organization?.name ?? "the configured organization";
      if (guest && result.guestAccessToken) {
        const path = `/track/${result.id}#${result.guestAccessToken}`;
        navigate(path, {
          state: { flash: `Report ${result.referenceCode} was sent to ${responsible}. Save the secure tracking link to return to it.` },
        });
      } else {
        navigate(`/reports/${result.id}`, {
          state: { flash: `Report ${result.referenceCode} was sent to ${responsible}. You can follow updates on this page.` },
        });
      }
    });
  }

  function discardDraft() {
    removeDraft(draftKey);
    setForm(emptyDraft);
    setPhoto(null);
    setStep("details");
    setHasDraft(false);
  }

  const chosenCategory = categories.find((category) => category.id === form.categoryId);
  const routingUnavailable = !categoriesLoading && !categoriesError && categories.length === 0;

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (authLoading || changingIdentity) return <p className="centered" role="status">Preparing your report…</p>;

  return (
    <section className="card report-composer">
      <div className="page-header">
        <div>
          <p className="eyebrow">See it. Snap it. Help fix it.</p>
          <h1>Report a local issue</h1>
          <p className="muted">A photo is optional. A clear location helps the right configured organization review your report.</p>
        </div>
        <span className="step-indicator" aria-label={step === "details" ? "Step 1 of 2" : "Step 2 of 2"}>
          {step === "details" ? "1 of 2" : "2 of 2"}
        </span>
      </div>

      <aside className="emergency-notice" role="note">
        <strong>Not for emergencies.</strong> CivicSignal is not monitored for urgent situations. If someone is in immediate danger, call 911.
      </aside>
      <p className="muted draft-note">Incomplete text is saved in this browser for this account or guest session. Selected photos are not saved with a draft.</p>

      {categoriesError && (
        <div className="error" role="alert">
          <span>{categoriesError}</span>
          <button className="button" type="button" onClick={reload}>Try again</button>
        </div>
      )}
      {routingUnavailable && (
        <div className="warning" role="status">
          Reports are not available yet because no issue categories are configured for active organizations. Please try again after an administrator configures routing.
        </div>
      )}
      {routingReadiness?.jurisdiction?.status === "unavailable" && (
        <p className="muted routing-limit" role="note">
          Reports are sent to the organization connected to the category you choose. This deployment does not check municipality boundaries or infer a jurisdiction from your location.
        </p>
      )}

      <form onSubmit={submit} className="stack">
        {step === "details" ? (
          <>
            <div className="report-action-grid">
              <Field label="Photo (optional)" hint="Take a photo or choose one from this device. Avoid faces and personal documents when possible.">
                <input
                  className="input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  capture="environment"
                  aria-label="Take or select an optional issue photo"
                  onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                />
              </Field>
              {photo && <p className="muted" role="status">Selected: {photo.name}</p>}
              <div className="location-action">
                <strong>Confirm the location</strong>
                <p className="muted">Choose a pin using your device or enter an address, intersection, or landmark.</p>
                <button className="button" type="button" onClick={updateLocationFromDevice}>Use my current location</button>
              </div>
            </div>
            {locationMessage && <p className="muted" role="status">{locationMessage}</p>}

            <Field label="Location" hint="Only shared when you submit. You can edit this before sending." error={fieldErrors.location}>
              <input
                className="input"
                value={form.location}
                placeholder="Street, intersection, or landmark"
                onChange={(event) => setForm({ ...form, location: event.target.value })}
                required
                autoComplete="street-address"
              />
            </Field>

            <Field label="Issue type" hint={chosenCategory?.description || "Choose the closest configured category. CivicSignal does not guess the receiving organization."} error={fieldErrors.categoryId}>
              <select
                className="select"
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                disabled={categoriesLoading || Boolean(categoriesError) || categories.length === 0}
                required
              >
                <option value="">{categoriesLoading ? "Loading issue types…" : "Choose an issue type…"}</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name} — {category.organizationName}</option>)}
              </select>
            </Field>

            <details>
              <summary>Add details (optional)</summary>
              <div className="stack details-fields">
                <Field label="Short summary" hint="If left blank, the category name will be used." error={fieldErrors.title}>
                  <input className="input" value={form.title} maxLength={140} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                </Field>
                <Field label="What did you notice?" hint="Share only details you observed. Do not include sensitive personal information." error={fieldErrors.description}>
                  <textarea className="textarea" rows={3} maxLength={4000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
                </Field>
              </div>
            </details>

            <div className="button-row">
              <button className="button primary" type="button" disabled={!form.categoryId || !form.location || routingUnavailable || categoriesLoading || Boolean(categoriesError)} onClick={() => setStep("confirm")}>Review report</button>
              {hasDraft && <button className="button" type="button" onClick={discardDraft}>Discard saved draft</button>}
            </div>
          </>
        ) : (
          <>
            <h2>Review before sending</h2>
            <dl className="meta-grid report-confirmation">
              {photo && <div><dt>Photo</dt><dd><img className="report-photo-preview" src={photoPreview ?? undefined} alt="Selected photo for this report" /><span>{photo.name}</span></dd></div>}
              <div><dt>Location</dt><dd>{form.location}</dd></div>
              <div><dt>Issue type</dt><dd>{chosenCategory?.name ?? "Not selected"}</dd></div>
              <div><dt>Receiving organization</dt><dd>{chosenCategory?.organizationName ?? "Not configured"}</dd></div>
              <div><dt>Summary</dt><dd>{form.title || `${chosenCategory?.name ?? "Issue"} issue`}</dd></div>
              <div><dt>Details</dt><dd>{form.description || "No additional details"}</dd></div>
            </dl>
            <div className="privacy-summary">
              <strong>Privacy</strong>
              <p>Your photo, location, and details are shared with the receiving organization and authorized CivicSignal staff for this report. This report is not publicly listed. Keep the secure tracking link private.</p>
              {!user && <p>No account is needed. A secure, one-time tracking link will be shown after submission; save it to return to your report.</p>}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="button-row">
              <button className="button primary" type="submit" disabled={pending}>{pending ? "Sending report…" : "Submit report"}</button>
              <button className="button" type="button" onClick={() => setStep("details")} disabled={pending}>Edit report</button>
              <Link className="button" to="/">Cancel</Link>
            </div>
          </>
        )}
      </form>
    </section>
  );
}
