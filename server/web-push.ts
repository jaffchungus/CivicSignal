import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";

import type { CivicDatabase } from "./database.js";

const VAPID_SETTINGS_KEY = "web_push_vapid_keys";
const PUSH_TTL_SECONDS = 60 * 60 * 24;

type VapidKeys = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function parseVapidKeys(publicKey: string, privateKey: string, subject: string): VapidKeys | null {
  const publicBytes = decodeBase64Url(publicKey);
  const privateBytes = decodeBase64Url(privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) return null;
  return { publicKey, privateKey, subject };
}

function generateVapidKeys(subject: string): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: encodeBase64Url(ecdh.getPublicKey()),
    privateKey: encodeBase64Url(ecdh.getPrivateKey()),
    subject,
  };
}

function vapidSubject(): string {
  if (process.env.WEB_PUSH_SUBJECT) return process.env.WEB_PUSH_SUBJECT;
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://localhost";
}

async function loadVapidKeys(database: CivicDatabase): Promise<VapidKeys | null> {
  const configuredPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const configuredPrivateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (configuredPublicKey || configuredPrivateKey) {
    if (!configuredPublicKey || !configuredPrivateKey) return null;
    return parseVapidKeys(configuredPublicKey, configuredPrivateKey, vapidSubject());
  }

  const subject = vapidSubject();
  const existing = (await database.prepare("SELECT value FROM settings WHERE key = ?")
    .get(VAPID_SETTINGS_KEY)) as { value: string } | undefined;
  if (existing) {
    try {
      const stored = JSON.parse(existing.value) as { publicKey?: string; privateKey?: string; subject?: string };
      if (stored.publicKey && stored.privateKey) {
        return parseVapidKeys(stored.publicKey, stored.privateKey, stored.subject ?? subject);
      }
    } catch {
      return null;
    }
    return null;
  }

  const generated = generateVapidKeys(subject);
  await database.transaction(async () => {
    await database.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    ).run(VAPID_SETTINGS_KEY, JSON.stringify(generated));
  });
  const saved = (await database.prepare("SELECT value FROM settings WHERE key = ?")
    .get(VAPID_SETTINGS_KEY)) as { value: string } | undefined;
  if (!saved) return null;
  try {
    const stored = JSON.parse(saved.value) as { publicKey?: string; privateKey?: string; subject?: string };
    return stored.publicKey && stored.privateKey
      ? parseVapidKeys(stored.publicKey, stored.privateKey, stored.subject ?? subject)
      : null;
  } catch {
    return null;
  }
}

export async function getWebPushPublicKey(database: CivicDatabase): Promise<string | null> {
  return (await loadVapidKeys(database))?.publicKey ?? null;
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com" ||
      host === "push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com") ||
      host === "web.push.apple.com" ||
      host === "notify.windows.com" || host.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

function expandHkdf(prk: Buffer, info: Buffer, length: number): Buffer {
  return createHmac("sha256", prk).update(info).update(Buffer.from([1])).digest().subarray(0, length);
}

function authorizationHeader(keys: VapidKeys, audience: string): string {
  const publicBytes = decodeBase64Url(keys.publicKey);
  const privateBytes = decodeBase64Url(keys.privateKey);
  const privateObject = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicBytes.subarray(1, 33)),
      y: encodeBase64Url(publicBytes.subarray(33, 65)),
      d: encodeBase64Url(privateBytes),
    },
    format: "jwk",
  });
  const header = encodeBase64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = encodeBase64Url(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  })));
  const unsignedToken = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsignedToken), {
    key: privateObject,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsignedToken}.${encodeBase64Url(signature)}, k=${keys.publicKey}`;
}

function encryptedPayload(subscription: StoredSubscription, payload: Buffer): Buffer {
  const userPublicKey = decodeBase64Url(subscription.p256dh);
  const authSecret = decodeBase64Url(subscription.auth);
  if (userPublicKey.length !== 65 || userPublicKey[0] !== 4 || authSecret.length < 16) {
    throw new Error("Invalid Web Push encryption keys.");
  }

  const sender = createECDH("prime256v1");
  sender.generateKeys();
  const senderPublicKey = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(userPublicKey);
  const authPrk = createHmac("sha256", authSecret).update(sharedSecret).digest();
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    userPublicKey,
    senderPublicKey,
  ]);
  const inputKeyMaterial = expandHkdf(authPrk, keyInfo, 32);
  const salt = randomBytes(16);
  const prk = createHmac("sha256", salt).update(inputKeyMaterial).digest();
  const contentEncryptionKey = expandHkdf(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expandHkdf(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4_096);
  return Buffer.concat([salt, recordSize, Buffer.from([senderPublicKey.length]), senderPublicKey, ciphertext]);
}

async function sendToSubscription(
  database: CivicDatabase,
  keys: VapidKeys,
  subscription: StoredSubscription,
  payload: Buffer,
): Promise<void> {
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    await database.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(subscription.id);
    return;
  }
  try {
    const endpoint = new URL(subscription.endpoint);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorizationHeader(keys, endpoint.origin),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: "high",
      },
      body: encryptedPayload(subscription, payload),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404 || response.status === 410) {
      await database.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(subscription.id);
    } else if (!response.ok) {
      console.warn("Web Push delivery failed.", { status: response.status });
    }
  } catch (error) {
    console.warn("Web Push delivery could not be completed.", error instanceof Error ? error.message : "Unknown error");
  }
}

export async function sendWebPushToUser(
  database: CivicDatabase,
  userId: string,
  notification: { title: string; message: string; reportId: string | null },
): Promise<void> {
  const subscriptions = (await database.prepare(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
  ).all(userId)) as StoredSubscription[];
  if (subscriptions.length === 0) return;
  const keys = await loadVapidKeys(database);
  if (!keys) return;

  const payload = Buffer.from(JSON.stringify({
    title: notification.title,
    body: notification.message,
    url: notification.reportId ? `/reports/${encodeURIComponent(notification.reportId)}` : "/notifications",
    tag: notification.reportId ? `report-${notification.reportId}` : `notification-${randomUUID()}`,
  }));
  await Promise.all(subscriptions.map((subscription) =>
    sendToSubscription(database, keys, subscription, payload),
  ));
}
