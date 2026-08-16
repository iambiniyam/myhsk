import { assetPath } from "./content";

export type AnalyticsEventName =
  | "app_open"
  | "area_open"
  | "vocab_mode"
  | "character_mode"
  | "client_context"
  | "acquisition_source"
  | "performance_load"
  | "level_select"
  | "search_used"
  | "word_detail_open"
  | "character_detail_open"
  | "audio_play"
  | "group_start"
  | "group_complete"
  | "settings_open"
  | "progress_export"
  | "progress_import";

interface QueuedEvent {
  visitorId: string;
  sessionId: string;
  event: AnalyticsEventName;
  area?: string;
  detail?: string;
  value?: number;
}

const ENDPOINT = assetPath("api/analytics/events");
const ENABLED_KEY = "myhsk:anonymous-analytics";
const VISITOR_KEY = "myhsk:analytics-visitor";
const SESSION_KEY = "myhsk:analytics-session";
let queue: QueuedEvent[] = [];
let flushTimer: number | undefined;
let initialized = false;
let ephemeralSessionId: string | undefined;
let ephemeralVisitorId: string | undefined;
let analyticsPreference: boolean | undefined;

function newId(): string {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionId(): string {
  if (ephemeralSessionId) return ephemeralSessionId;
  let value: string | null = null;
  try { value = sessionStorage.getItem(SESSION_KEY); } catch { /* Storage may be unavailable in strict privacy modes. */ }
  if (!value) {
    value = newId();
    try { sessionStorage.setItem(SESSION_KEY, value); } catch { /* Keep the in-memory ID for this event. */ }
  }
  ephemeralSessionId = value;
  return ephemeralSessionId;
}

function visitorId(): string {
  if (ephemeralVisitorId) return ephemeralVisitorId;
  let value: string | null = null;
  try { value = localStorage.getItem(VISITOR_KEY); } catch { /* Use an in-memory identifier below. */ }
  if (!value) {
    value = newId();
    try { localStorage.setItem(VISITOR_KEY, value); } catch { /* Keep it only for this page lifetime. */ }
  }
  ephemeralVisitorId = value;
  return ephemeralVisitorId;
}

export function anonymousAnalyticsEnabled(): boolean {
  if (analyticsPreference !== undefined) return analyticsPreference;
  try { analyticsPreference = localStorage.getItem(ENABLED_KEY) !== "off"; }
  catch { analyticsPreference = true; }
  return analyticsPreference;
}

export function setAnonymousAnalyticsEnabled(enabled: boolean): void {
  analyticsPreference = enabled;
  try { localStorage.setItem(ENABLED_KEY, enabled ? "on" : "off"); } catch { /* The current tab still honors the choice below. */ }
  if (!enabled) {
    queue = [];
    ephemeralVisitorId = undefined;
    try { localStorage.removeItem(VISITOR_KEY); } catch { /* Nothing else to clear. */ }
  }
  else trackAnalytics("app_open", { detail: "opted-in" });
}

function flush(): void {
  if (!queue.length || !anonymousAnalyticsEnabled()) return;
  const events = queue.splice(0, 20);
  const body = JSON.stringify({ events });
  const sent = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" })) ?? false;
  if (!sent) {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "omit",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }
  if (queue.length) window.setTimeout(flush, 250);
}

export function trackAnalytics(event: AnalyticsEventName, data: { area?: string; detail?: string; value?: number } = {}): void {
  if (!anonymousAnalyticsEnabled()) return;
  queue.push({ visitorId: visitorId(), sessionId: sessionId(), event, ...data });
  if (queue.length >= 8) flush();
  else {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, 1_200);
  }
}

export function initializeAnalytics(): void {
  if (initialized) return;
  initialized = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  trackAnalytics("app_open");
  trackAnalytics("client_context", { area: deviceClass(), detail: browserFamily() });
  trackAnalytics("acquisition_source", { area: "source", detail: acquisitionSource() });
  const trackLoad = () => window.setTimeout(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const duration = Math.round(navigation?.duration ?? 0);
    if (!duration) return;
    trackAnalytics("performance_load", {
      area: "navigation",
      detail: duration <= 2_500 ? "good" : duration <= 4_000 ? "needs-improvement" : "slow",
      value: Math.min(duration, 20_000),
    });
  }, 0);
  if (document.readyState === "complete") trackLoad();
  else window.addEventListener("load", trackLoad, { once: true });
}

function deviceClass(): "mobile" | "tablet" | "desktop" {
  const width = Math.min(window.screen.width, window.innerWidth || window.screen.width);
  if (/ipad|tablet/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && width >= 700)) return "tablet";
  if (/mobi|android|iphone|ipod/i.test(navigator.userAgent) || width < 700) return "mobile";
  return "desktop";
}

function browserFamily(): "edge" | "chrome" | "safari" | "firefox" | "other" {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes("edg/")) return "edge";
  if (agent.includes("firefox/")) return "firefox";
  if (agent.includes("chrome/") || agent.includes("crios/")) return "chrome";
  if (agent.includes("safari/")) return "safari";
  return "other";
}

function acquisitionSource(): "direct" | "internal" | "search" | "social" | "referral" {
  if (!document.referrer) return "direct";
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin === window.location.origin) return "internal";
    const host = referrer.hostname.toLowerCase();
    if (/baidu|bing|google|sogou|so\.com|yahoo|yandex/.test(host)) return "search";
    if (/bilibili|douyin|facebook|instagram|linkedin|reddit|tiktok|twitter|weibo|wechat|x\.com|youtube/.test(host)) return "social";
    return "referral";
  } catch { return "direct"; }
}
