import type { CivicDatabase } from "./database.js";
import { ApiError } from "./http.js";
import { haversineDistanceMeters } from "./image-similarity.js";

export type Coordinates = { latitude: number; longitude: number };

export type JurisdictionResolution =
  | { status: "matched"; serviceAreaId: string; municipalityName: string; confidence: number; reason: string }
  | { status: "ambiguous"; candidates: Array<{ serviceAreaId: string; municipalityName: string }>; reason: string }
  | { status: "unmapped"; reason: string }
  | { status: "unavailable"; reason: string };

export interface JurisdictionAdapter {
  readonly providerName: string;
  resolve(point: Coordinates): Promise<JurisdictionResolution>;
}

export const jurisdictionUnavailableReason =
  "No geocoding and boundary provider or administrator-configured service areas are available.";

export function jurisdictionProviderStatus(adapter?: JurisdictionAdapter) {
  return adapter
    ? { status: "configured" as const, provider: adapter.providerName }
    : { status: "unavailable" as const, provider: null, reason: jurisdictionUnavailableReason };
}

export function extractCoordinates(location: string): Coordinates | null {
  const match = location.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!match) return null;
  const latitude = parseFloat(match[1]);
  const longitude = parseFloat(match[2]);
  if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

export type CategoryRoutingResult = {
  categoryId: string;
  organizationId: string;
  organizationName: string;
  municipalityId: string | null;
  municipalityName: string | null;
  routingMethod: "category_default";
};

/**
 * Routes a report only to the administrator-configured organization for the
 * selected active category.
 *
 * CivicSignal has no geocoding, parcel, or municipal-boundary provider. The
 * previous municipality and nearest-organization guesses could send a report
 * outside the responsible organization, so they are intentionally gone.
 * AI selects the active category from the photo; assigned staff can transfer a
 * report to another configured department.
 */
export async function routeReportToOrganization(
  database: CivicDatabase,
  categoryId: string,
  _municipalityId: string | null,
  _coordinates: Coordinates | null,
): Promise<CategoryRoutingResult> {
  const category = (await database
    .prepare(
      `SELECT categories.id, categories.organization_id,
              organizations.name AS organization_name,
              municipalities.id AS municipality_id,
              municipalities.name AS municipality_name
       FROM categories
       JOIN organizations ON organizations.id = categories.organization_id
       LEFT JOIN municipalities ON municipalities.id = organizations.municipality_id
       WHERE categories.id = ?
         AND categories.active = 1
         AND organizations.active = 1
         AND (organizations.municipality_id IS NULL OR municipalities.active = 1)`,
    )
    .get(categoryId)) as
    | {
        id: string;
        organization_id: string;
        organization_name: string;
        municipality_id: string | null;
        municipality_name: string | null;
      }
    | undefined;

  if (!category) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "The request contains invalid fields.",
      { categoryId: ["Choose a category routed to an active organization."] },
    );
  }

  return {
    categoryId: category.id,
    organizationId: category.organization_id,
    organizationName: category.organization_name,
    municipalityId: category.municipality_id,
    municipalityName: category.municipality_name,
    routingMethod: "category_default",
  };
}

export type MunicipalityMatch = {
  id: string;
  name: string;
  distanceMeters: number;
};

/**
 * Resolves the report's municipality from the GPS pin. Administrator-configured
 * municipality centers are authoritative here; the nearest active center wins.
 * No boundary or geocoder provider is invented when none is configured.
 */
export async function findNearestMunicipality(
  database: CivicDatabase,
  coordinates: Coordinates,
): Promise<MunicipalityMatch | null> {
  const municipalities = (await database
    .prepare(
      `SELECT id, name, center_latitude, center_longitude
       FROM municipalities
       WHERE active = 1
         AND center_latitude IS NOT NULL
         AND center_longitude IS NOT NULL`,
    )
    .all()) as Array<{
    id: string;
    name: string;
    center_latitude: number;
    center_longitude: number;
  }>;

  let nearest: MunicipalityMatch | null = null;
  for (const municipality of municipalities) {
    const distanceMeters = haversineDistanceMeters(
      coordinates.latitude,
      coordinates.longitude,
      municipality.center_latitude,
      municipality.center_longitude,
    );
    if (
      !nearest ||
      distanceMeters < nearest.distanceMeters ||
      (distanceMeters === nearest.distanceMeters &&
        (municipality.name < nearest.name ||
          (municipality.name === nearest.name && municipality.id < nearest.id)))
    ) {
      nearest = { id: municipality.id, name: municipality.name, distanceMeters };
    }
  }
  return nearest;
}

export type AssigneeCandidate = {
  id: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  municipalityId: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: number;
};

/**
 * Chooses one person from the eligible candidate pool. Staff in the report's
 * municipality win; when that municipality has no available staff, the closest
 * eligible person anywhere is chosen. A stable created-at/id order breaks ties
 * and covers deployments without coordinates.
 */
export function chooseNearestAssignee(
  candidates: AssigneeCandidate[],
  reportMunicipalityId: string | null,
  coordinates: Coordinates | null,
): AssigneeCandidate | null {
  if (candidates.length === 0) return null;
  const inMunicipality = reportMunicipalityId
    ? candidates.filter((candidate) => candidate.municipalityId === reportMunicipalityId)
    : [];
  const pool = inMunicipality.length > 0 ? inMunicipality : candidates;

  if (coordinates) {
    let nearest: { candidate: AssigneeCandidate; distanceMeters: number } | null = null;
    for (const candidate of pool) {
      if (candidate.latitude === null || candidate.longitude === null) continue;
      const distanceMeters = haversineDistanceMeters(
        coordinates.latitude,
        coordinates.longitude,
        candidate.latitude,
        candidate.longitude,
      );
      if (
        !nearest ||
        distanceMeters < nearest.distanceMeters ||
        (distanceMeters === nearest.distanceMeters &&
          (candidate.createdAt < nearest.candidate.createdAt ||
            (candidate.createdAt === nearest.candidate.createdAt && candidate.id < nearest.candidate.id)))
      ) {
        nearest = { candidate, distanceMeters };
      }
    }
    if (nearest) return nearest.candidate;
  }

  return [...pool].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  )[0] ?? null;
}

/**
 * Finds the nearest eligible person among all organizations when the report's
 * municipality is known, so the same-municipality preference can cross
 * department boundaries. When no municipality is resolvable, it keeps the
 * fallback inside the routed organization rather than assigning at random.
 */
export async function assignNearestStaff(
  database: CivicDatabase,
  input: {
    coordinates: Coordinates;
    reportMunicipalityId: string | null;
    fallbackOrganizationId: string;
  },
): Promise<AssigneeCandidate | null> {
  const rows = (await database
    .prepare(
      `SELECT users.id, users.display_name, users.created_at,
              users.organization_id,
              organizations.name AS organization_name,
              organizations.municipality_id AS municipality_id,
              municipalities.center_latitude, municipalities.center_longitude
       FROM users
       JOIN organizations ON organizations.id = users.organization_id
       LEFT JOIN municipalities ON municipalities.id = organizations.municipality_id
         AND municipalities.active = 1
       WHERE users.status = 'ACTIVE'
         AND users.verified_at IS NOT NULL
         AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
         AND (? IS NOT NULL OR users.organization_id = ?)`,
    )
    .all(input.reportMunicipalityId, input.fallbackOrganizationId)) as Array<{
    id: string;
    display_name: string;
    created_at: number;
    organization_id: string;
    organization_name: string;
    municipality_id: string | null;
    center_latitude: number | null;
    center_longitude: number | null;
  }>;

  return chooseNearestAssignee(
    rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      municipalityId: row.municipality_id,
      latitude: row.center_latitude,
      longitude: row.center_longitude,
      createdAt: row.created_at,
    })),
    input.reportMunicipalityId,
    input.coordinates,
  );
}
