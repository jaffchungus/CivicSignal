// Routing catalog reads: organizations (for account requests) and categories
// (for report creation).
import { Router } from "express";

import type { OrganizationKind } from "../../shared/contracts";
import type { CivicDatabase } from "../database";
import { authenticate } from "../session";

export function createCatalogRouter(deps: { database: CivicDatabase }): Router {
  const { database } = deps;
  const router = Router();

  router.get("/organizations", async (_request, response) => {
    const organizations = (await database
      .prepare("SELECT id, name, kind FROM organizations WHERE active = 1 ORDER BY name")
      .all()) as Array<{ id: string; name: string; kind: OrganizationKind }>;
    response.json({ organizations });
  });

  router.get("/categories", authenticate(database), async (_request, response) => {
    const categories = await database
      .prepare(
        `SELECT categories.id, categories.name, categories.description,
                categories.organization_id AS organizationId,
                organizations.name AS organizationName
         FROM categories
         JOIN organizations ON organizations.id = categories.organization_id
         WHERE categories.active = 1
         ORDER BY categories.name`,
      )
      .all();
    response.json({ categories });
  });

  return router;
}
