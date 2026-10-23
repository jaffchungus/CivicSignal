import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { ApiRequestError, api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { MAX_REPORT_PHOTO_BYTES } from "../../shared/contracts";
import type { Category, PhotoAnalysisResult, Report } from "../../shared/contracts";

type Draft = { categoryId: string; title: string; description: string; location: string };
type RoutingReadiness = {
  jurisdiction?: { status: string; reason?: string };
  photoClassification?: { status: string; reason?: string };
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
  const photoAnalysisRequestId = useRef(0);
  const [form, setForm] = useState<Draft>(() => readDraft(draftKey));
  const changingIdentity = identityRef.current !== identity;
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PhotoAnalysisResult | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [locationMessage, setLocationMessage] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const { data, loading: categoriesLoading, error: categoriesError, reload } =
    useFetch<{ categories: Category[] }>("/api/categories");
  const categories = data?.categories ?? [];
  const { data: routingReadiness } = useFetch<RoutingReadiness>("/api/routing/readiness");
  const { pending, error, fieldErrors, run } = useAction();

  async function handlePhotoChange(file: File | null) {
    const requestId = ++photoAnalysisRequestId.current;
    setPhoto(file);
    setPhotoError(null);
    setAnalysisResult(null);
    setAnalysisMessage(null);
    if (!file) {
      setAnalyzingPhoto(false);
      return;
    }

    setAnalyzingPhoto(true);
    try {
      const payload = new FormData();
      payload.set("photo", file);
      const res = await api.postForm<{ analysis: PhotoAnalysisResult }>("/api/reports/analyze-photo", payload);
      if (photoAnalysisRequestId.current !== requestId) return;
      setAnalysisResult(res.analysis);
      setAnalysisMessage(`AI detected: ${res.analysis.problem}`);
      setForm((current) => {
        let matchedCatId = current.categoryId;
        if (!matchedCatId && res.analysis.suggestedCategoryName && categories.length > 0) {
          const matched = categories.find((c) =>
            c.name.toLowerCase().includes(res.analysis.suggestedCategoryName.toLowerCase()) ||
            res.analysis.suggestedCategoryName.toLowerCase().includes(c.name.toLowerCase()),
          );
          if (matched) matchedCatId = matched.id;
        }
        return {
          ...current,
          title: current.title || res.analysis.suggestedTitle,
          description: current.description || res.analysis.suggestedDescription,
          categoryId: matchedCatId,
        };
      });
    } catch (error) {
      if (photoAnalysisRequestId.current !== requestId) return;
      setAnalysisMessage(error instanceof ApiRequestError
        ? error.message
        : "AI could not analyze this image automatically. Please verify the issue details manually.");
    } finally {
      if (photoAnalysisRequestId.current === requestId) setAnalyzingPhoto(false);
    }
  }

  useEffect(() => {
    if (identityRef.current === identity) return;
    photoAnalysisRequestId.current += 1;
    removeDraft(`civicsignal.report-draft.${identityRef.current}`);
    identityRef.current = identity;
    setForm(emptyDraft);
    setPhoto(null);
    setAnalyzingPhoto(false);
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
    photoAnalysisRequestId.current += 1;
    removeDraft(draftKey);
    setForm(emptyDraft);
    setPhoto(null);
    setPhotoError(null);
    setAnalysisResult(null);
    setAnalysisMessage(null);
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
          <p className="muted">A photo of the issue is required. The AI analyzes the photo to detect the problem, and a clear location helps route to the municipal representative.</p>
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
      {routingReadiness?.photoClassification?.status === "unavailable" && (
        <p className="muted routing-limit" role="note">
          AI photo suggestions are unavailable. {routingReadiness.photoClassification.reason} You can still enter the issue details manually.
        </p>
      )}

      <form onSubmit={submit} className="stack">
        {step === "details" ? (
          <>
            <div className="report-action-grid">
              <Field
                label="Photo (required)"
                hint="Photo limit: 4 MiB. When AI analysis is available, the image is sent to Google Gemini; free-tier content may be used to improve Google products. Avoid sensitive details and verify suggestions."
                error={photoError ?? undefined}
              >
                <input
                  className="input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  capture="environment"
                  aria-label="Take or select an issue photo (required)"
                  required
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    if (file && file.size > MAX_REPORT_PHOTO_BYTES) {
                      photoAnalysisRequestId.current += 1;
                      event.currentTarget.value = "";
                      setPhoto(null);
                      setPhotoPreview(null);
                      setPhotoError("Choose a photo that is 4 MiB or smaller.");
                      setAnalyzingPhoto(false);
                      setAnalysisResult(null);
                      setAnalysisMessage(null);
                      return;
                    }
                    void handlePhotoChange(file);
                  }}
                />
              </Field>
              {photo && <p className="muted" role="status">Selected: {photo.name}</p>}
              <div className="location-action">
                <strong>Confirm the location</strong>
                <p className="muted">Choose a pin using your device or enter an address, intersection, or landmark.</p>
                <button className="button" type="button" onClick={updateLocationFromDevice}>Use my current location</button>
              </div>
            </div>

            {analyzingPhoto && (
              <div className="card ai-card analyzing" role="status">
                <span>🤖 Analyzing photo with AI to detect the problem…</span>
              </div>
            )}

            {analysisResult && (
              <div className="card ai-card" role="region" aria-label="AI defect analysis">
                <div className="ai-card-header">
                  <span className="badge ai-badge">🤖 AI Problem Detection</span>
                  <span className="muted ai-confidence">
                    {Math.round(analysisResult.confidence * 100)}% confidence · {analysisResult.aiModel}
                  </span>
                </div>
                <p className="ai-problem-text">
                  <strong>Detected Problem:</strong> {analysisResult.problem}
                </p>
                <p className="muted">AI suggestions can be wrong. Confirm the issue type, title, and details before submitting.</p>
                {analysisResult.detectedCues && analysisResult.detectedCues.length > 0 && (
                  <p className="muted ai-cues">
                    <strong>Visual cues:</strong> {analysisResult.detectedCues.join(" · ")}
                  </p>
                )}
                <button
                  className="button button-sm ai-apply-button"
                  type="button"
                  onClick={() => {
                    const matched = categories.find((c) =>
                      c.name.toLowerCase().includes(analysisResult.suggestedCategoryName.toLowerCase()) ||
                      analysisResult.suggestedCategoryName.toLowerCase().includes(c.name.toLowerCase()),
                    );
                    setForm((current) => ({
                      ...current,
                      title: analysisResult.suggestedTitle,
                      description: analysisResult.suggestedDescription,
                      categoryId: matched ? matched.id : current.categoryId,
                    }));
                  }}
                >
                  ✨ Apply AI title, category & details
                </button>
              </div>
            )}

            {analysisMessage && !analysisResult && !analyzingPhoto && (
              <p className="muted" role="status">{analysisMessage}</p>
            )}

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
            {form.location && form.location.trim().length >= 3 && (
              <div className="location-route-preview">
                <a
                  className="button button-sm maps-route-button"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(form.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🗺️ Open Route on Google Maps
                </a>
              </div>
            )}

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
              <button
                className="button primary"
                type="button"
                disabled={!photo || analyzingPhoto || !form.categoryId || !form.location || routingUnavailable || categoriesLoading || Boolean(categoriesError)}
                onClick={() => {
                  if (!photo) {
                    setPhotoError("A photo of the issue is required before continuing.");
                    return;
                  }
                  setStep("confirm");
                }}
              >
                Review report
              </button>
              {hasDraft && <button className="button" type="button" onClick={discardDraft}>Discard saved draft</button>}
            </div>
          </>
        ) : (
          <>
            <h2>Review before sending</h2>
            <dl className="meta-grid report-confirmation">
              {photo && (
                <div>
                  <dt>Photo (Required)</dt>
                  <dd>
                    <img className="report-photo-preview" src={photoPreview ?? undefined} alt="Selected photo for this report" />
                    <span>{photo.name}</span>
                  </dd>
                </div>
              )}
              {analysisResult && (
                <div>
                  <dt>AI Detected Problem</dt>
                  <dd>🤖 {analysisResult.problem}</dd>
                </div>
              )}
              <div>
                <dt>Location</dt>
                <dd className="location-confirm-cell">
                  <span>{form.location}</span>
                  <a
                    className="button button-sm maps-route-button"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(form.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    🗺️ Route on Google Maps
                  </a>
                </dd>
              </div>
              <div><dt>Issue type</dt><dd>{chosenCategory?.name ?? "Not selected"}</dd></div>
              <div><dt>Receiving organization</dt><dd>{chosenCategory?.organizationName ?? "Not configured"}</dd></div>
              <div><dt>Summary</dt><dd>{form.title || `${chosenCategory?.name ?? "Issue"} issue`}</dd></div>
              <div><dt>Details</dt><dd>{form.description || "No additional details"}</dd></div>
            </dl>
            <div className="privacy-summary">
              <strong>Privacy</strong>
              <p>Your photo, location, and details are shared with the receiving organization and authorized CivicSignal staff for this report. When AI photo analysis is configured, the selected photo is also sent to Google Gemini for suggestions; on Google's free API tier, submitted content may be used to improve Google products. This happens even if you later cancel this report. This report is not publicly listed. Keep the secure tracking link private.</p>
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
