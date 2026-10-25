const CACHE = "civicsignal-shell-v3";
const APP_SHELL = ["/", "/offline.html", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("civicsignal-") && key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/")) || caches.match("/offline.html")));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    const update = fetch(request).then((response) => {
      if (!response.ok) return response;
      let responseForCache;
      try {
        responseForCache = response.clone();
      } catch {
        return fetch(request);
      }
      return caches.open(CACHE)
        .then((cache) => cache.put(request, responseForCache))
        .catch(() => undefined)
        .then(() => response);
    });
    event.waitUntil(update.then(() => undefined, () => undefined));
    event.respondWith(caches.match(request).then((cached) => cached || update));
  }
});

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data?.text() ?? "A report needs your attention." };
  }
  const title = typeof message.title === "string" ? message.title : "CivicSignal update";
  const body = typeof message.body === "string" ? message.body : "A report needs your attention.";
  const url = typeof message.url === "string" && message.url.startsWith("/") && !message.url.startsWith("//")
    ? message.url
    : "/notifications";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: typeof message.tag === "string" ? message.tag : "civicsignal-update",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url;
  const destination = typeof target === "string" && target.startsWith("/") && !target.startsWith("//")
    ? new URL(target, self.location.origin).href
    : new URL("/notifications", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      void existing.navigate(destination);
      return existing.focus();
    }
    return self.clients.openWindow(destination);
  }));
});
