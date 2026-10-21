import { Router } from "express";

import type { CivicDatabase } from "../database.js";
import { ApiError, isoTime } from "../http.js";
import { authenticate, currentUser } from "../session.js";

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
