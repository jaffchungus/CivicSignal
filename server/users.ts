// User data: rows, lookup, and serialization. The single owner of the user
// projection — every API response that exposes a user goes through here.
import type { PublicUser, UserRole } from "../shared/contracts";
import type { CivicDatabase } from "./database";
import { isoTime } from "./http";

export type UserRow = {
  id: string;
  display_name: string;
  email: string;
  role: UserRole;
  status: PublicUser["status"];
  organization_id: string | null;
  organization_name: string | null;
  created_at: number;
};

export const USER_SELECT = `SELECT users.id, users.display_name, users.email, users.role, users.status,
              users.organization_id, organizations.name AS organization_name, users.created_at
       FROM users
       LEFT JOIN organizations ON organizations.id = users.organization_id`;

export function serializeUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  };
}

export function serializeAdminUser(row: UserRow): PublicUser & { createdAt: string } {
  return { ...serializeUser(row), createdAt: isoTime(row.created_at) };
}

export async function findUser(
  database: CivicDatabase,
  id: string,
): Promise<PublicUser | null> {
  const row = (await database
    .prepare(`${USER_SELECT} WHERE users.id = ?`)
    .get(id)) as UserRow | undefined;
  return row ? serializeUser(row) : null;
}
