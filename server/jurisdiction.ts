import type { CivicDatabase } from "./database.js";
import { ApiError } from "./http.js";

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
 * Residents and staff can still choose a different configured category, and
 * assigned staff can transfer a report to another configured department.
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
