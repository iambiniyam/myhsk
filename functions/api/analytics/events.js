const EVENT_NAMES = new Set([
  "app_open",
  "area_open",
  "vocab_mode",
  "character_mode",
  "client_context",
  "acquisition_source",
  "performance_load",
  "level_select",
  "search_used",
  "word_detail_open",
  "character_detail_open",
  "audio_play",
  "group_start",
  "group_complete",
  "settings_open",
  "progress_export",
  "progress_import",
]);
const REQUEST_LIMIT = 120;
const WINDOW_MS = 60_000;
const requestWindows = new Map();

function response(status = 204) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function isSameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function allowRequest(request) {
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= REQUEST_LIMIT;
}

function token(value, maxLength = 32) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= maxLength && /^[a-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function validEvent(value) {
  if (!value || typeof value !== "object") return null;
  const event = token(value.event);
  const visitorId = typeof value.visitorId === "string" && /^[a-zA-Z0-9_-]{12,64}$/.test(value.visitorId)
    ? value.visitorId
    : null;
  const sessionId = typeof value.sessionId === "string" && /^[a-zA-Z0-9_-]{12,64}$/.test(value.sessionId)
    ? value.sessionId
    : null;
  if (!event || !EVENT_NAMES.has(event) || !visitorId || !sessionId) return null;
  const numericValue = Number.isInteger(value.value) && value.value >= 0 && value.value <= 20_000 ? value.value : null;
  return {
    visitorId,
    sessionId,
    event,
    area: token(value.area),
    detail: token(value.detail, 40),
    value: numericValue,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return response(403);
  if (!allowRequest(request)) return response(429);
  if (!env.ANALYTICS_DB) return response();

  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return response(400);
  }
  const events = (Array.isArray(body?.events) ? body.events : []).slice(0, 20).map(validEvent).filter(Boolean);
  if (!events.length) return response(400);
  const country = token(request.cf?.country, 2);
  const statement = env.ANALYTICS_DB.prepare(
    "INSERT INTO analytics_events (visitor_id, session_id, event, area, detail, value, country) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  );
  try {
    await env.ANALYTICS_DB.batch(events.map((item) => statement.bind(
      item.visitorId,
      item.sessionId,
      item.event,
      item.area,
      item.detail,
      item.value,
      country,
    )));
    if (Math.random() < 0.002) {
      context.waitUntil(env.ANALYTICS_DB.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-180 days')").run());
    }
  } catch (error) {
    console.error("Analytics write failed", error instanceof Error ? error.message : String(error));
  }
  return response();
}

export function onRequestGet() {
  return response(405);
}
