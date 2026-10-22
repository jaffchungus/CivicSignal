// Routing catalog reads: organizations (for account requests) and categories
// (for report creation).
import { Router } from "express";

import type { OrganizationKind } from "../../shared/contracts.js";
import type { CivicDatabase } from "../database.js";
import { jurisdictionProviderStatus } from "../jurisdiction.js";

export function createCatalogRouter(deps: { database: CivicDatabase }): Router {
  const { database } = deps;
  const router = Router();

  router.get("/organizations", async (_request, response) => {
    const organizations = (await database
      .prepare("SELECT id, name, kind FROM organizations WHERE active = 1 ORDER BY name")
      .all()) as Array<{ id: string; name: string; kind: OrganizationKind }>;
    response.json({ organizations });
  });

  router.get("/categories", async (_request, response) => {
    const categories = await database
      .prepare(
        `SELECT categories.id, categories.name, categories.description,
                categories.organization_id AS "organizationId",
                organizations.name AS "organizationName"
         FROM categories
         JOIN organizations ON organizations.id = categories.organization_id
         WHERE categories.active = 1 AND organizations.active = 1
         ORDER BY categories.name`,
      )
      .all();
    response.json({ categories });
  });

  router.get("/routing/readiness", async (_request, response) => {
    const { count: activeCategories } = (await database
      .prepare(`SELECT COUNT(*) AS count FROM categories
                JOIN organizations ON organizations.id = categories.organization_id
                WHERE categories.active = 1 AND organizations.active = 1`)
      .get()) as { count: number };
    response.json({
      activeCategories,
      categoryRouting: activeCategories > 0 ? "configured" : "unavailable",
      jurisdiction: jurisdictionProviderStatus(),
      photoClassification: { status: "unavailable", reason: "No image-classification provider is configured." },
      duplicateDetection: { status: "unavailable", reason: "No location-aware duplicate matching is configured." },
      externalNotifications: { status: "unavailable", reason: "No verified email or text provider is configured." },
      reviewWindow: { status: "unavailable", reason: "No organization review estimate is configured." },
    });
  });

  return router;
}
