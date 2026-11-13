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
