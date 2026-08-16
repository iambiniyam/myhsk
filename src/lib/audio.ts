import { assetPath } from "./content";

export type AudioSpeed = "normal" | "slow";
export type AudioKind = "word" | "sentence";
type AudioSource = "human" | "device" | "neural";

interface HumanAudioManifest {
  words: string[];
}

interface StaticAudioManifest {
  clips: Record<string, Partial<Record<AudioSpeed, string>>>;
}

const NEURAL_CACHE = "myhsk-neural-audio-v2";
const NEURAL_ENDPOINT = assetPath("api/tts");
const HUMAN_MANIFEST = assetPath("human-audio-v1.json");
const STATIC_MANIFEST = assetPath("audio/manifest.json");
const MAX_OBJECT_URLS = 36;
const MAX_MEDIA_PRELOADS = 8;
const API_TIMEOUT_MS = 3_500;
const NATURAL_VOICE_HINTS = [
  "natural", "neural", "premium", "enhanced", "xiaoxiao", "xiaoyi", "yunxi", "yunyang",
  "tingting", "ting-ting", "meijia", "mei-jia", "sin-ji", "li-mu", "google", "siri",
];
const ROBOTIC_VOICE_HINTS = ["espeak", "compact", "festival", "mbrola"];

let preloadPromise: Promise<void> | undefined;
let voicesListenerInstalled = false;
let humanWordsPromise: Promise<Set<string>> | undefined;
let staticAudioPromise: Promise<StaticAudioManifest> | undefined;
let currentAudio: HTMLAudioElement | undefined;
let voiceCache: SpeechSynthesisVoice[] = [];
let settleCurrentPlayback: ((error?: Error) => void) | undefined;
const neuralRequests = new Map<string, Promise<string>>();
const neuralObjectUrls = new Map<string, string>();
const mediaPreloads = new Map<string, HTMLAudioElement>();

function humanFileName(text: string): string {
  return Array.from(new TextEncoder().encode(text.trim()), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadHumanWords(): Promise<Set<string>> {
  humanWordsPromise ??= fetch(HUMAN_MANIFEST, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Human audio index is unavailable.");
      const manifest = await response.json() as HumanAudioManifest;
      return new Set(Array.isArray(manifest.words) ? manifest.words : []);
    })
    .catch(() => new Set<string>());
  return humanWordsPromise;
}

async function humanRecordingUrl(text: string, kind: AudioKind): Promise<string | undefined> {
  const normalized = text.trim();
  if (kind !== "word" || !normalized || !(await loadHumanWords()).has(normalized)) return undefined;
  return assetPath(`audio/human/${humanFileName(normalized)}.mp3`);
}

async function loadStaticAudio(): Promise<StaticAudioManifest> {
  staticAudioPromise ??= fetch(STATIC_MANIFEST, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Static audio index is unavailable.");
      return response.json() as Promise<StaticAudioManifest>;
    })
    .catch(() => ({ clips: {} }));
  return staticAudioPromise;
}

async function staticRecordingUrl(text: string, kind: AudioKind, speed: AudioSpeed): Promise<string | undefined> {
  const clip = (await loadStaticAudio()).clips?.[`${kind}:${text.trim()}`];
  const source = clip?.[speed] ?? clip?.normal;
  return source ? assetPath(source) : undefined;
}

function neuralKey(kind: AudioKind, text: string): string {
  return `v2:${kind}:${text.trim()}`;
}

function refreshVoices(): void {
  voiceCache = window.speechSynthesis?.getVoices?.() ?? [];
}

export function preloadAudioSystem(): Promise<void> {
  preloadPromise ??= Promise.resolve().then(() => {
    void loadHumanWords();
    void loadStaticAudio();
    if (!("speechSynthesis" in window)) return;
    refreshVoices();
    if (!voicesListenerInstalled) {
      window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
      voicesListenerInstalled = true;
    }
  });
  return preloadPromise;
}

function chooseChineseVoice(gender: "female" | "male"): SpeechSynthesisVoice | undefined {
  refreshVoices();
  const chinese = voiceCache.filter((voice) => /^zh(?:-|_)/i.test(voice.lang));
  const femaleHints = ["xiaoxiao", "xiaoyi", "ting-ting", "tingting", "meijia", "mei-jia", "sin-ji", "female", "女"];
  const maleHints = ["yunxi", "yunyang", "yunfeng", "kangkang", "li-mu", "male", "男"];
  const preferred = gender === "female" ? femaleHints : maleHints;
  return [...chinese].sort((a, b) => {
    const score = (voice: SpeechSynthesisVoice) => {
      const name = voice.name.toLowerCase();
      const language = voice.lang.toLowerCase().replace("_", "-");
      return (language === "zh-cn" ? 80 : language === "zh-sg" ? 60 : 40)
        + NATURAL_VOICE_HINTS.reduce((total, hint) => total + (name.includes(hint) ? 22 : 0), 0)
        + preferred.reduce((total, hint) => total + (name.includes(hint) ? 9 : 0), 0)
        + (voice.default ? 4 : 0)
        + (voice.localService ? 8 : 5)
        - ROBOTIC_VOICE_HINTS.reduce((total, hint) => total + (name.includes(hint) ? 140 : 0), 0);
    };
    return score(b) - score(a);
  })[0];
}

function interruptPlayback(): void {
  const interrupted = settleCurrentPlayback;
  settleCurrentPlayback = undefined;
  currentAudio?.pause();
  window.speechSynthesis?.cancel();
  interrupted?.(new DOMException("Playback was replaced.", "AbortError"));
}

function playDeviceVoice(text: string, kind: AudioKind, speed: AudioSpeed, gender: "female" | "male", onStart?: () => void): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.reject(new Error("Speech synthesis is unavailable on this device."));
  interruptPlayback();
  const utterance = new SpeechSynthesisUtterance(kind === "word" ? `${text}。` : text);
  utterance.lang = "zh-CN";
  utterance.rate = speed === "slow" ? (kind === "word" ? 0.72 : 0.82) : (kind === "word" ? 0.92 : 1);
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.voice = chooseChineseVoice(gender) ?? null;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let started = false;
    const startTimeout = window.setTimeout(() => {
      if (!started) {
        window.speechSynthesis.cancel();
        finish(new Error("Device speech did not start quickly."));
      }
    }, 1_800);
    const playbackTimeout = window.setTimeout(
      () => finish(),
      Math.min(30_000, Math.max(8_000, text.length * 850)),
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(startTimeout);
      window.clearTimeout(playbackTimeout);
      if (settleCurrentPlayback === finish) settleCurrentPlayback = undefined;
      if (error) reject(error); else resolve();
    };
    settleCurrentPlayback = finish;
    utterance.onstart = () => {
      started = true;
      window.clearTimeout(startTimeout);
      onStart?.();
    };
    utterance.onend = () => finish();
    utterance.onerror = (event) => finish(new Error(event.error || "Speech playback failed."));
    window.speechSynthesis.speak(utterance);
  });
}

function getAudioPlayer(): HTMLAudioElement {
  if (currentAudio) return currentAudio;
  const player = document.createElement("audio");
  player.preload = "auto";
  player.setAttribute("playsinline", "");
  player.style.display = "none";
  document.body.appendChild(player);
  currentAudio = player;
  return player;
}

function preloadMedia(source: string): void {
  if (mediaPreloads.has(source)) return;
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.src = source;
  audio.load();
  mediaPreloads.set(source, audio);
  if (mediaPreloads.size > MAX_MEDIA_PRELOADS) {
    const oldest = mediaPreloads.entries().next().value as [string, HTMLAudioElement] | undefined;
    if (oldest) {
      oldest[1].pause();
      oldest[1].removeAttribute("src");
      mediaPreloads.delete(oldest[0]);
    }
  }
}

function cacheRequest(key: string): Request {
  const url = new URL(assetPath("__myhsk_audio_cache__/v2"), window.location.href);
  url.searchParams.set("key", key);
  return new Request(url, { method: "GET" });
}

function rememberObjectUrl(key: string, blob: Blob): string {
  const existing = neuralObjectUrls.get(key);
  if (existing) {
    neuralObjectUrls.delete(key);
    neuralObjectUrls.set(key, existing);
    return existing;
  }
  const url = URL.createObjectURL(blob);
  neuralObjectUrls.set(key, url);
  if (neuralObjectUrls.size > MAX_OBJECT_URLS) {
    const oldest = neuralObjectUrls.entries().next().value as [string, string] | undefined;
    if (oldest) {
      neuralObjectUrls.delete(oldest[0]);
      URL.revokeObjectURL(oldest[1]);
    }
  }
  return url;
}

async function loadNeuralUrl(text: string, kind: AudioKind): Promise<string> {
  const key = neuralKey(kind, text);
  const memoryHit = neuralObjectUrls.get(key);
  if (memoryHit) return memoryHit;
  const pending = neuralRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const cache = "caches" in window ? await window.caches.open(NEURAL_CACHE).catch(() => undefined) : undefined;
    const cached = await cache?.match(cacheRequest(key)).catch(() => undefined);
    if (cached?.ok) {
      const blob = await cached.blob();
      if (blob.size > 512 && blob.type.startsWith("audio/")) return rememberObjectUrl(key, blob);
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await fetch(NEURAL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-MyHSK-Audio": "1" },
        body: JSON.stringify({ text: text.trim(), kind }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Neural audio is unavailable.");
      const blob = await response.blob();
      if (blob.size <= 512) throw new Error("Neural audio was empty.");
      if (cache) {
        void cache.put(cacheRequest(key), new Response(blob, {
          headers: { "Content-Type": blob.type || "audio/wav", "Cache-Control": "public, max-age=31536000, immutable" },
        })).catch(() => undefined);
      }
      return rememberObjectUrl(key, blob);
    } finally {
      window.clearTimeout(timeout);
    }
  })().finally(() => neuralRequests.delete(key));

  neuralRequests.set(key, request);
  return request;
}

function playMedia(source: string, speed: AudioSpeed, onStart?: () => void, maxPlaybackMs = 30_000): Promise<void> {
  interruptPlayback();
  const audio = getAudioPlayer();
  audio.src = source;
  audio.defaultPlaybackRate = speed === "slow" ? 0.78 : 1;
  audio.playbackRate = audio.defaultPlaybackRate;
  audio.preservesPitch = true;
  audio.load();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let started = false;
    let playbackTimeout: number | undefined;
    const startTimeout = window.setTimeout(() => finish(new Error("Audio took too long to start.")), 5_000);
    const markStarted = () => {
      if (started || settled) return;
      started = true;
      window.clearTimeout(startTimeout);
      // Some mobile browsers omit the final `ended` event. Once playback has
      // started, reaching this guard is completion—not a reason to replay via a fallback.
      playbackTimeout = window.setTimeout(() => finish(), maxPlaybackMs);
      onStart?.();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(startTimeout);
      window.clearTimeout(playbackTimeout);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("playing", markStarted);
      audio.removeEventListener("error", failed);
      audio.removeEventListener("abort", failed);
      if (settleCurrentPlayback === finish) settleCurrentPlayback = undefined;
      if (error) reject(error); else resolve();
    };
    const ended = () => finish();
    const failed = () => finish(new Error("Audio playback failed."));
    settleCurrentPlayback = finish;
    audio.addEventListener("ended", ended, { once: true });
    audio.addEventListener("playing", markStarted, { once: true });
    audio.addEventListener("error", failed, { once: true });
    audio.addEventListener("abort", failed, { once: true });
    void audio.play().then(markStarted).catch((error: unknown) => finish(error instanceof Error ? error : new Error("Audio playback failed.")));
  });
}

export async function prefetchChinese(text?: string, kind: AudioKind = "word", mediaUrl?: string, speed: AudioSpeed = "normal"): Promise<void> {
  await preloadAudioSystem();
  if (!text) return;
  const preferredUrl = mediaUrl || await humanRecordingUrl(text, kind) || await staticRecordingUrl(text, kind, speed);
  if (preferredUrl) preloadMedia(assetPath(preferredUrl));
}

export async function speakChinese(
  text: string,
  options: { kind?: AudioKind; speed?: AudioSpeed; gender?: "female" | "male"; mediaUrl?: string; onStart?: (source: AudioSource) => void } = {},
): Promise<AudioSource> {
  const kind = options.kind ?? "word";
  const speed = options.speed ?? "normal";
  const gender = options.gender ?? "female";
  const playbackLimit = kind === "word" ? 6_000 : Math.min(60_000, Math.max(8_000, text.length * 1_000));
  await preloadAudioSystem();

  if (options.mediaUrl) {
    try {
      await playMedia(assetPath(options.mediaUrl), speed, () => options.onStart?.("human"), playbackLimit);
      return "human";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }

  const humanUrl = await humanRecordingUrl(text, kind);
  if (humanUrl) {
    try {
      await playMedia(humanUrl, speed, () => options.onStart?.("human"), playbackLimit);
      return "human";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }

  const staticUrl = await staticRecordingUrl(text, kind, speed);
  if (staticUrl) {
    try {
      await playMedia(staticUrl, speed, () => options.onStart?.("neural"), playbackLimit);
      return "neural";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }

  // High-quality neural audio comes before the device voice: the device voice is the
  // least natural Mandarin option and was previously mispronouncing polyphonic characters.
  try {
    const source = await loadNeuralUrl(text, kind);
    await playMedia(source, speed, () => options.onStart?.("neural"), playbackLimit);
    return "neural";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
  }

  try {
    await playDeviceVoice(text, kind, speed, gender, () => options.onStart?.("device"));
    return "device";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
  }

  throw new Error("No Mandarin audio source could play.");
}

export function stopAudio(): void {
  interruptPlayback();
}
