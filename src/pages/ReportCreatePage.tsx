import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Field } from "../components/Field";
import { ApiRequestError, api } from "../lib/api";
import { useAction, useFetch } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import { clearDraftPhoto, loadDraftPhoto, saveDraftPhoto } from "../lib/report-photo-draft";
import { MAX_REPORT_PHOTO_BYTES } from "../../shared/contracts";
import type { Report } from "../../shared/contracts";

type Draft = {
  location: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
};

type RoutingReadiness = {
  activeCategories?: number;
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

const emptyDraft: Draft = {
  location: "",
  latitude: null,
  longitude: null,
  accuracyMeters: null,
};

export function ReportCreatePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const identity = user?.id ?? "guest";
  const draftKey = `civicsignal.report-draft.${identity}`;
  const activeIdentityRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const photoRequestId = useRef(0);
  const locationRequestId = useRef(0);
  const [form, setForm] = useState<Draft>(emptyDraft);
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const changingIdentity = !authLoading && loadedIdentity !== identity;
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [locationLookupBusy, setLocationLookupBusy] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [formError, setFormError] = useState("");
  const { data: routingReadiness } = useFetch<RoutingReadiness>("/api/routing/readiness");
  const { data: locationLookupInfo } = useFetch<LocationLookupInfo>("/api/location/attribution");
  const { pending, error, fieldErrors, run } = useAction();

  const acceptPhoto = useCallback((file: File | null) => {
    photoRequestId.current += 1;
    setPhoto(file);
    setPhotoNotice("");
    if (file) void saveDraftPhoto(draftKeyRef.current, file);
    else void clearDraftPhoto(draftKeyRef.current);
  }, []);

  function selectPhoto(file: File | null, input: HTMLInputElement): void {
    if (file && file.size > MAX_REPORT_PHOTO_BYTES) {
      input.value = "";
      acceptPhoto(null);
      setPhotoNotice("Choose a photo that is 4 MiB or smaller.");
      return;
    }
    acceptPhoto(file);
  }

  function updateLocationFromDevice() {
    const requestId = ++locationRequestId.current;
    setLocationMessage("");
    setResolvingAddress(false);
    if (!navigator.geolocation) {
      setLocationMessage("This browser cannot share a location. Try another browser or device.");
      return;
    }

    setLocationLookupBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinates = { latitude: coords.latitude, longitude: coords.longitude };
        setForm({
          location: "Precise GPS pin attached",
          ...coordinates,
          accuracyMeters: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
        });
        setLocationMessage(`Precise pin saved (${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}).`);
        setLocationLookupBusy(false);
        setResolvingAddress(true);

        void api.post<{ address: string }>("/api/location/reverse", {
          ...coordinates,
        }).then(({ address }) => {
          if (locationRequestId.current !== requestId) return;
          setForm((current) => ({ ...current, location: address }));
        }).catch((caught: unknown) => {
          if (locationRequestId.current !== requestId) return;
          setLocationMessage(caught instanceof ApiRequestError
            ? `The precise pin is saved. ${caught.message}`
            : "The precise pin is saved. Address lookup is unavailable.");
        }).finally(() => {
          if (locationRequestId.current === requestId) setResolvingAddress(false);
        });
      },
      (caught) => {
        if (locationRequestId.current !== requestId) return;
        setLocationLookupBusy(false);
        setLocationMessage(caught.code === caught.PERMISSION_DENIED
          ? "Location access is blocked. Allow it in your browser or device settings, then try again."
          : caught.code === caught.TIMEOUT
            ? "Your device took too long to find its location. Try again outdoors."
            : "We couldn't read your device location. Check that location services are on.");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  useEffect(() => {
    if (authLoading || activeIdentityRef.current === identity) return;
    activeIdentityRef.current = identity;
    setLoadedIdentity(identity);
    setForm(emptyDraft);
    setPhoto(null);
    setPhotoPreview(null);
    setPhotoNotice("");
    setLocationMessage("");
    setLocationLookupBusy(false);
    setResolvingAddress(false);
    setFormError("");

    const selectionVersion = ++photoRequestId.current;
    void loadDraftPhoto(draftKey).then((file) => {
      if (
        !file ||
        activeIdentityRef.current !== identity ||
        photoRequestId.current !== selectionVersion
      ) return;
      setPhoto(file);
    });
  }, [authLoading, draftKey, identity]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const selectedPhoto = photo;
    const latitude = form.latitude;
    const longitude = form.longitude;
    if (!selectedPhoto) {
      setFormError("Add or take a photo of the issue.");
      return;
    }
    if (latitude === null || longitude === null) {
      setFormError("Use the location button so AI can route the report to the right staff member.");
      return;
    }

    await run(async () => {
      const payload = new FormData();
      payload.set("photo", selectedPhoto);
      payload.set("latitude", String(latitude));
      payload.set("longitude", String(longitude));
      if (form.accuracyMeters !== null) {
        payload.set("accuracyMeters", String(form.accuracyMeters));
      }
      payload.set("location", form.location.trim() || "Precise GPS pin attached");

      const guest = !user;
      const result = await api.postForm<Report & { guestAccessToken?: string }>(
        guest ? "/api/reports/guest" : "/api/reports",
        payload,
      );
      photoRequestId.current += 1;
      void clearDraftPhoto(draftKeyRef.current);
      const organization = result.organization?.name ?? "the responsible organization";
      const flash = `Report ${result.referenceCode} was sent to ${organization}. AI identified “${result.title}”.`;
      if (guest && result.guestAccessToken) {
        navigate(`/track/${result.id}#${result.guestAccessToken}`, {
          state: { flash: `${flash} Save the secure tracking link to return to it.` },
        });
      } else {
        navigate(`/reports/${result.id}`, { state: { flash } });
      }
    });
  }

  const hasPin = form.latitude !== null && form.longitude !== null;
  const mapUrl = hasPin
    ? `https://www.openstreetmap.org/?mlat=${form.latitude}&mlon=${form.longitude}#map=18/${form.latitude}/${form.longitude}`
    : null;
  const aiUnavailable = routingReadiness?.photoClassification?.status === "unavailable";
  const routingUnavailable = routingReadiness?.activeCategories === 0;
  const photoStorageUnavailable = routingReadiness?.photoStorage?.status === "unavailable";
  const canSubmit =
    Boolean(photo) &&
    hasPin &&
    !pending &&
    !aiUnavailable &&
    !routingUnavailable &&
    !photoStorageUnavailable;

  if (authLoading || changingIdentity) {
    return <p className="centered" role="status">Preparing your report…</p>;
  }

  return (
    <section className="card report-composer">
      <div className="page-header">
        <div>
          <p className="eyebrow">Non-emergency community report</p>
          <h1>Report a local issue</h1>
          <p className="muted">
            Add one photo and attach your current location. AI identifies the problem, writes the title and
            description, chooses the responsible organization, and assigns the nearest available staff member.
            You can review everything after sending.
          </p>
        </div>
      </div>

      <aside className="emergency-notice" role="note">
        <strong>Not for emergencies.</strong> This civic app is not monitored for urgent situations. If someone is in immediate danger, call 911.
      </aside>

      {aiUnavailable && (
        <p className="warning" role="status">
          AI issue classification is unavailable right now, so reports cannot be sent. Try again later.
        </p>
      )}
      {routingUnavailable && (
        <div className="warning" role="status">
          Reports are not available yet because no issue categories are configured for active organizations.
          Please try again after an administrator configures routing.
        </div>
      )}
      {photoStorageUnavailable && (
        <p className="warning" role="status">
          Photo storage is temporarily unavailable. Try again later.
        </p>
      )}

      <form onSubmit={submit} className="stack">
        <Field
          label="Photo (required)"
          hint="Maximum 4 MiB. The photo is sent to Gemini for classification when you submit, then shared only with the receiving organization and authorized staff. Avoid sensitive details."
          error={photoNotice || fieldErrors.photo}
        >
          <div className="photo-field-controls">
            <div className="photo-upload-section">
              <label className={`photo-upload-button${photo ? " has-photo" : ""}`}>
                <input
                  className="photo-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  aria-label="Add an issue photo"
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
                  aria-label="Take a photo with camera"
                  onChange={(event) => selectPhoto(event.currentTarget.files?.[0] ?? null, event.currentTarget)}
                />
                <span>Take photo</span>
              </label>
            </div>
            {photo && (
              <div className="photo-selected">
                {photoPreview && <img className="report-photo-preview" src={photoPreview} alt="Selected report photo" />}
                <button className="link-button" type="button" onClick={() => acceptPhoto(null)}>Remove photo</button>
              </div>
            )}
          </div>
        </Field>

        <div className="location-action">
          <strong>Your location</strong>
          <p className="muted">
            Tap the button. The exact GPS pin is attached to the report and used to choose the nearest
            available staff member. No address typing is needed.
          </p>
          <button className="button" type="button" onClick={updateLocationFromDevice} disabled={locationLookupBusy}>
            {locationLookupBusy ? "Finding precise location…" : "Use my current location"}
          </button>
          {locationMessage && <p className="muted" role="status">{locationMessage}</p>}
          {resolvingAddress && <p className="muted" role="status">Looking up a nearby address. You can send while this finishes.</p>}
          {hasPin && (
            <div className="gps-pin-summary">
              <span>GPS pin: {form.latitude!.toFixed(6)}, {form.longitude!.toFixed(6)}</span>
              {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">Preview on map</a>}
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  locationRequestId.current += 1;
                  setForm(emptyDraft);
                  setLocationMessage("Location removed. Tap the button again before sending.");
                  setResolvingAddress(false);
                }}
              >
                Remove pin
              </button>
            </div>
          )}
          <p className="muted location-attribution">
            The exact pin is shared with the organization and authorized staff that receive this report.
            Only the optional nearby-address lookup sends coordinates to {locationLookupInfo?.providerName ?? "the address lookup service"}. {locationLookupInfo?.usageNote}
            {locationLookupInfo?.attribution && locationLookupInfo.attributionUrl && <> <a href={locationLookupInfo.attributionUrl} target="_blank" rel="noreferrer">{locationLookupInfo.attribution}</a>.</>}
            {locationLookupInfo?.policyUrl && <> <a href={locationLookupInfo.policyUrl} target="_blank" rel="noreferrer">Lookup service policy</a>.</>}
          </p>
        </div>

        {(formError || error) && <p className="error" role="alert">{formError || error}</p>}
        <div className="button-row">
          <button className="button primary" type="submit" disabled={!canSubmit}>
            {pending ? "Sending report…" : "Send report"}
          </button>
          <Link className="button" to="/">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
