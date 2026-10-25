import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { CivicDatabase } from "../database.js";
import { ApiError, isoTime } from "../http.js";
import { authenticate, currentUser } from "../session.js";
import { getWebPushPublicKey, isAllowedPushEndpoint } from "../web-push.js";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  read_at: number | null;
  created_at: number;
  report_id: string | null;
};

export function createNotificationsRouter(deps: {
  database: CivicDatabase;
}): Router {
  const { database } = deps;
  const router = Router();

  const pushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(2_048),
    keys: z.object({
      p256dh: z.string().min(80).max(200),
      auth: z.string().min(16).max(100),
    }),
  });

  function serialize(row: NotificationRow) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      read: row.read_at !== null,
      createdAt: isoTime(row.created_at),
      reportId: row.report_id,
    };
  }

  router.get("/push/config", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const publicKey = await getWebPushPublicKey(database);
    const { deviceCount } = (await database.prepare(
      "SELECT COUNT(*) AS deviceCount FROM push_subscriptions WHERE user_id = ?",
    ).get(user.id)) as { deviceCount: number };
    response.json({ publicKey, deviceCount });
  });

  router.put("/push/subscription", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const subscription = pushSubscriptionSchema.parse(request.body);
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      throw new ApiError(422, "INVALID_PUSH_ENDPOINT", "This browser's push service is not supported.");
    }

    const now = Date.now();
    await database.transaction(async () => {
      // Locking the account row serializes the check and insert across instances.
      await database.prepare("UPDATE users SET updated_at = updated_at WHERE id = ?").run(user.id);
      const owned = await database
        .prepare("SELECT user_id FROM push_subscriptions WHERE endpoint = ?")
        .get(subscription.endpoint) as { user_id: string } | undefined;
      if (owned?.user_id !== user.id) {
        const { deviceCount } = (await database.prepare(
          "SELECT COUNT(*) AS deviceCount FROM push_subscriptions WHERE user_id = ?",
        ).get(user.id)) as { deviceCount: number };
        if (deviceCount >= 10) {
          throw new ApiError(
            409,
            "PUSH_DEVICE_LIMIT",
            "This account has reached the limit for alert devices. Remove an old device first.",
          );
        }
      }

      await database.prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET
           user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           updated_at = EXCLUDED.updated_at`,
      ).run(randomUUID(), user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now);
    });
    response.status(204).end();
  });

  router.delete("/push/subscription", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const endpoint = z.string().url().max(2_048).parse(request.body?.endpoint);
    await database.prepare(
      "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
    ).run(user.id, endpoint);
    response.status(204).end();
  });

  router.get("/", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const rows = (await database
      .prepare(
        `SELECT id, type, title, message, read_at, created_at, report_id
         FROM notifications WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .all(user.id)) as NotificationRow[];
    const { unreadCount } = (await database
      .prepare(
        `SELECT COUNT(*) AS "unreadCount" FROM notifications WHERE user_id = ? AND read_at IS NULL`,
      )
      .get(user.id)) as { unreadCount: number };

    response.json({ notifications: rows.map(serialize), unreadCount });
  });

  router.post("/:notificationId/read", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    const owned = await database
      .prepare("SELECT id FROM notifications WHERE id = ? AND user_id = ?")
      .get(request.params.notificationId, user.id);
    if (!owned) {
      throw new ApiError(
        404,
        "NOTIFICATION_NOT_FOUND",
        "This notification does not exist.",
      );
    }
    await database
      .prepare(
        "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
      )
      .run(Date.now(), request.params.notificationId, user.id);
    response.status(204).end();
  });

  router.post("/read-all", authenticate(database), async (request, response) => {
    const user = currentUser(request);
    await database
      .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
      .run(Date.now(), user.id);
    response.status(204).end();
  });

  return router;
}
