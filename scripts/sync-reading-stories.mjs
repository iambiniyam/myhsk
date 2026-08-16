import { readFile, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { resolve } from "node:path";
import { customPinyin, pinyin } from "pinyin-pro";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = resolve(ROOT, "public/content/reading-stories.json");
const POST_API = "https://hskreading.com/wp-json/wp/v2/posts";
const REQUEST_HEADERS = { "User-Agent": "MyHSK reading corpus sync/1.0 (noncommercial educational project)" };

customPinyin({
  "你得自己": "nǐ děi zì jǐ",
  "长成": "zhǎng chéng",
  "羊圈": "yáng juàn",
  "种的树": "zhòng de shù",
  "来我办公室一趟": "lái wǒ bàn gōng shì yí tàng",
});

const READING_MANIFEST = [
  { id: 6355, level: 1, theme: "Kindness" },
  { id: 6962, level: 1, theme: "Family" },
  { id: 6315, level: 1, theme: "Daily life" },
  { id: 5773, level: 1, theme: "Travel" },
  { id: 5011, level: 1, theme: "Friendship" },
  { id: 4437, level: 1, theme: "Daily life" },
  { id: 4433, level: 1, theme: "Daily life" },
  { id: 4782, level: 2, theme: "Modern life" },
  { id: 5179, level: 2, theme: "Family" },
  { id: 6644, level: 2, theme: "Fable" },
  { id: 6938, level: 2, theme: "Work" },
  { id: 6422, level: 2, theme: "Shopping" },
  { id: 5969, level: 2, theme: "Family" },
  { id: 5856, level: 2, theme: "Fable" },
  { id: 5758, level: 2, theme: "Shopping" },
  { id: 4760, level: 2, theme: "Dreams" },
  { id: 4755, level: 3, theme: "Growing up" },
  { id: 6541, level: 3, theme: "City life" },
  { id: 5985, level: 3, theme: "Daily life" },
  { id: 6629, level: 3, theme: "Idiom story" },
  { id: 6034, level: 3, theme: "Fable" },
  { id: 6964, level: 3, theme: "Family" },
  { id: 6369, level: 3, theme: "Family" },
  { id: 5939, level: 3, theme: "Friendship" },
  { id: 5849, level: 3, theme: "Idiom story" },
  { id: 5221, level: 3, theme: "Fable" },
  { id: 4421, level: 3, theme: "Daily life" },
  { id: 4361, level: 3, theme: "Daily life" },
  { id: 4997, level: 4, theme: "Work" },
  { id: 5048, level: 4, theme: "Family" },
  { id: 5082, level: 4, theme: "Holidays" },
  { id: 4119, level: 4, theme: "Family" },
  { id: 4218, level: 4, theme: "Modern life" },
  { id: 3302, level: 4, theme: "Health" },
];

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await new Promise((resolvePromise, reject) => {
        const request = get(url, { family: 4, headers: REQUEST_HEADERS, timeout: 30_000 }, (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`${url} returned ${response.statusCode}`));
            return;
          }
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { body += chunk; });
          response.on("end", () => {
            try { resolvePromise(JSON.parse(body)); }
            catch (error) { reject(error); }
          });
        });
        request.on("timeout", () => request.destroy(new Error(`${url} timed out`)));
        request.on("error", reject);
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1_000));
    }
  }
  throw lastError;
}

function decodeHtml(value) {
  const named = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " };
  return String(value ?? "")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/giu, (match, name) => named[name.toLowerCase()] ?? match);
}

function cleanText(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/gu, " "))
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function paragraphs(html) {
  const withLineBreaks = html.replace(/<br\s*\/?>/giu, "</p><p>");
  const matches = [...withLineBreaks.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
  if (matches.length) return matches;
  return cleanText(html).split(/(?<=[。！？.!?])\s+/u).filter(Boolean);
}

function firstHeading(html) {
  const match = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/iu);
  return match ? cleanText(match[1]) : "";
}

function sourceSections(post) {
  const html = post.content?.rendered ?? "";
  const heading = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/iu);
  if (!heading || heading.index === undefined) throw new Error(`Post ${post.id} has no Chinese title heading.`);
  const translationControl = html.indexOf("value='Translation'", heading.index + heading[0].length);
  if (translationControl < 0) throw new Error(`Post ${post.id} has no translation block.`);
  const hiddenTranslation = html.indexOf("<div id='bg-showmore-hidden", translationControl);
  const audioStart = html.indexOf("<audio", hiddenTranslation);
  if (hiddenTranslation < 0 || audioStart < 0) throw new Error(`Post ${post.id} has no aligned translation or audio.`);
  const chineseRegion = html.slice(heading.index + heading[0].length, translationControl);
  const translationRegion = html.slice(hiddenTranslation, audioStart);
  const chinese = paragraphs(chineseRegion).filter((text) => /\p{Script=Han}/u.test(text));
  const english = paragraphs(translationRegion).filter((text) => /\p{Script=Latin}/u.test(text));
  const audioMatch = html.slice(audioStart).match(/<source\b[^>]*\bsrc=["']([^"']+)["']/iu);
  if (!audioMatch) throw new Error(`Post ${post.id} has no source audio URL.`);
  return {
    chineseTitle: firstHeading(heading[0]),
    description: paragraphs(html.slice(0, heading.index)).join(" "),
    chinese,
    english,
    audioUrl: decodeHtml(audioMatch[1]).replace(/\?_=\d+$/u, ""),
  };
}

async function dictionaryIndex() {
  const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
  const files = levels.map((level) => resolve(ROOT, `public/content/hsk/level-${level}.json`));
  const collections = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const open = JSON.parse(await readFile(resolve(ROOT, "public/content/open-dictionary.json"), "utf8"));
  const words = new Map(open.map((entry) => [entry.word, entry]));
  for (const entries of collections) for (const entry of entries) {
    const previous = words.get(entry.word);
    const previousLevel = previous?.level === "7-9" ? 7 : Number(previous?.level ?? 99);
    const nextLevel = entry.level === "7-9" ? 7 : Number(entry.level);
    if (!previous || nextLevel < previousLevel) words.set(entry.word, entry);
  }
  const candidates = [...words.keys()].filter((word) => /\p{Script=Han}/u.test(word)).sort((a, b) => b.length - a.length);
  return { words, candidates };
}

function segmentChinese(text, dictionary) {
  const result = [];
  for (let index = 0; index < text.length;) {
    if (!/[\u3400-\u9fff]/u.test(text[index])) {
      index += 1;
      continue;
    }
    const match = dictionary.candidates.find((word) => text.startsWith(word, index));
    if (match) {
      result.push(match);
      index += match.length;
    } else {
      result.push(text[index]);
      index += 1;
    }
  }
  return result;
}

function pinyinFor(text) {
  const spokenNumbers = text.replace(/3月12日/gu, "三月十二日").replace(/1000块/gu, "一千块");
  return pinyin(spokenNumbers, { toneType: "symbol", type: "string" })
    .replace(/\s+([，。！？；：])/gu, "$1")
    .replace(/([“”])/gu, " $1 ")
    .replace(/\s+/gu, " ")
    .trim();
}

function alignedParagraphs(sections, postId) {
  if (sections.chinese.length !== sections.english.length) {
    throw new Error(`Post ${postId} has ${sections.chinese.length} Chinese and ${sections.english.length} English paragraphs.`);
  }
  return sections.chinese.map((chinese, index) => ({ chinese, english: sections.english[index] }));
}

async function main() {
  const dictionary = await dictionaryIndex();
  const stories = [];
  const skipped = [];
  for (const item of READING_MANIFEST) {
    try {
      const post = await fetchJson(`${POST_API}/${item.id}?_fields=id,link,title,content`);
      const sections = sourceSections(post);
      const aligned = alignedParagraphs(sections, post.id);
      const sentences = aligned.map((paragraph, paragraphIndex) => {
        const words = segmentChinese(paragraph.chinese, dictionary);
        return {
          id: `hskreading-${post.id}-${paragraphIndex + 1}`,
          chinese: paragraph.chinese,
          pinyin: pinyinFor(paragraph.chinese),
          english: paragraph.english,
          words,
        };
      });
      const characterCount = sentences.reduce((total, sentence) => total + (sentence.chinese.match(/\p{Script=Han}/gu)?.length ?? 0), 0);
      stories.push({
        id: `hskreading-${post.id}`,
        hskLevel: item.level,
        title: cleanText(post.title?.rendered),
        chineseTitle: sections.chineseTitle,
        description: sections.description || `A source-backed HSK ${item.level} reading with translation and audio.`,
        theme: item.theme,
        minutes: Math.max(2, Math.ceil(characterCount / 90)),
        audioUrl: sections.audioUrl,
        source: {
          name: "HSK Reading",
          url: post.link,
          license: "Source terms",
          sourceLevel: `HSK ${item.level} Reading Practice`,
          publisher: "HSK Reading",
          contributors: [],
        },
        sentences,
      });
    } catch (error) {
      skipped.push(`${item.id} (HSK ${item.level}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (stories.length < 4) throw new Error(`Only ${stories.length} candidate stories passed source alignment.\n${skipped.join("\n")}`);
  await writeFile(OUTPUT, `${JSON.stringify(stories, null, 2)}\n`);
  const paragraphCount = stories.reduce((total, story) => total + story.sentences.length, 0);
  console.log(`Synced ${stories.length} reviewed internet readings (${paragraphCount} aligned paragraphs) to ${OUTPUT}.`);
  console.log(stories.map((story) => `HSK ${story.hskLevel} · ${story.chineseTitle} · ${story.sentences.length} sections · ${story.audioUrl}`).join("\n"));
  if (skipped.length) console.log(`\nSkipped ${skipped.length}:\n${skipped.join("\n")}`);
}

await main();
