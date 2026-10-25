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

<<<<<<< HEAD
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
  }> = [];

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
=======
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
>>>>>>> parent of 082a67f (Updates..)

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

