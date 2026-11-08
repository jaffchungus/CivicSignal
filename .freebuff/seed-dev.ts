import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { createSqliteDatabase } from "../server/database-sqlite.js";

const database = await createSqliteDatabase(process.env.DATABASE_PATH ?? "./data/civicsignal.db");
const existing = (await database.prepare("SELECT COUNT(*) AS count FROM users").get()) as {
  count: number;
};
if (existing.count > 0) {
  console.log("Database already has users; leaving it unchanged.");
  await database.close();
  process.exit(0);
}

const now = Date.now();
const passwordHash = await bcrypt.hash("CivicSignalDemo!", 12);
const ids = {
  northside: randomUUID(),
  southside: randomUUID(),
  hillside: randomUUID(),
  publicWorks: randomUUID(),
  parks: randomUUID(),
  police: randomUUID(),
  admin: randomUUID(),
  avery: randomUUID(),
  blair: randomUUID(),
  casey: randomUUID(),
  resident: randomUUID(),
  roads: randomUUID(),
  streetlights: randomUUID(),
  parkIssues: randomUUID(),
  safety: randomUUID(),
};

await database.transaction(async () => {
  for (const [id, name, latitude, longitude] of [
    [ids.northside, "Northside", 39.7817, -89.6501],
    [ids.southside, "Southside", 39.62, -89.47],
    [ids.hillside, "Hillside", 39.6, -89.45],
  ] as const) {
    await database
      .prepare(
        `INSERT INTO municipalities
          (id, name, boundary_geojson, center_latitude, center_longitude, active, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 1, ?, ?)`,
      )
      .run(id, name, latitude, longitude, now, now);
  }

  for (const [id, name, kind, municipalityId] of [
    [ids.publicWorks, "Northside Public Works", "PUBLIC_SERVICE", ids.northside],
    [ids.parks, "Southside Parks", "PUBLIC_SERVICE", ids.southside],
    [ids.police, "Northside Police", "LAW_ENFORCEMENT", ids.northside],
  ] as const) {
    await database
      .prepare(
        `INSERT INTO organizations
          (id, name, kind, municipality_id, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, name, kind, municipalityId, now, now);
  }

  const insertUser = async (
    id: string,
    displayName: string,
    email: string,
    role: string,
    organizationId: string | null,
    verified: boolean,
    order: number,
  ) => {
    await database
      .prepare(
        `INSERT INTO users
          (id, display_name, email, normalized_email, password_hash, role, status,
           organization_id, verified_at, verified_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        displayName,
        email,
        email.toLowerCase(),
        passwordHash,
        role,
        organizationId,
        verified ? now : null,
        verified ? ids.admin : null,
        now + order,
        now + order,
      );
  };

  await insertUser(
    ids.admin,
    "Demo Administrator",
    "admin@example.test",
    "ADMIN",
    null,
    true,
    0,
  );
  await insertUser(
    ids.avery,
    "Avery Northside",
    "avery@example.test",
    "OFFICIAL",
    ids.publicWorks,
    true,
    1,
  );
  await insertUser(
    ids.blair,
    "Blair Southside",
    "blair@example.test",
    "OFFICIAL",
    ids.parks,
    true,
    2,
  );
  await insertUser(
    ids.casey,
    "Casey Police",
    "casey@example.test",
    "LAW_ENFORCEMENT",
    ids.police,
    true,
    3,
  );
  await insertUser(
    ids.resident,
    "Riley Resident",
    "resident@example.test",
    "RESIDENT",
    null,
    false,
    4,
  );

  for (const [id, name, description, organizationId] of [
    [ids.roads, "Roads and Sidewalks", "Potholes, damaged sidewalks, and road hazards", ids.publicWorks],
    [ids.streetlights, "Streetlights", "Broken or malfunctioning streetlights", ids.publicWorks],
    [ids.parkIssues, "Parks and Recreation", "Maintenance issues in parks", ids.parks],
    [ids.safety, "Non-Emergency Public Safety", "Non-emergency safety concerns", ids.police],
  ] as const) {
    await database
      .prepare(
        `INSERT INTO categories
          (id, name, description, organization_id, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, name, description, organizationId, now, now);
  }

  await database
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('municipality_name', 'Northside')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run();
});

console.log("Seeded CivicSignal demo data.");
console.log("Admin: admin@example.test / CivicSignalDemo!");
console.log("Resident: resident@example.test / CivicSignalDemo!");
console.log("Northside Public Works: avery@example.test / CivicSignalDemo!");
console.log("Southside Parks: blair@example.test / CivicSignalDemo!");
console.log("Northside Police: casey@example.test / CivicSignalDemo!");
console.log(`Public Works organization: ${ids.publicWorks}`);
console.log(`Parks organization: ${ids.parks}`);
console.log(`Roads category: ${ids.roads}`);
await database.close();
