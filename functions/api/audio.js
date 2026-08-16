// Same-origin proxy for the open CosyVoice2 sentence pack (HuggingFace) and Tatoeba
// human recordings, so audio works in regions where those hosts are unreachable without
// a VPN. Only two fixed patterns are allowed; responses are cached at the Cloudflare edge.
const HF_BASE = "https://huggingface.co/datasets/no7z/hsk-sentences-audio/resolve/main/audio/";
const HF_FILE = /^hsk[1-6]-\d{4}(?:_slow)?\.mp3$/u;
const TATOEBA_BASE = "https://tatoeba.org/audio/download/";
const TATOEBA_ID = /^\d{1,12}$/u;
const HSKREADING_BASE = "https://hskreading.com/wp-content/uploads/";
const HSKREADING_FILE = /^\d{4}\/\d{2}\/[A-Za-z0-9._-]+\.(?:mp3|m4a|wav)$/u;

function jsonError(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const src = url.searchParams.get("src");
  const file = url.searchParams.get("file");
  const id = url.searchParams.get("id");

  let upstream;
  if (src === "hf" && file && HF_FILE.test(file)) upstream = HF_BASE + file;
  else if (src === "tatoeba" && id && TATOEBA_ID.test(id)) upstream = TATOEBA_BASE + id;
  else if (src === "hsr" && file && HSKREADING_FILE.test(file)) upstream = HSKREADING_BASE + file;
  else return jsonError("Invalid audio request.", 400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(upstream, {
      headers: { "user-agent": "MyHSK audio proxy/1.0", "accept": "audio/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return jsonError("Audio source unavailable.", response.status >= 500 ? 502 : 404);
    const type = response.headers.get("content-type") ?? "audio/mpeg";
    const body = await response.arrayBuffer();
    if (body.byteLength < 1024) return jsonError("Audio source returned an empty clip.", 502);
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return jsonError("Audio proxy is temporarily unavailable.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
