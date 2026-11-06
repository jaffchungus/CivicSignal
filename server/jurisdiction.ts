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

export type MunicipalRepresentativeInfo = {
  id: string;
  displayName: string;
  role: "OFFICIAL" | "LAW_ENFORCEMENT";
  organizationId: string;
  organizationName: string;
  municipalityName: string;
};

export type CategoryRoutingResult = {
  categoryId: string;
  organizationId: string;
  organizationName: string;
  municipalityId: string | null;
  municipalityName: string | null;
  routingMethod: "municipality_match" | "nearest_organization" | "category_default";
};

/**
 * Deterministically resolves the nearest municipal representative for a given
 * organization and location using code (no AI).
 */
export async function resolveMunicipalityRepresentative(
  database: CivicDatabase,
  organizationId: string,
  _location?: string,
): Promise<MunicipalRepresentativeInfo | null> {
  const municipalityRow = (await database
    .prepare("SELECT value FROM settings WHERE key = 'municipality_name'")
    .get()) as { value: string } | undefined;
  const municipalityName = municipalityRow?.value || "Municipality";

  // Find active, verified staff members in the responsible organization deterministically
  const staff = (await database
    .prepare(
      `SELECT users.id, users.display_name, users.role, users.organization_id,
              organizations.name AS organization_name
       FROM users
       JOIN organizations ON organizations.id = users.organization_id
       WHERE users.organization_id = ?
         AND users.status = 'ACTIVE'
         AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
       ORDER BY users.created_at ASC`,
    )
    .all(organizationId)) as Array<{
      id: string;
      display_name: string;
      role: "OFFICIAL" | "LAW_ENFORCEMENT";
      organization_id: string;
      organization_name: string;
    }>;

  if (staff.length === 0) {
    // If no verified staff member is assigned yet, check if any active staff exists in municipality
    const fallbackStaff = (await database
      .prepare(
        `SELECT users.id, users.display_name, users.role, users.organization_id,
                organizations.name AS organization_name
         FROM users
         JOIN organizations ON organizations.id = users.organization_id
         WHERE users.status = 'ACTIVE'
           AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
         ORDER BY users.created_at ASC
         LIMIT 1`,
      )
      .get()) as
      | {
          id: string;
          display_name: string;
          role: "OFFICIAL" | "LAW_ENFORCEMENT";
          organization_id: string;
          organization_name: string;
        }
      | undefined;

    if (!fallbackStaff) return null;
    return {
      id: fallbackStaff.id,
      displayName: fallbackStaff.display_name,
      role: fallbackStaff.role,
      organizationId: fallbackStaff.organization_id,
      organizationName: fallbackStaff.organization_name,
      municipalityName,
    };
  }

  const primary = staff[0];
  return {
    id: primary.id,
    displayName: primary.display_name,
    role: primary.role,
    organizationId: primary.organization_id,
    organizationName: primary.organization_name,
    municipalityName,
  };
}

/**
 * Routes a report to the best organization based on municipality and location.
 *
 * Priority order:
 * 1. If a municipality is selected, find an active category in that municipality's organizations
 * 2. If no municipality match, find the nearest organization with an active category for the issue type
 * 3. Fall back to the category's default organization
 */
export async function routeReportToOrganization(
  database: CivicDatabase,
  categoryId: string,
  municipalityId: string | null,
  coordinates: Coordinates | null,
): Promise<CategoryRoutingResult> {
  // Step 1: Try to find a category in the selected municipality
  if (municipalityId) {
    const municipalityCategory = (await database
      .prepare(
        `SELECT categories.id, categories.organization_id, organizations.name AS organization_name,
                municipalities.id AS municipality_id, municipalities.name AS municipality_name
         FROM categories
         JOIN organizations ON organizations.id = categories.organization_id
         LEFT JOIN municipalities ON municipalities.id = organizations.municipality_id
         WHERE categories.name = (
           SELECT name FROM categories WHERE id = ?
         )
         AND organizations.municipality_id = ?
         AND categories.active = 1
         AND organizations.active = 1
         AND municipalities.active = 1
         LIMIT 1`,
      )
      .get(categoryId, municipalityId)) as
      | {
          id: string;
          organization_id: string;
          organization_name: string;
          municipality_id: string;
          municipality_name: string;
        }
      | undefined;

    if (municipalityCategory) {
      return {
        categoryId: municipalityCategory.id,
        organizationId: municipalityCategory.organization_id,
        organizationName: municipalityCategory.organization_name,
        municipalityId: municipalityCategory.municipality_id,
        municipalityName: municipalityCategory.municipality_name,
        routingMethod: "municipality_match",
      };
    }
  }

  // Step 2: If no municipality match and we have coordinates, find the nearest organization
  // with an active category for this issue type
  if (coordinates) {
    const categoryRow = (await database
      .prepare("SELECT name FROM categories WHERE id = ?")
      .get(categoryId)) as { name: string } | undefined;

    if (categoryRow) {
      const nearbyOrganizations = (await database
        .prepare(
          `SELECT categories.id, categories.organization_id, organizations.name AS organization_name,
                  municipalities.id AS municipality_id, municipalities.name AS municipality_name,
                  municipalities.center_latitude, municipalities.center_longitude
           FROM categories
           JOIN organizations ON organizations.id = categories.organization_id
           LEFT JOIN municipalities ON municipalities.id = organizations.municipality_id
           WHERE categories.name = ?
           AND categories.active = 1
           AND organizations.active = 1
           AND (municipalities.active = 1 OR municipalities.id IS NULL)`,
        )
        .all(categoryRow.name)) as Array<{
        id: string;
        organization_id: string;
        organization_name: string;
        municipality_id: string | null;
        municipality_name: string | null;
        center_latitude: number | null;
        center_longitude: number | null;
      }>;

      let nearest: {
        id: string;
        organization_id: string;
        organization_name: string;
        municipality_id: string | null;
        municipality_name: string | null;
        distanceKm: number;
      } | null = null;

      for (const org of nearbyOrganizations) {
        const orgLat = org.center_latitude;
        const orgLon = org.center_longitude;

        if (orgLat === null || orgLon === null) {
          // Organization without location - treat as infinite distance
          if (!nearest) {
            nearest = {
              id: org.id,
              organization_id: org.organization_id,
              organization_name: org.organization_name,
              municipality_id: org.municipality_id,
              municipality_name: org.municipality_name,
              distanceKm: Infinity,
            };
          }
          continue;
        }

        const distanceKm = haversineDistance(
          coordinates.latitude,
          coordinates.longitude,
          orgLat,
          orgLon,
        );

        if (!nearest || distanceKm < nearest.distanceKm) {
          nearest = {
            id: org.id,
            organization_id: org.organization_id,
            organization_name: org.organization_name,
            municipality_id: org.municipality_id,
            municipality_name: org.municipality_name,
            distanceKm,
          };
        }
      }

      if (nearest && nearest.distanceKm < Infinity) {
        return {
          categoryId: nearest.id,
          organizationId: nearest.organization_id,
          organizationName: nearest.organization_name,
          municipalityId: nearest.municipality_id,
          municipalityName: nearest.municipality_name,
          routingMethod: "nearest_organization",
        };
      }
    }
  }

  // Step 3: Fall back to the category's default organization
  const defaultCategory = (await database
    .prepare(
      `SELECT categories.id, categories.organization_id, organizations.name AS organization_name,
              municipalities.id AS municipality_id, municipalities.name AS municipality_name
       FROM categories
       JOIN organizations ON organizations.id = categories.organization_id
       LEFT JOIN municipalities ON municipalities.id = organizations.municipality_id
       WHERE categories.id = ?
       AND categories.active = 1
       AND organizations.active = 1`,
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

  if (!defaultCategory) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "The request contains invalid fields.",
      { categoryId: ["Choose a category routed to an active organization."] },
    );
  }

  return {
    categoryId: defaultCategory.id,
    organizationId: defaultCategory.organization_id,
    organizationName: defaultCategory.organization_name,
    municipalityId: defaultCategory.municipality_id,
    municipalityName: defaultCategory.municipality_name,
    routingMethod: "category_default",
  };
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
