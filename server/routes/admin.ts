import { randomUUID } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import {
  ACCOUNT_STATUSES,
  ORGANIZATION_KINDS,
  USER_ROLES,
  type OrganizationKind,
  type UserRole,
} from "../../shared/contracts.js";
import type { CivicDatabase } from "../database.js";
import { recordAudit } from "../activity.js";
import { ApiError, isoTime } from "../http.js";
import { authenticate, currentUser, requireRole } from "../session.js";
import { findUser, serializeAdminUser, USER_SELECT, type UserRow } from "../users.js";

const verifySchema = z.object({
  role: z.enum(USER_ROLES),
  organizationId: z.string().trim().min(1).nullish(),
});

const accountStatusSchema = z.object({
  status: z.enum(ACCOUNT_STATUSES).refine((value) => value !== "PENDING", {
    message: "Accounts are only activated or suspended by administrators.",
  }),
});

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(ORGANIZATION_KINDS),
});

const activeSchema = z.object({ active: z.boolean() });

const categorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().default(""),
  organizationId: z.string().trim().min(1),
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const EXPECTED_ORGANIZATION_KIND: Partial<Record<UserRole, OrganizationKind>> = {
  OFFICIAL: "PUBLIC_SERVICE",
  LAW_ENFORCEMENT: "LAW_ENFORCEMENT",
};

export function createAdminRouter(deps: { database: CivicDatabase }): Router {
  const { database } = deps;
  const router = Router();

  router.use(authenticate(database), requireRole("ADMIN"));

  router.get("/overview", async (_request, response) => {
    const count = async (sql: string): Promise<number> =>
      ((await database.prepare(sql).get()) as { count: number }).count;
    response.json({
      users: await count("SELECT COUNT(*) AS count FROM users"),
      organizations: await count("SELECT COUNT(*) AS count FROM organizations"),
      categories: await count("SELECT COUNT(*) AS count FROM categories"),
      pendingVerifications: await count(
        "SELECT COUNT(*) AS count FROM users WHERE status = 'PENDING'",
      ),
      moderationQueue: await count(
        "SELECT COUNT(*) AS count FROM reports WHERE moderation_status != 'VISIBLE'",
      ),
      openReports: await count(
        `SELECT COUNT(*) AS count FROM reports
         WHERE status NOT IN ('RESOLVED', 'CLOSED') AND moderation_status = 'VISIBLE'`,
      ),
    });
  });

  router.get("/users", async (request, response) => {
    const query = z
      .object({ q: z.string().trim().max(200).optional() })
      .parse(request.query);
    const filters: string[] = [];
    const parameters: unknown[] = [];
    if (query.q) {
      filters.push(
        "(LOWER(users.display_name) LIKE ? OR LOWER(users.email) LIKE ?)",
      );
      const pattern = `%${query.q.toLowerCase()}%`;
      parameters.push(pattern, pattern);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const rows = (await database
      .prepare(
        `${USER_SELECT}
         ${where}
         ORDER BY CASE users.status WHEN 'PENDING' THEN 0 ELSE 1 END, users.created_at DESC`,
      )
      .all(...parameters)) as UserRow[];

    response.json({ users: rows.map(serializeAdminUser) });
  });

  router.post("/users/:userId/verify", async (request, response) => {
    const admin = currentUser(request);
    const input = verifySchema.parse(request.body);
    const target = (await database
      .prepare("SELECT id, status FROM users WHERE id = ?")
      .get(request.params.userId)) as { id: string; status: string } | undefined;
    if (!target) {
      throw new ApiError(404, "USER_NOT_FOUND", "This user does not exist.");
    }

    const expectedKind = EXPECTED_ORGANIZATION_KIND[input.role];
    let organizationId: string | null = null;
    if (expectedKind) {
      if (!input.organizationId) {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "The request contains invalid fields.",
          { organizationId: ["Select the organization this account serves."] },
        );
      }
      const organization = (await database
        .prepare("SELECT id, kind FROM organizations WHERE id = ? AND active = 1")
        .get(input.organizationId)) as
        | { id: string; kind: OrganizationKind }
        | undefined;
      if (!organization || organization.kind !== expectedKind) {
        throw new ApiError(
          422,
          "VALIDATION_ERROR",
          "The request contains invalid fields.",
          {
            organizationId: [
              expectedKind === "LAW_ENFORCEMENT"
                ? "Law-enforcement accounts must belong to a law-enforcement organization."
                : "Official accounts must belong to a public-service organization.",
            ],
          },
        );
      }
      organizationId = organization.id;
    } else if (input.organizationId) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "The request contains invalid fields.",
        { organizationId: ["This role is not attached to an organization."] },
      );
    }

    const now = Date.now();
    await database
      .prepare(
        `UPDATE users
         SET role = ?, organization_id = ?, status = 'ACTIVE',
             verified_at = ?, verified_by_user_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.role, organizationId, now, admin.id, now, target.id);
    await recordAudit(database, {
      actorUserId: admin.id,
      action: "USER_VERIFIED",
      targetType: "USER",
      targetId: target.id,
      details: { role: input.role, organizationId },
    });

    response.json({ user: await findUser(database, target.id) });
  });

  router.post("/users/:userId/status", async (request, response) => {
    const admin = currentUser(request);
    const input = accountStatusSchema.parse(request.body);
    const target = (await database
      .prepare("SELECT id, status FROM users WHERE id = ?")
      .get(request.params.userId)) as { id: string; status: string } | undefined;
    if (!target) {
      throw new ApiError(404, "USER_NOT_FOUND", "This user does not exist.");
    }
    if (target.id === admin.id) {
      throw new ApiError(
        400,
        "CANNOT_MODIFY_SELF",
        "You cannot change the status of your own account.",
      );
    }

    await database
      .prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
      .run(input.status, Date.now(), target.id);
    if (input.status === "SUSPENDED") {
      await database.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    }
    await recordAudit(database, {
      actorUserId: admin.id,
      action: input.status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REINSTATED",
      targetType: "USER",
      targetId: target.id,
      details: { status: input.status },
    });

    response.json({
      user: {
        id: target.id,
        status: input.status,
      },
    });
  });

  router.get("/organizations", async (_request, response) => {
    const rows = (await database
      .prepare(
        `SELECT organizations.id, organizations.name, organizations.kind, organizations.active,
                (SELECT COUNT(*) FROM users WHERE users.organization_id = organizations.id)
                  AS member_count
         FROM organizations
         ORDER BY organizations.name`,
      )
      .all()) as Array<{
      id: string;
      name: string;
      kind: OrganizationKind;
      active: number;
      member_count: number;
    }>;
    response.json({
      organizations: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        active: row.active === 1,
        memberCount: row.member_count,
      })),
    });
  });

  router.post("/organizations", async (request, response) => {
    const admin = currentUser(request);
    const input = organizationSchema.parse(request.body);
    const id = randomUUID();
    const now = Date.now();
    await database
      .prepare(
        `INSERT INTO organizations (id, name, kind, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(id, input.name, input.kind, now, now);
    await recordAudit(database, {
      actorUserId: admin.id,
      action: "ORGANIZATION_CREATED",
      targetType: "ORGANIZATION",
      targetId: id,
      details: { name: input.name, kind: input.kind },
    });
    response.status(201).json({
      organization: { id, name: input.name, kind: input.kind, active: true, memberCount: 0 },
    });
  });

  router.post("/organizations/:organizationId/active", async (request, response) => {
    const admin = currentUser(request);
    const input = activeSchema.parse(request.body);
    const organization = (await database
      .prepare("SELECT id, name FROM organizations WHERE id = ?")
      .get(request.params.organizationId)) as { id: string; name: string } | undefined;
    if (!organization) {
      throw new ApiError(
        404,
        "ORGANIZATION_NOT_FOUND",
        "This organization does not exist.",
      );
    }
    await database
      .prepare("UPDATE organizations SET active = ?, updated_at = ? WHERE id = ?")
      .run(input.active ? 1 : 0, Date.now(), organization.id);
    await recordAudit(database, {
      actorUserId: admin.id,
      action: "ORGANIZATION_UPDATED",
      targetType: "ORGANIZATION",
      targetId: organization.id,
      details: { active: input.active },
    });
    response.json({
      organization: { id: organization.id, name: organization.name, active: input.active },
    });
  });

  router.get("/categories", async (_request, response) => {
    const rows = (await database
      .prepare(
        `SELECT categories.id, categories.name, categories.description, categories.active,
                categories.organization_id, organizations.name AS organization_name
         FROM categories
         JOIN organizations ON organizations.id = categories.organization_id
         ORDER BY categories.name`,
      )
      .all()) as Array<{
      id: string;
      name: string;
      description: string;
      active: number;
      organization_id: string;
      organization_name: string;
    }>;
    response.json({
      categories: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        active: row.active === 1,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
      })),
    });
  });

  router.post("/categories", async (request, response) => {
    const admin = currentUser(request);
    const input = categorySchema.parse(request.body);
    const organization = (await database
      .prepare("SELECT id FROM organizations WHERE id = ?")
      .get(input.organizationId)) as { id: string } | undefined;
    if (!organization) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "The request contains invalid fields.",
        { organizationId: ["Select an existing organization."] },
      );
    }
    const id = randomUUID();
    const now = Date.now();
    await database
      .prepare(
        `INSERT INTO categories
          (id, name, description, organization_id, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, input.name, input.description, organization.id, now, now);
    await recordAudit(database, {
      actorUserId: admin.id,
      action: "CATEGORY_CREATED",
      targetType: "CATEGORY",
      targetId: id,
      details: { name: input.name, organizationId: organization.id },
    });
    response.status(201).json({
      category: {
        id,
        name: input.name,
        description: input.description,
        active: true,
        organizationId: organization.id,
      },
    });
  });

  router.post("/categories/:categoryId/active", async (request, response) => {
    const admin = currentUser(request);
    const input = activeSchema.parse(request.body);
    const category = (await database
      .prepare("SELECT id, name FROM categories WHERE id = ?")
      .get(request.params.categoryId)) as { id: string; name: string } | undefined;
    if (!category) {
      throw new ApiError(404, "CATEGORY_NOT_FOUND", "This category does not exist.");
    }
    await database
      .prepare("UPDATE categories SET active = ?, updated_at = ? WHERE id = ?")
      .run(input.active ? 1 : 0, Date.now(), category.id);
    await recordAudit(database, {
      actorUserId: admin.id,
      action: "CATEGORY_UPDATED",
      targetType: "CATEGORY",
      targetId: category.id,
      details: { active: input.active },
    });
    response.json({
      category: { id: category.id, name: category.name, active: input.active },
    });
  });

  router.get("/audit", async (request, response) => {
    const query = auditQuerySchema.parse(request.query);
    const rows = (await database
      .prepare(
        `SELECT audit_events.id, audit_events.action, audit_events.target_type,
                audit_events.target_id, audit_events.details_json, audit_events.created_at,
                users.display_name AS actor_display_name, users.email AS actor_email,
                users.role AS actor_role
         FROM audit_events
         LEFT JOIN users ON users.id = audit_events.actor_user_id
         ORDER BY audit_events.created_at DESC
         LIMIT ?`,
      )
      .all(query.limit)) as Array<{
      id: string;
      action: string;
      target_type: string;
      target_id: string;
      details_json: string;
      created_at: number;
      actor_display_name: string | null;
      actor_email: string | null;
      actor_role: UserRole | null;
    }>;

    response.json({
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        createdAt: isoTime(row.created_at),
        actor: row.actor_display_name
          ? {
              displayName: row.actor_display_name,
              email: row.actor_email,
              role: row.actor_role,
            }
          : null,
        reportId: row.target_type === "REPORT" ? row.target_id : null,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details_json,
      })),
    });
  });

  return router;
}
