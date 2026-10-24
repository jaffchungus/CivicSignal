import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { ApiRequestError, api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { MAX_REPORT_PHOTO_BYTES } from "../../shared/contracts";
import { isCoordinateOnlyLocation } from "../../shared/report-location";
import type { Category, PhotoAnalysisResult, Report } from "../../shared/contracts";

type Draft = { categoryId: string; title: string; description: string; location: string };
type RoutingReadiness = {
  jurisdiction?: { status: string; reason?: string };
  photoClassification?: { status: string; reason?: string };
  photoStorage?: { status: string };
};
type LocationLookupInfo = {
  providerName?: string;
  attribution?: string;
  attributionUrl?: string;
  policyUrl?: string;
  usageNote?: string;
};
const emptyDraft: Draft = { categoryId: "", title: "", description: "", location: "" };

function readDraft(key: string): Draft {
  try {
    const draft = { ...emptyDraft, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
    if (isCoordinateOnlyLocation(draft.location)) draft.location = "";
    return draft;
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
  const [locationLookupBusy, setLocationLookupBusy] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const { data, loading: categoriesLoading, error: categoriesError, reload } =
    useFetch<{ categories: Category[] }>("/api/categories");
  const categories = data?.categories ?? [];
  const { data: routingReadiness } = useFetch<RoutingReadiness>("/api/routing/readiness");
  const { data: locationLookupInfo } = useFetch<LocationLookupInfo>("/api/location/attribution");
  const { pending, error, fieldErrors, run } = useAction();

  function handlePhotoChange(file: File | null) {
    photoAnalysisRequestId.current += 1;
    setPhoto(file);
    setPhotoError(null);
    setAnalysisResult(null);
    setAnalysisMessage(null);
    setAnalyzingPhoto(false);
  }

  async function requestPhotoSuggestions() {
    if (!photo) return;
    const requestId = ++photoAnalysisRequestId.current;
    setAnalysisResult(null);
    setAnalysisMessage(null);
    setAnalyzingPhoto(true);
    try {
      const payload = new FormData();
      payload.set("photo", photo);
      const res = await api.postForm<{ analysis: PhotoAnalysisResult }>("/api/reports/analyze-photo", payload);
      if (photoAnalysisRequestId.current !== requestId) return;
      setAnalysisResult(res.analysis);
      setAnalysisMessage(null);
    } catch (error) {
      if (photoAnalysisRequestId.current !== requestId) return;
      setAnalysisMessage(error instanceof ApiRequestError && error.code === "INVALID_IMAGE_CONTENT"
        ? "Choose a valid image file. You can enter the issue details manually."
        : "Description is unavailable right now. You can enter the issue details manually.");
    } finally {
      if (photoAnalysisRequestId.current === requestId) setAnalyzingPhoto(false);
    }
  }

  function updateLocationFromDevice() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocationMessage("This browser cannot share a location. Enter the address, intersection, or landmark manually.");
      return;
    }

    setLocationLookupBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void api.post<{ address: string }>("/api/location/reverse", {
          latitude: coords.latitude,
          longitude: coords.longitude,
        }).then(({ address }) => {
          setForm((current) => ({ ...current, location: address }));
          setLocationMessage("Address added. Check it and edit it if needed.");
        }).catch((error: unknown) => {
          setLocationMessage(error instanceof ApiRequestError
            ? error.message
            : "Address lookup is temporarily unavailable. Enter the location manually.");
        }).finally(() => setLocationLookupBusy(false));
      },
      () => {
        setLocationLookupBusy(false);
        setLocationMessage("We couldn't read your device location. Allow location access or enter the address manually.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  useEffect(() => {
    if (identityRef.current === identity) return;
    photoAnalysisRequestId.current += 1;
    removeDraft(`civicsignal.report-draft.${identityRef.current}`);
    identityRef.current = identity;
    setForm(emptyDraft);
    setPhoto(null);
    setPhotoError(null);
    setAnalyzingPhoto(false);
    setAnalysisResult(null);
    setAnalysisMessage(null);
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
  const photoStorageUnavailable = routingReadiness?.photoStorage?.status === "unavailable";
  const photoAnalysisConfigured = routingReadiness?.photoClassification?.status === "configured";
  const coordinatesEntered = isCoordinateOnlyLocation(form.location);

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
          <p className="eyebrow">Non-emergency community report</p>
          <h1>Report a local issue</h1>
          <p className="muted">A photo is required in this version. Choose a category and enter a street address, intersection, or landmark.</p>
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
          Optional AI description is not configured here. Enter the report details yourself.
        </p>
      )}
      {photoStorageUnavailable && (
        <p className="warning" role="status">
          Photo storage is temporarily unavailable. You can save your text draft and try again later.
        </p>
      )}

      <form onSubmit={submit} className="stack">
        {step === "details" ? (
          <>
            <div className="report-action-grid">
              <Field
                label="Photo (required)"
                hint="Maximum 4 MiB. If you submit, this photo is shared with the configured organization and authorized staff. It is sent to Google Gemini only if you choose to generate AI suggestions below. Avoid sensitive details."
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
              {photo && (
                <div className="photo-ai-controls">
                  {photoAnalysisConfigured ? (
                    <button
                      className="button"
                      type="button"
                      disabled={analyzingPhoto}
                      onClick={() => void requestPhotoSuggestions()}
                    >
                      {analyzingPhoto ? "Preparing description…" : analysisResult ? "Generate description again" : "Generate optional description"}
                    </button>
                  ) : routingReadiness?.photoClassification?.status === "unavailable" ? (
                    <p className="muted" role="status">AI description is not enabled here. Enter the report details yourself.</p>
                  ) : (
                    <p className="muted" role="status">Checking whether optional description is available…</p>
                  )}
                </div>
              )}
              <div className="location-action">
                <strong>Enter the precise location</strong>
                <p className="muted">Type an address, intersection, or landmark, or use your device location to fill in an editable address.</p>
                <button className="button" type="button" onClick={updateLocationFromDevice} disabled={locationLookupBusy}>
                  {locationLookupBusy ? "Finding address…" : "Use my current location"}
                </button>
                {locationMessage && <p className="muted" role="status">{locationMessage}</p>}
                <p className="muted location-attribution">
                  Your device location is sent to {locationLookupInfo?.providerName ?? "the address lookup service"}; the returned address is editable. {locationLookupInfo?.usageNote}
                  {locationLookupInfo?.attribution && locationLookupInfo.attributionUrl && <> <a href={locationLookupInfo.attributionUrl} target="_blank" rel="noreferrer">{locationLookupInfo.attribution}</a>.</>}
                  {locationLookupInfo?.policyUrl && <> <a href={locationLookupInfo.policyUrl} target="_blank" rel="noreferrer">Lookup service policy</a>.</>}
                </p>
              </div>
            </div>

            {analyzingPhoto && (
              <div className="card ai-card analyzing" role="status">
                <span>Sending the photo for description…</span>
              </div>
            )}

            {analysisResult && (
              <div className="card ai-card" role="region" aria-label="Description">
                <div className="ai-card-header">
                  <span className="badge ai-badge">Description</span>
                </div>
                <p className="ai-problem-text">
                  <strong>Possible issue:</strong> {analysisResult.problem}
                </p>
                <p className="muted">This description can be wrong. Confirm the issue type, title, and details before submitting.</p>
                {analysisResult.detectedCues && analysisResult.detectedCues.length > 0 && (
                  <p className="muted ai-cues">
                    <strong>Visual cues:</strong> {analysisResult.detectedCues.join(" · ")}
                  </p>
                )}
                <button
                  className="button button-sm ai-apply-button"
                  type="button"
                  onClick={() => {
                    const suggestedCategoryName = analysisResult.suggestedCategoryName.trim().toLocaleLowerCase();
                    const matched = suggestedCategoryName
                      ? categories.find((category) => category.name.trim().toLocaleLowerCase() === suggestedCategoryName)
                      : undefined;
                    setForm((current) => ({
                      ...current,
                      title: analysisResult.suggestedTitle,
                      description: analysisResult.suggestedDescription,
                      categoryId: matched ? matched.id : current.categoryId,
                    }));
                  }}
                >
                  Apply description
                </button>
              </div>
            )}

            {analysisMessage && !analysisResult && !analyzingPhoto && (
              <p className="muted" role="status">{analysisMessage}</p>
            )}

            <Field
              label="Precise location"
              hint="Enter a street address, intersection, or landmark. Only shared when you submit."
              error={fieldErrors.location ?? (coordinatesEntered ? "Enter a street address, intersection, or landmark instead of coordinates." : undefined)}
            >
              <input
                className="input"
                value={form.location}
                placeholder="e.g. 25 Main St, or Main St and Oak Ave"
                onChange={(event) => setForm({ ...form, location: event.target.value })}
                required
                autoComplete="street-address"
                maxLength={300}
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
              <button
                className="button primary"
                type="button"
                disabled={!photo || analyzingPhoto || !form.categoryId || !form.location || coordinatesEntered || routingUnavailable || photoStorageUnavailable || categoriesLoading || Boolean(categoriesError)}
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
                  <dt>Photo suggestion</dt>
                  <dd>{analysisResult.problem}</dd>
                </div>
              )}
              <div>
                <dt>Location</dt>
                <dd>{form.location}</dd>
              </div>
              <div><dt>Issue type</dt><dd>{chosenCategory?.name ?? "Not selected"}</dd></div>
              <div><dt>Receiving organization</dt><dd>{chosenCategory?.organizationName ?? "Not configured"}</dd></div>
              <div><dt>Summary</dt><dd>{form.title || `${chosenCategory?.name ?? "Issue"} issue`}</dd></div>
              <div><dt>Details</dt><dd>{form.description || "No additional details"}</dd></div>
            </dl>
            <div className="privacy-summary">
              <strong>Privacy</strong>
              <p>Your photo, location, and details are shared with the receiving organization and authorized CivicSignal staff if you submit. {photoAnalysisConfigured && <>If you choose Generate photo suggestions, the photo is sent to Google Gemini for analysis even if you later cancel. </>}This report is not publicly listed. Keep the secure tracking link private.</p>
              {!user && <p>No account is needed. A secure, one-time tracking link will be shown after submission; save it to return to your report.</p>}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="button-row">
              <button className="button primary" type="submit" disabled={pending || photoStorageUnavailable}>{pending ? "Sending report…" : "Submit report"}</button>
              <button className="button" type="button" onClick={() => setStep("details")} disabled={pending}>Edit report</button>
              <Link className="button" to="/">Cancel</Link>
            </div>
          </>
        )}
      </form>
    </section>
  );
}
