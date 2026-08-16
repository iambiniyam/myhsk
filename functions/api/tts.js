// On-demand Mandarin neural audio. Prefers the most natural available model and falls
// back automatically. Successful audio is cached immutably at the edge.
const MODELS = [
  { name: "@cf/deepgram/aura-1", input: (text) => ({ text }), version: "aura-1" },
  { name: "@cf/myshell-ai/melotts", input: (text) => ({ prompt: text, lang: "zh" }), version: "melotts-zh-v2" },
];
const MAX_TEXT_LENGTH = 180;
const MISS_LIMIT = 60;
const WINDOW_MS = 60_000;
const requestWindows = new Map();

function jsonError(message, status, retryAfter) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return Response.json({ error: message }, { status, headers });
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function contentTypeFor(bytes) {
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "audio/wav";
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";
  return "audio/mpeg";
}

function optimizeWave(bytes) {
  if (contentTypeFor(bytes) !== "audio/wav" || bytes.byteLength < 48) return bytes;
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = (offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (label(8) !== "WAVE") return bytes;

  let format;
  let dataOffset = 0;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const chunk = label(offset);
    const size = source.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + size > bytes.byteLength) break;
    if (chunk === "fmt " && size >= 16) {
      format = {
        encoding: source.getUint16(payload, true),
        channels: source.getUint16(payload + 2, true),
        sampleRate: source.getUint32(payload + 4, true),
        bits: source.getUint16(payload + 14, true),
      };
    } else if (chunk === "data") {
      dataOffset = payload;
      dataLength = size;
      break;
    }
    offset = payload + size + (size % 2);
  }

  if (!format || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16 || format.sampleRate < 40_000 || !dataOffset) return bytes;
  const inputSamples = Math.floor(dataLength / 2);
  const outputSamples = Math.floor(inputSamples / 2);
  if (outputSamples < 1) return bytes;
  const output = new Uint8Array(44 + outputSamples * 2);
  const view = new DataView(output.buffer);
  const writeLabel = (offset, value) => { for (let index = 0; index < 4; index += 1) output[offset + index] = value.charCodeAt(index); };
  const sampleRate = Math.floor(format.sampleRate / 2);
  writeLabel(0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeLabel(8, "WAVE");
  writeLabel(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeLabel(36, "data");
  view.setUint32(40, outputSamples * 2, true);
  for (let index = 0; index < outputSamples; index += 1) {
    const first = source.getInt16(dataOffset + index * 4, true);
    const second = source.getInt16(dataOffset + index * 4 + 2, true);
    view.setInt16(44 + index * 2, Math.round((first + second) / 2), true);
  }
  return output;
}

async function cacheKey(request, text, version) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${version}:${text}`));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(`${new URL(request.url).origin}/__myhsk_tts_edge_cache__/${hash}`, { method: "GET" });
}

function allowMiss(request) {
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MISS_LIMIT;
}

async function audioResponse(result, startedAt, voice = "myhsk-neural") {
  let bytes;
  if (result instanceof Response) {
    bytes = new Uint8Array(await result.arrayBuffer());
  } else if (result instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(result).arrayBuffer());
  } else if (typeof result?.audio === "string") {
    bytes = decodeBase64(result.audio);
  } else if (result instanceof ArrayBuffer) {
    bytes = new Uint8Array(result);
  } else if (ArrayBuffer.isView(result)) {
    bytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  }
  if (!bytes || bytes.byteLength < 512) throw new Error("The speech model returned no audio.");
  bytes = optimizeWave(bytes);

  return new Response(bytes, {
    headers: {
      "Content-Type": contentTypeFor(bytes),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Server-Timing": `tts;dur=${Date.now() - startedAt}`,
      "X-Content-Type-Options": "nosniff",
      "X-MyHSK-Voice": voice,
    },
  });
}

async function synthesize(env, text, startedAt) {
  let lastError;
  for (const model of MODELS) {
    try {
      const key = await cacheKey(new Request("https://local"), text, model.version);
      const cached = await caches.default.match(key);
      if (cached) return { response: cached, hit: true };
      const result = await env.AI.run(model.name, model.input(text));
      const response = await audioResponse(result, startedAt, model.version);
      return { response, model: model.version, hit: false };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No speech model available.");
}

export async function onRequestGet() {
  return Response.json({ ok: true, service: "Mandarin neural audio", models: MODELS.map((model) => model.version) }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (request.headers.get("X-MyHSK-Audio") !== "1") return jsonError("Invalid audio request.", 403);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return jsonError("Expected JSON.", 415);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON.", 400);
  }
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/gu, " ").trim() : "";
  if (!text || text.length > MAX_TEXT_LENGTH || !/\p{Script=Han}/u.test(text)) return jsonError("Enter valid Chinese text up to 180 characters.", 400);
  if (!env.AI?.run) return jsonError("Neural audio is not configured.", 503, 30);

  if (!allowMiss(request)) return jsonError("Please wait a moment before requesting more new audio.", 429, 60);

  const startedAt = Date.now();
  try {
    const { response, model, hit } = await synthesize(env, text, startedAt);
    if (!hit) {
      const cachedResponse = response.clone();
      context.waitUntil(caches.default.put(await cacheKey(new Request("https://local"), text, model ?? "myhsk-neural"), cachedResponse));
    }
    response.headers.set("X-MyHSK-Audio-Cache", hit ? "HIT" : "MISS");
    return response;
  } catch (error) {
    console.error("Mandarin TTS failed", error instanceof Error ? error.message : String(error));
    return jsonError("Neural audio is temporarily unavailable.", 503, 10);
  }
}
