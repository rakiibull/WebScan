/*
  WebScan service worker.

  The cache name is versioned so that changing this list actually ships:
  without a new name the browser keeps serving the old bundle forever.
*/
const CACHE = "webscan-store-v3";

/*
  Every local file the app needs to run offline. This list fell behind
  as modules were added, which left an offline visitor with the old
  four-file app and no scanner engine, editor or export.
*/
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./scanner-engine.css",
  "./messages.js",
  "./script.js",
  "./scanner-engine.js",
  "./enhance-engine.js",
  "./crop-editor.js",
  "./page-manager.js",
  "./editor-history.js",
  "./pdf-font.js",
  "./ocr-engine.js",
  "./detect-worker.js",
  "./manifest.json",
  "./fonts/NotoSansBengali-Regular.ttf"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      /*
        Individual failures must not abort the whole install, or one
        missing optional file would leave the app with no cache at all.
      */
      Promise.all(
        ASSETS.map((asset) =>
          cache.add(asset).catch((error) => {
            console.warn("Could not cache", asset, error);
          })
        )
      )
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Remove caches from previous versions so old files are not served.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET requests are cacheable.
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          /*
            Cache same-origin responses as they are fetched, so files
            added later (and the large OpenCV/Tesseract downloads on
            first use) are available offline afterwards.
          */
          if (
            response.ok &&
            new URL(request.url).origin === self.location.origin
          ) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }

          return response;
        })
        .catch(() => cached);
    })
  );
});
