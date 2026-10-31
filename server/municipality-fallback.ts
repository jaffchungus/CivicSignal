import type { CivicDatabase } from "./database.js";

export type Coordinates = { latitude: number; longitude: number };

/**
 * Finds the nearest active staff member from any municipality when the
 * selected municipality has no available staff.
 *
 * Uses Haversine formula to calculate distance between coordinates.
 */
export async function findNearestStaff(
  database: CivicDatabase,
  coordinates: Coordinates | null,
  excludeMunicipalityId: string | null,
): Promise<{ id: string; displayName: string; role: string; organizationId: string; organizationName: string; distanceKm: number } | null> {
  if (!coordinates) {
    // If no coordinates, fall back to any active staff from a different municipality
    const fallbackStaff = (await database
      .prepare(
        `SELECT users.id, users.display_name, users.role, users.organization_id,
                organizations.name AS organization_name
         FROM users
         JOIN organizations ON organizations.id = users.organization_id
         WHERE users.status = 'ACTIVE'
           AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
           AND organizations.active = 1
         ORDER BY users.created_at ASC
         LIMIT 1`,
      )
      .get()) as
      | {
          id: string;
          display_name: string;
          role: string;
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
      distanceKm: 0,
    };
  }

  // Get all active staff with their organization locations
  const staffWithLocations = (await database
    .prepare(
      `SELECT users.id, users.display_name, users.role, users.organization_id,
              organizations.name AS organization_name,
              municipalities.center_latitude, municipalities.center_longitude
       FROM users
       JOIN organizations ON organizations.id = users.organization_id
       LEFT JOIN municipalities ON municipalities.id = organizations.municipality_id
       WHERE users.status = 'ACTIVE'
         AND users.role IN ('OFFICIAL', 'LAW_ENFORCEMENT')
         AND organizations.active = 1
         AND (municipalities.id IS NULL OR municipalities.id != ? OR municipalities.active = 1)`,
    )
    .all(excludeMunicipalityId ?? "")) as Array<{
    id: string;
    display_name: string;
    role: string;
    organization_id: string;
    organization_name: string;
    center_latitude: number | null;
    center_longitude: number | null;
  }>;

  // Calculate distances and find the nearest
  let nearest: {
    id: string;
    displayName: string;
    role: string;
    organizationId: string;
    organizationName: string;
    distanceKm: number;
  } | null = null;

  for (const staff of staffWithLocations) {
    const staffLat = staff.center_latitude;
    const staffLon = staff.center_longitude;

    if (staffLat === null || staffLon === null) {
      // Staff without a location - consider as fallback with infinite distance
      if (!nearest) {
        nearest = {
          id: staff.id,
          displayName: staff.display_name,
          role: staff.role,
          organizationId: staff.organization_id,
          organizationName: staff.organization_name,
          distanceKm: Infinity,
        };
      }
      continue;
    }

    const distanceKm = haversineDistance(
      coordinates.latitude,
      coordinates.longitude,
      staffLat,
      staffLon,
    );

    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = {
        id: staff.id,
        displayName: staff.display_name,
        role: staff.role,
        organizationId: staff.organization_id,
        organizationName: staff.organization_name,
        distanceKm,
      };
    }
  }

  return nearest;
}

/**
 * Haversine formula to calculate the great-circle distance between two points
 * on a sphere given their longitudes and latitudes.
 */
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
