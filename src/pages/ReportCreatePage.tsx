import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { ApiRequestError, api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
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
  const locationRequestId = useRef(0);
  const [form, setForm] = useState<Draft>(() => readDraft(draftKey));
  const changingIdentity = identityRef.current !== identity;
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [locationMessage, setLocationMessage] = useState("");
  const [locationLookupBusy, setLocationLookupBusy] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
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
    setAnalyzingPhoto(false);
    if (file && photoAnalysisConfigured) {
      void requestPhotoSuggestions();
    }
  }

  async function requestPhotoSuggestions() {
    if (!photo) return;
    const requestId = ++photoAnalysisRequestId.current;
    setAnalyzingPhoto(true);
    try {
      const payload = new FormData();
      payload.set("photo", photo);
      const res = await api.postForm<{ analysis: PhotoAnalysisResult }>("/api/reports/analyze-photo", payload);
      if (photoAnalysisRequestId.current !== requestId) return;
      if (res.analysis.isSpam) {
        setPhotoError("This image appears to be spam and cannot be submitted. Please choose a real photo of a civic issue.");
        setPhoto(null);
        setPhotoPreview(null);
        return;
      }
      const suggestedCategoryName = res.analysis.suggestedCategoryName.trim().toLocaleLowerCase();
      const matched = suggestedCategoryName
        ? categories.find((category) => category.name.trim().toLocaleLowerCase() === suggestedCategoryName)
        : undefined;
      setForm((current) => ({
        ...current,
        title: res.analysis.suggestedTitle,
        description: res.analysis.suggestedDescription,
        categoryId: matched ? matched.id : current.categoryId,
      }));
    } catch (error) {
      if (photoAnalysisRequestId.current !== requestId) return;
      console.error("Photo analysis failed:", error);
    } finally {
      if (photoAnalysisRequestId.current === requestId) setAnalyzingPhoto(false);
    }
  }

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
        }).catch((error: unknown) => {
          if (locationRequestId.current !== requestId) return;
          setLocationMessage(error instanceof ApiRequestError
            ? `The precise pin is saved. ${error.message}`
            : "The precise pin is saved. Address lookup is unavailable; you can still submit or add a street address.");
        }).finally(() => {
          if (locationRequestId.current === requestId) setResolvingAddress(false);
        });
      },
      (error) => {
        if (locationRequestId.current !== requestId) return;
        setLocationLookupBusy(false);
        setLocationMessage(error.code === error.PERMISSION_DENIED
          ? "Location access is blocked. Allow it in your browser or device settings, or enter the location manually."
          : error.code === error.TIMEOUT
            ? "Your device took too long to find its location. Try again outdoors or enter the location manually."
            : "We couldn't read your device location. Check that location services are on, or enter the location manually.");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  useEffect(() => {
    if (identityRef.current === identity) return;
    photoAnalysisRequestId.current += 1;
    locationRequestId.current += 1;
    removeDraft(`civicsignal.report-draft.${identityRef.current}`);
    identityRef.current = identity;
    setForm(emptyDraft);
    setPhoto(null);
    setPhotoError(null);
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const payload = new FormData();
      payload.set("categoryId", form.categoryId);
      payload.set("title", form.title);
      payload.set("description", form.description);
      payload.set("location", form.location);
      if (form.latitude !== null && form.longitude !== null) {
        payload.set("latitude", String(form.latitude));
        payload.set("longitude", String(form.longitude));
      }
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
    locationRequestId.current += 1;
    setLocationMessage("");
    setLocationLookupBusy(false);
    setResolvingAddress(false);
    removeDraft(draftKey);
    setForm(emptyDraft);
    setPhoto(null);
    setPhotoError(null);
    setAnalyzingPhoto(false);
    setStep("details");
    setHasDraft(false);
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
        <strong>Not for emergencies.</strong> This civic app is not monitored for urgent situations. If someone is in immediate danger, call 911.
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
                hint="Maximum 4 MiB. This civic app shares your photo with the configured organization and authorized staff when you submit. Avoid sensitive details."
                error={photoError ?? undefined}
              >
                <div className="photo-upload-section">
                  <label className={`photo-upload-button ${photo ? 'has-photo' : ''}`}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      aria-label="Upload an issue photo (required)"
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
                          return;
                        }
                        void handlePhotoChange(file);
                      }}
                    />
                    {photo ? `Change photo (${photo.name})` : "Upload photo"}
                  </label>
                  <label className="photo-upload-button">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      capture="environment"
                      aria-label="Take a photo with camera"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0] ?? null;
                        if (file && file.size > MAX_REPORT_PHOTO_BYTES) {
                          photoAnalysisRequestId.current += 1;
                          event.currentTarget.value = "";
                          setPhoto(null);
                          setPhotoPreview(null);
                          setPhotoError("Choose a photo that is 4 MiB or smaller.");
                          setAnalyzingPhoto(false);
                          return;
                        }
                        void handlePhotoChange(file);
                      }}
                    />
                    Take photo
                  </label>
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
            </div>

            {analyzingPhoto && (
              <div className="card ai-card analyzing" role="status">
                <span>Generating description…</span>
              </div>
            )}

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
            <Field label="Issue type and responsible organization" hint={chosenCategory ? `${chosenCategory.description || "This is the closest configured issue type."} Reports go to ${chosenCategory.organizationName}.` : "Choose an issue type to see which organization will receive your report."} error={fieldErrors.categoryId}>
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

            <div className="button-row">
              <button
                className="button primary"
                type="button"
                disabled={!photo || analyzingPhoto || !form.categoryId || (!form.location && !hasPrecisePin) || coordinatesEntered || routingUnavailable || photoStorageUnavailable || categoriesLoading || Boolean(categoriesError)}
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
              <div>
                <dt>Location</dt>
                <dd>{form.location}</dd>
              </div>
              {hasPrecisePin && (
                <div>
                  <dt>Precise GPS pin</dt>
                  <dd>{form.latitude!.toFixed(6)}, {form.longitude!.toFixed(6)} · {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">Preview map</a>}</dd>
                </div>
              )}
              <div><dt>Issue type</dt><dd>{chosenCategory?.name ?? "Not selected"}</dd></div>
              <div><dt>Receiving organization</dt><dd>{chosenCategory?.organizationName ?? "Not configured"}</dd></div>
            </dl>
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
