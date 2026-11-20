// Keeps the app shell available with a weak signal in a store. Data comes from Supabase (cached by the app itself).
const CACHE = "crate-shell-v45";
const SHELL = ["/", "/index.html", "/css/app.css", "/js/app.js", "/js/store.js", "/js/search.js", "/js/importer.js", "/js/exporter.js", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const cacheable = (url.origin === location.origin && !url.pathname.startsWith("/api/"))
    || url.hostname === "cdn.jsdelivr.net" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!cacheable) return;
  // Network first so updates show up; fall back to the saved copy when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && res.type !== "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error())))
  );
});
