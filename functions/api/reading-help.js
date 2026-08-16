const DEEPSEEK_BASE = "https://api.deepseek.com";
const MODEL = "deepseek-v4-flash";
const MAX_CHARS = 600;
const REQUEST_LIMIT = 20;
const WINDOW_MS = 60_000;
const requestWindows = new Map();

const MODE_PROMPTS = {
  explain: `You are a Chinese reading coach. Given a sentence from a graded story and the surrounding passage context, explain the sentence in clear English. Present the explanation as a JSON object.

{
  "title": "a short English title summarizing the explanation",
  "summary": "a plain-English explanation of the sentence, 1-3 sentences, using simple vocabulary appropriate for a language learner",
  "breakdown": [
    { "chinese": "phrase in Chinese characters", "pinyin": "pinyin with tone marks", "meaning": "English meaning of this phrase" }
  ],
  "tip": "one practical tip for using or remembering a word or structure from this sentence"
}

The breakdown should highlight the 2-4 most important words or phrases in the sentence. Do not repeat the full sentence as a breakdown item.`,

  grammar: `You are a Chinese grammar coach. Given a sentence from a graded story, isolate the 1-2 most useful grammar patterns and explain them. Present the result as a JSON object.

{
  "title": "a short English title naming the grammar point(s)",
  "summary": "a plain-English explanation of the grammar pattern(s) in this sentence, 1-2 sentences",
  "breakdown": [
    { "chinese": "the grammar construct in Chinese", "pinyin": "pinyin with tone marks", "meaning": "English translation of the example" }
  ],
  "tip": "one tip for recognizing or producing this grammar pattern"
}`,

  simplify: `You are a Chinese reading coach. Given a sentence from a graded story, rewrite it in simpler Chinese using more common words and shorter structures, keeping the same core meaning. Present the result as a JSON object.

{
  "title": "Simplified version",
  "summary": "the simplified Chinese sentence",
  "breakdown": [],
  "tip": "brief English explanation of what changed and why it is simpler"
}

The "summary" field must contain the simplified Chinese sentence, not English.`,

  quiz: `You are a Chinese reading coach. Given a sentence from a graded story, create one comprehension question that tests whether the learner understood the sentence. Present the result as a JSON object.

{
  "title": "Comprehension check",
  "summary": "a 1-sentence English description of what the question tests",
  "breakdown": [],
  "question": "an English comprehension question about the sentence that a learner should be able to answer after reading it"
}

The question must be answerable from the sentence alone. Do not ask about grammar rules or vocabulary definitions.`,
};

function jsonError(message, status, retryAfter) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return Response.json({ error: message }, { status, headers });
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

function validString(value, maxLength = 200) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

function validateInput(body) {
  const mode = validString(body?.mode, 12);
  if (!mode || !MODE_PROMPTS[mode]) return { error: "Valid mode is required: explain, grammar, simplify, or quiz." };
  const story = body?.story ?? {};
  const storyTitle = validString(story.chineseTitle, 80);
  if (!storyTitle) return { error: "A valid story title is required." };
  const hskLevel = Number(story.hskLevel);
  if (!Number.isInteger(hskLevel) || hskLevel < 1 || hskLevel > 6) return { error: "A valid HSK level 1-6 is required." };
  const passage = typeof story.passage === "string" ? story.passage.trim() : "";
  if (!passage || passage.length > MAX_CHARS) return { error: `Story passage must be 1-${MAX_CHARS} characters.` };
  const sentence = body?.sentence ?? {};
  const chinese = typeof sentence.chinese === "string" ? sentence.chinese.trim() : "";
  if (!chinese || chinese.length > MAX_CHARS) return { error: `Sentence must be 1-${MAX_CHARS} characters.` };
  const pinyin = validString(sentence.pinyin, 600);
  const english = validString(sentence.english, 600);
  let word;
  if (body.word) {
    const w = validString(body.word.word, 12);
    if (w && /\p{Script=Han}/u.test(w)) {
      word = { word: w, pinyin: validString(body.word.pinyin, 120), definitions: Array.isArray(body.word.definitions) ? body.word.definitions.slice(0, 5).filter((d) => typeof d === "string" && d.trim().length > 0) : [], mastery: Number(body.word.mastery) || 0 };
    }
  }
  return { mode, passage, chinese, pinyin, english, word, hskLevel };
}

function buildPrompt(mode, input) {
  let context = `Story: ${input.passage}\n\nSentence to focus on: ${input.chinese}`;
  if (input.pinyin) context += `\nPinyin: ${input.pinyin}`;
  if (input.english) context += `\nEnglish: ${input.english}`;
  if (input.word) {
    context += `\n\nLearner tapped the word "${input.word.word}"`;
    if (input.word.pinyin) context += ` (${input.word.pinyin})`;
    if (input.word.definitions.length) context += ` — definitions: ${input.word.definitions.join("; ")}`;
    context += input.word.mastery >= 0.72 ? " — this word is already strong for the learner." : input.word.mastery > 0 ? " — the learner is still acquiring this word." : " — the learner has not studied this word yet.";
  }
  context += `\n\nThe learner is approximately HSK ${input.hskLevel}. Use vocabulary at or near this level. Keep English explanations simple and concrete. Never invent Chinese words that are not in the given sentence.`;
  return `${MODE_PROMPTS[mode]}\n\n${context}`;
}

async function callDeepSeek(apiKey, prompt) {
  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Respond with the JSON object as specified." },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
      temperature: 0.2,
      stream: false,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`DeepSeek API returned ${response.status}: ${error?.error?.message || "unknown error"}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned an empty response.");
  return JSON.parse(content);
}

function validateResponse(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (typeof parsed.title !== "string" || typeof parsed.summary !== "string") return false;
  const breakdown = Array.isArray(parsed.breakdown) ? parsed.breakdown : [];
  if (!breakdown.every((item) => typeof item?.chinese === "string" && typeof item?.meaning === "string")) return false;
  return true;
}

async function cacheKey(request, mode, chinese) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reading-help-v1:${mode}:${chinese}`));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(`${new URL(request.url).origin}/__myhsk_reading_cache__/${hash}`, { method: "GET" });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (request.headers.get("X-MyHSK-Reading") !== "1") return jsonError("Invalid reading request.", 403);
  if (!isSameOrigin(request)) return jsonError("Invalid request origin.", 403);
  if (!allowRequest(request)) return jsonError("Please wait a moment before requesting more reading help.", 429, 60);

  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return jsonError("Reading assistance is not configured.", 503, 30);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON.", 400);
  }
  const input = validateInput(body);
  if (input.error) return jsonError(input.error, 400);

  const key = await cacheKey(request, input.mode, input.chinese);
  const cached = await caches.default.match(key);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("X-MyHSK-AI-Cache", "HIT");
    return response;
  }

  const prompt = buildPrompt(input.mode, input);
  let parsed;
  try {
    parsed = await callDeepSeek(apiKey, prompt);
  } catch (error) {
    console.error("DeepSeek reading help failed", error instanceof Error ? error.message : String(error));
    return jsonError("Reading assistance is temporarily unavailable. Dictionary and translations still work offline.", 503, 10);
  }

  if (!validateResponse(parsed)) {
    console.error("DeepSeek returned invalid reading help structure", JSON.stringify(parsed).slice(0, 400));
    return jsonError("AI response did not meet quality requirements.", 503, 5);
  }

  const result = {
    title: String(parsed.title),
    summary: String(parsed.summary),
    breakdown: (Array.isArray(parsed.breakdown) ? parsed.breakdown : []).map((item) => ({
      chinese: String(item.chinese ?? ""),
      pinyin: String(item.pinyin ?? ""),
      meaning: String(item.meaning ?? ""),
    })),
    tip: typeof parsed.tip === "string" ? parsed.tip : undefined,
    question: typeof parsed.question === "string" ? parsed.question : undefined,
  };

  const response = Response.json(result, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
  const cachedResponse = response.clone();
  context.waitUntil(caches.default.put(key, cachedResponse));
  return response;
}

export function onRequestGet() {
  return jsonError("Method not allowed.", 405);
}
