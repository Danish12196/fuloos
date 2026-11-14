/* Fuloos static app-shell service worker.
 * Never caches authenticated API / PocketBase responses or any financial data.
 */
const CACHE_PREFIX = "fuloos-shell-";
const CACHE_VERSION = "fuloos-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

function isStaticShellPath(pathname) {
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_/") ||
    pathname.startsWith("/pb/")
  ) {
    return false;
  }
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icons/")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("authorization")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first, falling back to cached shell HTML.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match("/index.html")
            .then((cached) => cached || caches.match("/")),
        ),
    );
    return;
  }

  // Only cache known static shell assets; never cache API or dynamic data.
  if (!isStaticShellPath(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

function parsePushPayload(event) {
  const fallback = {
    title: "Fuloos",
    body: "You have a new financial alert.",
    url: "/?settings=notifications",
    tag: "fuloos-alert",
  };
  if (!event || !event.data) return fallback;
  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === "object") {
      return {
        title:
          typeof parsed.title === "string" && parsed.title.trim()
            ? parsed.title.trim().slice(0, 120)
            : fallback.title,
        body:
          typeof parsed.body === "string" && parsed.body.trim()
            ? parsed.body.trim().slice(0, 240)
            : fallback.body,
        url:
          typeof parsed.url === "string" && parsed.url.startsWith("/")
            ? parsed.url
            : fallback.url,
        tag:
          typeof parsed.tag === "string" && parsed.tag.trim()
            ? parsed.tag.trim().slice(0, 64)
            : fallback.tag,
      };
    }
  } catch {
    try {
      const text = event.data.text();
      if (typeof text === "string" && text.trim()) {
        return {
          ...fallback,
          body: text.trim().slice(0, 240),
        };
      }
    } catch {
      // Ignore malformed push payload
    }
  }
  return fallback;
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl =
    event.notification &&
    event.notification.data &&
    typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/";
  const targetPath = rawUrl.startsWith("/") ? rawUrl : "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            return client.focus().then((focused) => {
              if (focused && "navigate" in focused && focused.url !== targetUrl) {
                return focused.navigate(targetUrl).catch(() => focused);
              }
              return focused;
            });
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});

