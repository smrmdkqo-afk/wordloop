const CACHE = "wordloop-DEV-CACHE";
const FILES = /* PRECACHE */ [
  "./",
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/core.js",
  "./src/storage.js",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./manifest.webmanifest",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))),
);
// New app versions activate only after the previous app's windows close.
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("wordloop-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url),
    scope = new URL(self.registration.scope);
  if (
    event.request.method !== "GET" ||
    url.origin !== scope.origin ||
    !url.pathname.startsWith(scope.pathname)
  )
    return;
  // Content updates are hash-checked and saved atomically in IndexedDB by the app.
  if (url.pathname.includes("/data/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === "navigate")
        return (
          (await cache.match(new URL("./index.html", scope).href)) ||
          fetch(event.request)
        );
      return (await cache.match(event.request)) || fetch(event.request);
    })(),
  );
});
