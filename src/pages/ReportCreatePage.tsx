import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { ApiRequestError, api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { clearDraftPhoto, loadDraftPhoto, saveDraftPhoto } from "../lib/report-photo-draft";
import { MAX_REPORT_PHOTO_BYTES } from "../../shared/contracts";
import { isCoordinateOnlyLocation } from "../../shared/report-location";
import type { Category, PhotoAnalysisResult, Report } from "../../shared/contracts";

type Draft = {
  categoryId: string;
  title: string;
  description: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
};
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
type AiSuggestion = {
  categoryId: string;
  title: string;
  description: string;
  confidence: number;
  problem: string;
  detectedCues: string[];
};
const emptyDraft: Draft = { categoryId: "", title: "", description: "", location: "", latitude: null, longitude: null };

function readDraft(key: string): Draft {
  try {
    const draft = { ...emptyDraft, ...JSON.parse(localStorage.getItem(key) ?? "{}") } as Draft;
    if (typeof draft.latitude !== "number" || draft.latitude < -90 || draft.latitude > 90) draft.latitude = null;
    if (typeof draft.longitude !== "number" || draft.longitude < -180 || draft.longitude > 180) draft.longitude = null;
    if (isCoordinateOnlyLocation(draft.location)) draft.location = "";
    return draft;
  } catch {
    return emptyDraft;
  }
}

function removeDraftText(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Draft storage is optional. */ }
}

function removeDraft(key: string): void {
  removeDraftText(key);
  void clearDraftPhoto(key);
}

function RoutingNote({ source, confidence, categoryName, organizationName }: {
  source: "AI" | "RESIDENT" | "AI_FALLBACK";
  confidence?: number;
  categoryName: string;
  organizationName?: string | null;
}) {
  if (source === "AI") {
    return (
      <p className="routing-note" role="status">
        <strong>AI suggestion used.</strong> {categoryName} is routed to {organizationName ?? "its configured organization"}.
        {typeof confidence === "number" && confidence < 0.6 ? " Confidence was low, so staff should verify the category." : ""}
        {" "}You can still change it before sending.
      </p>
    );
  }
  if (source === "AI_FALLBACK") {
    return (
      <p className="routing-note" role="status">
        <strong>You chose the category.</strong> AI could not confidently classify the issue, so this report will be reviewed
        with the category you selected. It routes to {organizationName ?? "the configured organization"}.
      </p>
    );
  }
  return (
    <p className="routing-note" role="status">
      <strong>You chose the category.</strong> This report routes to {organizationName ?? "the configured organization"}.
    </p>
  );
}

export function ReportCreatePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const identity = user?.id ?? "guest";
  const draftKey = `civicsignal.report-draft.${identity}`;
  const activeIdentityRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const photoAnalysisRequestId = useRef(0);
  const locationRequestId = useRef(0);
  const skipPhotoAnalysisFor = useRef<File | null>(null);
  const [form, setForm] = useState<Draft>(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const changingIdentity = !authLoading && loadedIdentity !== identity;
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [analysisAttempted, setAnalysisAttempted] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [locationMessage, setLocationMessage] = useState("");
  const [locationLookupBusy, setLocationLookupBusy] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const { data, loading: categoriesLoading, error: categoriesError, reload } =
    useFetch<{ categories: Category[] }>("/api/categories");
  const categories = data?.categories ?? [];
  const { data: routingReadiness } = useFetch<RoutingReadiness>("/api/routing/readiness");
  const { data: locationLookupInfo } = useFetch<LocationLookupInfo>("/api/location/attribution");
  const { pending, error, fieldErrors, run } = useAction();

  function clearPhoto() {
    photoAnalysisRequestId.current += 1;
    setPhoto(null);
    setPhotoPreview(null);
    setPhotoNotice(null);
    setAnalyzingPhoto(false);
    setAnalysisAttempted(false);
    setAiSuggestion(null);
    void clearDraftPhoto(draftKeyRef.current);
  }

  const acceptPhoto = useCallback((file: File | null) => {
    photoAnalysisRequestId.current += 1;
    setAnalysisAttempted(false);
    setAiSuggestion(null);
    setPhotoNotice(null);
    setPhoto(file);
    if (file) void saveDraftPhoto(draftKeyRef.current, file);
    else void clearDraftPhoto(draftKeyRef.current);
  }, []);

  function selectPhoto(file: File | null, input: HTMLInputElement): void {
    if (file && file.size > MAX_REPORT_PHOTO_BYTES) {
      input.value = "";
      acceptPhoto(null);
      setPhotoNotice("Choose a photo that is 4 MiB or smaller. You can also send this report without a photo.");
      return;
    }
    acceptPhoto(file);
  }

  const requestPhotoSuggestions = useCallback(async (file: File) => {
    const requestId = ++photoAnalysisRequestId.current;
    setAnalyzingPhoto(true);
    setAnalysisAttempted(true);
    setPhotoNotice(null);
    try {
      const payload = new FormData();
      payload.set("photo", file);
      const res = await api.postForm<{ analysis: PhotoAnalysisResult }>("/api/reports/analyze-photo", payload);
      if (photoAnalysisRequestId.current !== requestId) return;
      if (res.analysis.isSpam) {
        setPhotoNotice("This image appears to be spam and cannot be submitted. Choose a real photo of a civic issue, or remove it and describe the problem in text.");
        setPhoto(null);
        setPhotoPreview(null);
        setAnalysisAttempted(false);
        setAiSuggestion(null);
        void clearDraftPhoto(draftKeyRef.current);
        return;
      }
      const suggestion: AiSuggestion = {
        categoryId: res.analysis.suggestedCategoryId,
        title: res.analysis.suggestedTitle,
        description: res.analysis.suggestedDescription,
        confidence: res.analysis.confidence,
        problem: res.analysis.problem,
        detectedCues: res.analysis.detectedCues ?? [],
      };
      setAiSuggestion(suggestion);
      setForm((current) => ({
        ...current,
        title: current.title.trim() ? current.title : suggestion.title,
        description: current.description.trim() ? current.description : suggestion.description,
        categoryId: current.categoryId || suggestion.categoryId,
      }));
      if (!suggestion.categoryId) {
        setPhotoNotice("AI could not match this photo to an active issue category. Choose the category that fits best; the report can still be submitted.");
      }
    } catch (caught) {
      if (photoAnalysisRequestId.current !== requestId) return;
      console.error("Photo analysis failed:", caught);
      setPhotoNotice(caught instanceof ApiRequestError
        ? `${caught.message} You can still submit this report by choosing a category and describing the problem.`
        : "AI photo suggestions are unavailable. You can still submit this report by choosing a category and describing the problem.");
    } finally {
      if (photoAnalysisRequestId.current === requestId) setAnalyzingPhoto(false);
    }
  }, []);

  function updateLocationFromDevice() {
    const requestId = ++locationRequestId.current;
    setLocationMessage("");
    setResolvingAddress(false);
    if (!navigator.geolocation) {
      setLocationMessage("This browser cannot share a location. Enter the address, intersection, or landmark manually.");
      return;
    }

    setLocationLookupBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinates = { latitude: coords.latitude, longitude: coords.longitude };
        setForm((current) => ({
          ...current,
          location: "Precise GPS pin attached",
          ...coordinates,
        }));
        setLocationMessage(`Precise pin saved (${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}). Looking up a nearby address…`);
        setLocationLookupBusy(false);
        setResolvingAddress(true);

        void api.post<{ address: string }>("/api/location/reverse", {
          ...coordinates,
        }).then(({ address }) => {
          if (locationRequestId.current !== requestId) return;
          setForm((current) => ({ ...current, location: address }));
          setLocationMessage("Precise pin saved and nearby address found. Review both before sending.");
        }).catch((caught: unknown) => {
          if (locationRequestId.current !== requestId) return;
          setLocationMessage(caught instanceof ApiRequestError
            ? `The precise pin is saved. ${caught.message}`
            : "The precise pin is saved. Address lookup is unavailable; you can still submit or add a street address.");
        }).finally(() => {
          if (locationRequestId.current === requestId) setResolvingAddress(false);
        });
      },
      (caught) => {
        if (locationRequestId.current !== requestId) return;
        setLocationLookupBusy(false);
        setLocationMessage(caught.code === caught.PERMISSION_DENIED
          ? "Location access is blocked. Allow it in your browser or device settings, or enter the location manually."
          : caught.code === caught.TIMEOUT
            ? "Your device took too long to find its location. Try again outdoors or enter the location manually."
            : "We couldn't read your device location. Check that location services are on, or enter the location manually.");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  useEffect(() => {
    if (authLoading || activeIdentityRef.current === identity) return;
    const previousIdentity = activeIdentityRef.current;
    photoAnalysisRequestId.current += 1;
    locationRequestId.current += 1;
    if (previousIdentity !== null) {
      removeDraft(`civicsignal.report-draft.${previousIdentity}`);
    }
    activeIdentityRef.current = identity;
    setLoadedIdentity(identity);
    const restored = readDraft(draftKey);
    setForm(restored);
    setPhoto(null);
    setPhotoPreview(null);
    setPhotoNotice(null);
    setAnalyzingPhoto(false);
    setAnalysisAttempted(false);
    setAiSuggestion(null);
    setStep("details");
    setLocationMessage("");
    setLocationLookupBusy(false);
    setResolvingAddress(false);
    setHasDraft(false);
    setReviewError("");
    setDraftReady(true);

    const selectionVersion = photoAnalysisRequestId.current;
    void loadDraftPhoto(draftKey).then((file) => {
      if (
        !file ||
        activeIdentityRef.current !== identity ||
        photoAnalysisRequestId.current !== selectionVersion
      ) return;
      // A restored draft that already has a category does not need another
      // provider call; reuse the saved classification.
      if (restored.categoryId) skipPhotoAnalysisFor.current = file;
      setPhoto(file);
    });
  }, [authLoading, draftKey, identity]);

  useEffect(() => {
    if (authLoading || changingIdentity || !draftReady) return;
    const serialized = JSON.stringify(form);
    if (serialized === JSON.stringify(emptyDraft)) {
      removeDraftText(draftKey);
      setHasDraft(false);
      return;
    }
    try {
      localStorage.setItem(draftKey, serialized);
      setHasDraft(true);
    } catch {
      setHasDraft(false);
    }
  }, [authLoading, changingIdentity, draftKey, draftReady, form]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const payload = new FormData();
      payload.set("categoryId", form.categoryId);
      payload.set("title", form.title.trim());
      payload.set("description", form.description.trim());
      payload.set("location", form.location.trim());
      if (form.latitude !== null && form.longitude !== null) {
        payload.set("latitude", String(form.latitude));
        payload.set("longitude", String(form.longitude));
      }
      const routingSource = aiSuggestion && form.categoryId === aiSuggestion.categoryId
        ? "AI"
        : analysisAttempted && (!aiSuggestion || aiSuggestion.categoryId !== form.categoryId)
          ? "AI_FALLBACK"
          : "RESIDENT";
      payload.set("routingSource", routingSource);
      if (routingSource === "AI" && aiSuggestion) {
        payload.set("routingConfidence", String(aiSuggestion.confidence));
      }
      if (photo) payload.set("photo", photo);

      const guest = !user;
      const result = await api.postForm<Report & { guestAccessToken?: string }>(
        guest ? "/api/reports/guest" : "/api/reports",
        payload,
      );
      removeDraft(draftKey);
      const responsible = result.organization?.name ?? "the configured organization";
      const municipality = result.municipality?.name ?? "";
      const locationText = municipality ? `${municipality} / ${responsible}` : responsible;
      if (guest && result.guestAccessToken) {
        const path = `/track/${result.id}#${result.guestAccessToken}`;
        navigate(path, {
          state: { flash: `Report ${result.referenceCode} was sent to ${locationText}. Save the secure tracking link to return to it.` },
        });
      } else {
        navigate(`/reports/${result.id}`, {
          state: { flash: `Report ${result.referenceCode} was sent to ${locationText}. You can follow updates on this page.` },
        });
      }
    });
  }

  function discardDraft() {
    photoAnalysisRequestId.current += 1;
    locationRequestId.current += 1;
    setLocationMessage("");
    setLocationLookupBusy(false);
    setResolvingAddress(false);
    removeDraft(draftKey);
    setForm(emptyDraft);
    setPhoto(null);
    setPhotoPreview(null);
    setPhotoNotice(null);
    setAnalyzingPhoto(false);
    setAnalysisAttempted(false);
    setAiSuggestion(null);
    setStep("details");
    setHasDraft(false);
    setReviewError("");
  }

  const chosenCategory = categories.find((category) => category.id === form.categoryId);
  const routingUnavailable = !categoriesLoading && !categoriesError && categories.length === 0;
  const photoStorageUnavailable = routingReadiness?.photoStorage?.status === "unavailable";
  const photoAnalysisConfigured = routingReadiness?.photoClassification?.status === "configured";
  const hasPrecisePin = form.latitude !== null && form.longitude !== null;
  const coordinatesEntered = isCoordinateOnlyLocation(form.location) && !hasPrecisePin;
  const mapUrl = hasPrecisePin
    ? `https://www.openstreetmap.org/?mlat=${form.latitude}&mlon=${form.longitude}#map=18/${form.latitude}/${form.longitude}`
    : null;
  const routingSource = aiSuggestion && form.categoryId === aiSuggestion.categoryId
    ? "AI"
    : analysisAttempted && (!aiSuggestion || aiSuggestion.categoryId !== form.categoryId)
      ? "AI_FALLBACK"
      : "RESIDENT";
  const detailsIncomplete =
    form.title.trim().length < 4 ||
    form.description.trim().length < 10 ||
    !form.categoryId ||
    (!form.location.trim() && !hasPrecisePin);
  const photoBlocked = Boolean(photo) && photoStorageUnavailable;

  useEffect(() => {
    if (!photo || !photoAnalysisConfigured) return;
    if (skipPhotoAnalysisFor.current === photo) {
      skipPhotoAnalysisFor.current = null;
      return;
    }
    void requestPhotoSuggestions(photo);
  }, [photo, photoAnalysisConfigured, requestPhotoSuggestions]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (authLoading || changingIdentity || !draftReady) return <p className="centered" role="status">Preparing your report…</p>;

  return (
    <section className="card report-composer">
      <div className="page-header">
        <div>
          <p className="eyebrow">Non-emergency community report</p>
          <h1>Report a local issue</h1>
          <p className="muted">
            Describe the problem and choose the service that fits. A photo is optional. AI can suggest a category
            when it is configured, but you decide what gets sent.
          </p>
        </div>
        <span className="step-indicator" aria-label={step === "details" ? "Step 1 of 2" : "Step 2 of 2"}>
          {step === "details" ? "1 of 2" : "2 of 2"}
        </span>
      </div>

      <aside className="emergency-notice" role="note">
        <strong>Not for emergencies.</strong> This civic app is not monitored for urgent situations. If someone is in immediate danger, call 911.
      </aside>
      <p className="muted draft-note">Your draft, including any selected photo, is saved in this browser for this account or guest session. Use “Discard saved draft” to remove it.</p>

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
          Reports go to the organization connected to the category you choose. This deployment does not check
          municipality boundaries or infer a jurisdiction from your location.
        </p>
      )}
      {routingReadiness?.photoClassification?.status === "unavailable" && (
        <p className="muted routing-limit" role="note">
          AI photo suggestions are not configured here. You can still choose a category and submit the report.
        </p>
      )}
      {photoStorageUnavailable && (
        <p className="warning" role="status">
          Photo storage is temporarily unavailable. Remove any selected photo and send the report with text only,
          or save your draft and try again later.
        </p>
      )}

      <form onSubmit={submit} className="stack">
        {step === "details" ? (
          <>
            <Field
              label="Photo (optional)"
              hint="Maximum 4 MiB. A photo can help staff understand the problem, but it is not required. When AI suggestions are configured, choosing a photo sends it to Gemini for a category suggestion. On submission, the photo is shared only with the receiving organization and authorized staff. Avoid sensitive details."
              error={photoNotice ?? undefined}
            >
              <div className="photo-field-controls">
              <div className="photo-upload-section">
                <label className={`photo-upload-button${photo ? " has-photo" : ""}`}>
                  <input
                    className="photo-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    aria-label="Add an optional issue photo"
                    onChange={(event) => selectPhoto(event.currentTarget.files?.[0] ?? null, event.currentTarget)}
                  />
                  <span>{photo ? `Change photo (${photo.name})` : "Add a photo"}</span>
                </label>
                <label className="photo-upload-button">
                  <input
                    className="photo-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    capture="environment"
                    aria-label="Take an optional photo with camera"
                    onChange={(event) => selectPhoto(event.currentTarget.files?.[0] ?? null, event.currentTarget)}
                  />
                  <span>Take photo</span>
                </label>
              </div>
              {photo && (
                <div className="photo-selected">
                  {photoPreview && <img className="report-photo-preview" src={photoPreview} alt="Selected report photo" />}
                  <button className="link-button" type="button" onClick={clearPhoto}>Remove photo</button>
                </div>
              )}
              </div>
            </Field>

            <div className="location-action">
              <strong>Pin the exact place</strong>
              <p className="muted">Use your device location to save a precise GPS pin. We’ll also try to suggest a readable address, but the pin is kept even if that lookup fails.</p>
              <button className="button" type="button" onClick={updateLocationFromDevice} disabled={locationLookupBusy}>
                {locationLookupBusy ? "Finding precise location…" : "Use my current location"}
              </button>
              {locationMessage && <p className="muted" role="status">{locationMessage}</p>}
              {resolvingAddress && <p className="muted" role="status">Looking up a nearby address. You can continue while this finishes.</p>}
              {hasPrecisePin && (
                <div className="gps-pin-summary">
                  <span>GPS pin: {form.latitude!.toFixed(6)}, {form.longitude!.toFixed(6)}</span>
                  {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">Preview on map</a>}
                  <button className="link-button" type="button" onClick={() => {
                    locationRequestId.current += 1;
                    setForm((current) => ({
                      ...current,
                      location: current.location === "Precise GPS pin attached" ? "" : current.location,
                      latitude: null,
                      longitude: null,
                    }));
                    setResolvingAddress(false);
                    setLocationMessage("GPS pin removed. Enter an address, intersection, or landmark before continuing.");
                  }}>Remove pin</button>
                </div>
              )}
              <p className="muted location-attribution">
                The exact pin is shared with the organization and authorized staff that receive this report. Only the nearby-address lookup sends coordinates to {locationLookupInfo?.providerName ?? "the address lookup service"}; the returned address is editable. {locationLookupInfo?.usageNote}
                {locationLookupInfo?.attribution && locationLookupInfo.attributionUrl && <> <a href={locationLookupInfo.attributionUrl} target="_blank" rel="noreferrer">{locationLookupInfo.attribution}</a>.</>}
                {locationLookupInfo?.policyUrl && <> <a href={locationLookupInfo.policyUrl} target="_blank" rel="noreferrer">Lookup service policy</a>.</>}
              </p>
            </div>

            <Field label="Report title" hint="A short summary helps staff scan the queue." error={fieldErrors.title}>
              <input
                className="input"
                value={form.title}
                placeholder="e.g. Deep pothole near the crosswalk"
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                required
                minLength={4}
                maxLength={140}
                autoComplete="off"
              />
            </Field>

            <Field label="What is happening?" hint="Describe the problem, who it affects, and any details that would help a crew find it. Do not include personal information about other people." error={fieldErrors.description}>
              <textarea
                className="textarea"
                rows={5}
                value={form.description}
                placeholder="e.g. The pothole is about two feet wide and fills with water. It is in the bike lane just north of the crosswalk."
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                required
                minLength={10}
                maxLength={4000}
              />
            </Field>

            <Field label="Issue category" hint="Choose the service that best matches the problem. The report goes to that category's configured organization." error={fieldErrors.categoryId}>
              <select
                className="select"
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                required
                disabled={categoriesLoading}
              >
                <option value="">{categoriesLoading ? "Loading categories…" : "Choose a category…"}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}{category.organizationName ? ` — ${category.organizationName}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Precise location"
              hint={hasPrecisePin ? "The GPS pin is saved separately. Add a street address, intersection, or landmark to help staff find it." : "Enter a street address, intersection, or landmark, or save a GPS pin above. Only shared when you submit."}
              error={fieldErrors.location ?? (coordinatesEntered ? "Enter a street address, intersection, or landmark instead of coordinates." : undefined)}
            >
              <input
                className="input"
                value={form.location}
                placeholder="e.g. 25 Main St, or Main St and Oak Ave"
                onChange={(event) => {
                  locationRequestId.current += 1;
                  setResolvingAddress(false);
                  setForm({ ...form, location: event.target.value });
                }}
                required={!hasPrecisePin}
                autoComplete="street-address"
                maxLength={300}
              />
            </Field>

            {analyzingPhoto && (
              <div className="card ai-card analyzing" role="status">
                <span>AI is suggesting an issue category and organization…</span>
              </div>
            )}
            {photoNotice && !analyzingPhoto && (
              <p className="warning" role="status">{photoNotice}</p>
            )}
            {aiSuggestion && !analyzingPhoto && (
              <div className="card ai-card">
                <div className="ai-card-header">
                  <span className="ai-badge">AI suggestion</span>
                  <span className="ai-confidence">Confidence {Math.round(aiSuggestion.confidence * 100)}%</span>
                </div>
                <p className="ai-problem-text">{aiSuggestion.problem}</p>
                {aiSuggestion.detectedCues.length > 0 && (
                  <p className="muted ai-cues">Visible cues: {aiSuggestion.detectedCues.join(", ")}</p>
                )}
                <p className="muted">The form was filled only where you had not already entered text. Review and edit it before sending.</p>
              </div>
            )}

            {chosenCategory && (
              <RoutingNote
                source={routingSource}
                confidence={aiSuggestion?.confidence}
                categoryName={chosenCategory.name}
                organizationName={chosenCategory.organizationName}
              />
            )}

            {reviewError && <p className="error" role="alert">{reviewError}</p>}
            <div className="button-row">
              <button
                className="button primary"
                type="button"
                disabled={analyzingPhoto || routingUnavailable || photoBlocked || categoriesLoading || Boolean(categoriesError)}
                onClick={(event) => {
                  if (!event.currentTarget.form?.reportValidity() || detailsIncomplete) {
                    setReviewError("Add a title, a description, a category, and a location or GPS pin before reviewing the report.");
                    return;
                  }
                  setReviewError("");
                  setStep("confirm");
                }}
              >
                Review report
              </button>
              {(hasDraft || photo) && <button className="button" type="button" onClick={discardDraft}>Discard saved draft</button>}
            </div>
          </>
        ) : (
          <>
            <h2>Review before sending</h2>
            <dl className="meta-grid report-confirmation">
              <div><dt>Title</dt><dd>{form.title}</dd></div>
              <div><dt>Description</dt><dd className="description">{form.description}</dd></div>
              <div><dt>Issue category</dt><dd>{chosenCategory?.name ?? "Not selected"}</dd></div>
              <div><dt>Responsible organization</dt><dd>{chosenCategory?.organizationName ?? "Not selected"}</dd></div>
              <div><dt>Location</dt><dd>{form.location}</dd></div>
              {hasPrecisePin && (
                <div>
                  <dt>Precise GPS pin</dt>
                  <dd>{form.latitude!.toFixed(6)}, {form.longitude!.toFixed(6)} · {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">Preview map</a>}</dd>
                </div>
              )}
              <div>
                <dt>Photo</dt>
                <dd>
                  {photo ? (
                    <>
                      {photoPreview && <img className="report-photo-preview" src={photoPreview} alt="Selected report photo" />}
                      <span>{photo.name}</span>
                    </>
                  ) : "No photo. Text-only reports are accepted."}
                </dd>
              </div>
            </dl>
            <RoutingNote
              source={routingSource}
              confidence={aiSuggestion?.confidence}
              categoryName={chosenCategory?.name ?? "Selected category"}
              organizationName={chosenCategory?.organizationName}
            />
            <p className="muted">This report is visible to the receiving organization and authorized staff. It is not a guarantee of a response time or an inspection.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="button-row">
              <button className="button primary" type="submit" disabled={pending || photoBlocked}>{pending ? "Sending report…" : "Submit report"}</button>
              <button className="button" type="button" onClick={() => setStep("details")} disabled={pending}>Edit report</button>
              <Link className="button" to="/">Cancel</Link>
            </div>
          </>
        )}
      </form>
    </section>
  );
}
