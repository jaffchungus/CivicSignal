// @vitest-environment node

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupApplications, setupAdministrator, testApplication } from "./helpers";

afterEach(async () => {
  await cleanupApplications();
});

function subscription(index: number) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${index}`,
    keys: {
      p256dh: "a".repeat(88),
      auth: "b".repeat(24),
    },
  };
}

describe("push subscriptions", () => {
  it("serializes concurrent registrations at the per-account device limit", async () => {
    const app = await testApplication();
    await setupAdministrator(app);
    const resident = request.agent(app);
    await resident
      .post("/api/auth/register")
      .send({
        displayName: "Rita Resident",
        email: "push-resident@example.test",
        password: "a resident account password",
      })
      .expect(201);

    const responses = await Promise.all(
      Array.from({ length: 14 }, (_, index) => (
        resident.put("/api/notifications/push/subscription").send(subscription(index))
      )),
    );
    expect(responses.filter((response) => response.status === 204)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(4);
    await resident
      .get("/api/notifications/push/config")
      .expect(200)
      .expect(({ body }) => {
        expect(body.deviceCount).toBe(10);
      });
  });

  it("bounds the number of alert devices per account while allowing updates", async () => {
    const app = await testApplication();
    const user = await setupAdministrator(app);

    for (let index = 0; index < 10; index += 1) {
      await user
        .put("/api/notifications/push/subscription")
        .send(subscription(index))
        .expect(204);
    }

    await user
      .put("/api/notifications/push/subscription")
      .send(subscription(10))
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe("PUSH_DEVICE_LIMIT");
      });
    await user
      .put("/api/notifications/push/subscription")
      .send(subscription(0))
      .expect(204);

    await user
      .get("/api/notifications/push/config")
      .expect(200)
      .expect(({ body }) => {
        expect(body.deviceCount).toBe(10);
      });
  });
});
