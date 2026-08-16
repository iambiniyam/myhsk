const CACHE_PREFIX = "myhsk-";
const LEGACY_CACHE_PREFIXES = ["mingbai-open-"];
const VERSION = `${CACHE_PREFIX}v6`;
const shellUrl = new URL("./", self.registration.scope).toString();
const SHELL = ["./", "./manifest.webmanifest", "./icon.svg"].map((path) => new URL(path, self.registration.scope).toString());

// Core curriculum that makes the first open fast and the basic experience offline-ready:
// HSK level 1 words, the syllabus manifest, character index + clue families, learning
// networks, reading stories, and the shard indexes. Everything else is cached as visited.
const CORE_CONTENT = [
  "content/hsk/manifest.json",
  "content/hsk/level-1.json",
  "content/hsk/cultural-terms.json",
  "content/priority-features/level-1.json",
  "content/character-curriculum/index.json",
  "content/character-curriculum/families.json",
  "content/character-curriculum/manifest.json",
  "content/networks.json",
  "content/reading-stories.json",
  "content/sentences/hsk-index.json",
  "content/spoken-index.json",
  "human-audio-v1.json",
].map((path) => new URL(path, self.registration.scope).toString());

function remember(event, request, response) {
  if (response.ok || response.type === "opaque") {
    event.waitUntil(caches.open(VERSION).then((cache) => cache.put(request, response.clone())).catch(() => undefined));
  }
  return response;
}

async function cacheFirst(event, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return remember(event, request, await fetch(request));
}

async function staleWhileRevalidate(event, request) {
  const cached = await caches.match(request);
  const update = fetch(request).then((response) => remember(event, request, response));
  if (cached) {
    event.waitUntil(update.catch(() => undefined));
    return cached;
  }
  return update;
}

async function navigationWithFastFallback(event, request, fallback) {
  const network = fetch(request).then((response) => remember(event, request, response));
  let timeout;
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Navigation network timeout")), 2_500); }),
    ]);
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallback) {
      const shell = await caches.match(fallback);
      if (shell) return shell;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    event.waitUntil(network.catch(() => undefined));
  }
}

// Prefetch a fixed set of likely-next files quietly after activation. The app itself
// already caches whatever the learner opens (stale-while-revalidate + cache-first).
async function warmCore() {
  const cache = await caches.open(VERSION);
  await Promise.all([...SHELL, ...CORE_CONTENT].map(async (url) => {
    try {
      if (await cache.match(url)) return;
      const response = await fetch(url, { cache: "no-cache" });
      if (response.ok || response.type === "opaque") await cache.put(url, response);
    } catch { /* offline or missing file is fine */ }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)),
    self.skipWaiting(),
  ]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith(CACHE_PREFIX) && key !== VERSION) || LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]).then(() => {
    // Warm the core curriculum when the browser is idle after activation.
    const warm = () => void warmCore();
    if ("scheduler" in self && self.scheduler.postTask) {
      self.scheduler.postTask(warm, { priority: "background" }).catch(warm);
    } else {
      self.setTimeout(warm, 4_000);
    }
  }));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(navigationWithFastFallback(event, event.request, shellUrl));
    return;
  }

  if (url.pathname.includes("/content/") || url.pathname.endsWith(".json")) {
    event.respondWith(staleWhileRevalidate(event, event.request));
    return;
  }

  if (url.pathname.endsWith("/manifest.webmanifest") || url.pathname.endsWith("/icon.svg")) {
    event.respondWith(staleWhileRevalidate(event, event.request));
    return;
  }

  if (url.pathname.includes("/assets/") || url.pathname.includes("/audio/") || /\.(?:js|css|svg|png|webp|mp3|woff2)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(event, event.request));
  }
});
