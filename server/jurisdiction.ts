import type { CivicDatabase } from "./database.js";

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
  distanceMeters?: number;
};

/**
 * Deterministically resolves the nearest municipal representative for a given
 * organization and location using code (no AI).
 * If municipalityId is provided, searches within that municipality first.
 * Falls back to nearest officer if no staff available in target municipality.
 */
export async function resolveMunicipalityRepresentative(
  database: CivicDatabase,
  organizationId: string,
  location?: string,
  municipalityId?: string,
): Promise<MunicipalRepresentativeInfo | null> {
  const municipalityRow = (await database
    .prepare("SELECT value FROM settings WHERE key = 'municipality_name'")
    .get()) as { value: string } | undefined;
  const defaultMunicipalityName = municipalityRow?.value || "Municipality";

  let targetMunicipalityName = defaultMunicipalityName;

  // If municipality ID is provided, get its name
  if (municipalityId) {
    const mun = (await database
      .prepare("SELECT name FROM municipalities WHERE id = ?")
      .get(municipalityId)) as { name: string } | undefined;
    if (mun) {
      targetMunicipalityName = mun.name;
    }
  }

  // Parse coordinates from location if available
  const coords = location ? extractCoordinates(location) : null;

  // Find active, verified staff members in the responsible organization
  let staff: Array<{
    id: string;
    display_name: string;
    role: "OFFICIAL" | "LAW_ENFORCEMENT";
    organization_id: string;
    organization_name: string;
    municipality_id: string | null;
  }>;

  if (municipalityId) {
    // First try to find staff in the specified municipality
    staff = (await database
      .prepare(
        `SELECT users.id, users.display_name, users.role, users.organization_id,
                organizations.name AS organization_name, users.municipality_id
         FROM users
         JOIN organizations ON organizations.id = users.organization_id
         WHERE users.organization_id = ?
           AND users.status = 'ACTIVE'
           AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
           AND users.municipality_id = ?
         ORDER BY users.created_at ASC`,
      )
      .all(organizationId, municipalityId)) as typeof staff;
  }

  // If no staff in target municipality, try organization-wide
  if (!staff || staff.length === 0) {
    staff = (await database
      .prepare(
        `SELECT users.id, users.display_name, users.role, users.organization_id,
                organizations.name AS organization_name, users.municipality_id
         FROM users
         JOIN organizations ON organizations.id = users.organization_id
         WHERE users.organization_id = ?
           AND users.status = 'ACTIVE'
           AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
         ORDER BY users.created_at ASC`,
      )
      .all(organizationId)) as typeof staff;
  }

  if (staff.length === 0) {
    // Fallback: find nearest active staff across all organizations in the same municipality
    if (municipalityId && coords) {
      const nearestStaff = (await database
        .prepare(
          `SELECT users.id, users.display_name, users.role, users.organization_id,
                  organizations.name AS organization_name, users.municipality_id
           FROM users
           JOIN organizations ON organizations.id = users.organization_id
           WHERE users.status = 'ACTIVE'
             AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
             AND users.municipality_id = ?
           ORDER BY users.created_at ASC
           LIMIT 1`,
        )
        .get(municipalityId)) as typeof staff[0] | undefined;

      if (nearestStaff) {
        return {
          id: nearestStaff.id,
          displayName: nearestStaff.display_name,
          role: nearestStaff.role,
          organizationId: nearestStaff.organization_id,
          organizationName: nearestStaff.organization_name,
          municipalityName: targetMunicipalityName,
        };
      }
    }

    // Final fallback: any active staff in the system
    const fallbackStaff = (await database
      .prepare(
        `SELECT users.id, users.display_name, users.role, users.organization_id,
                organizations.name AS organization_name, users.municipality_id
         FROM users
         JOIN organizations ON organizations.id = users.organization_id
         WHERE users.status = 'ACTIVE'
           AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
         ORDER BY users.created_at ASC
         LIMIT 1`,
      )
      .get()) as typeof staff[0] | undefined;

    if (!fallbackStaff) return null;
    return {
      id: fallbackStaff.id,
      displayName: fallbackStaff.display_name,
      role: fallbackStaff.role,
      organizationId: fallbackStaff.organization_id,
      organizationName: fallbackStaff.organization_name,
      municipalityName: targetMunicipalityName,
    };
  }

  const primary = staff[0];
  return {
    id: primary.id,
    displayName: primary.display_name,
    role: primary.role,
    organizationId: primary.organization_id,
    organizationName: primary.organization_name,
    municipalityName: targetMunicipalityName,
  };
}

