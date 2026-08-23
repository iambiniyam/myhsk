import { readFile, writeFile } from "node:fs/promises";
import { customPinyin, pinyin } from "pinyin-pro";
import { get } from "node:https";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = process.env.STORYWEAVER_OUTPUT ?? resolve(ROOT, "public/content/storyweaver-stories.json");
const META_API = "https://storyweaver.org.in/node/api/v1/stories";
const READ_API = "https://storyweaver.org.in/api/v1/stories";

const REQUEST_HEADERS = {
  "User-Agent": process.env.STORYWEAVER_UA ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  locale: "en",
  ...(process.env.STORYWEAVER_COOKIE ? { Cookie: process.env.STORYWEAVER_COOKIE } : {}),
};

const ALLOWLIST = [
  // HSK 1
  { slug: "99713-xiaoxin-laohu-laile", hskLevel: 1, theme: "Animals", title: "小心！老虎来了！", publisher: "Pratham Books" },
  { slug: "577904-zhong-xingxing", hskLevel: 1, theme: "Fantasy", title: "种星星", publisher: "Singapore Book Council" },
  { slug: "19272-xian-zai-bu-xing", hskLevel: 1, theme: "Family", title: "现在不行，现在不行！", publisher: "StoryWeaver Community" },
  { slug: "21482-tai-da-le-tai-xiao-le", hskLevel: 1, theme: "Family", title: "太大了，太小了", publisher: "StoryWeaver Community" },
  { slug: "18743-pang-guo-wang-shou-gou", hskLevel: 1, theme: "Humor", title: "胖国王瘦狗", publisher: "StoryWeaver Community" },
  { slug: "20801-how-many", hskLevel: 1, theme: "Numbers", title: "多少", publisher: "StoryWeaver Community" },
  { slug: "18459-mandarin", hskLevel: 1, theme: "Friendship", title: "我的小伙伴", publisher: "StoryWeaver Community" },
  { slug: "18612-mang-lu-de-ma-yi", hskLevel: 1, theme: "Nature", title: "忙碌的蚂蚁", publisher: "StoryWeaver Community" },
  { slug: "577649-baba-de-aihao", hskLevel: 1, theme: "Food", title: "爸爸的爱好", publisher: "Singapore Book Council" },
  { slug: "577907-shuijiao-ba", hskLevel: 1, theme: "Bedtime", title: "睡觉吧", publisher: "Singapore Book Council" },
  // HSK 2
  { slug: "65113-xiaozhu-de-weiba-taopao-le", hskLevel: 2, theme: "Adventure", title: "小猪的尾巴逃跑了", publisher: "StoryWeaver Community" },
  { slug: "20012-qu-mai-shu", hskLevel: 2, theme: "Daily life", title: "去买书", publisher: "StoryWeaver Community" },
];

const REVIEW_QUEUE = [
  { slug: "92448-huihua-youxi", hskLevel: 2, theme: "Family", note: "mismatched quote marks on one page" },
  { slug: "19271-wo-de-yu-bu-wo-de-yu", hskLevel: 1, theme: "Fable", note: "one wrong-direction closing quote" },
  { slug: "18398-wo-men-yi-qi-qu-jiao-you", hskLevel: 1, theme: "Play", note: "ellipsis style 。。。 instead of ……" },
  { slug: "18449-mandarin", hskLevel: 1, theme: "Kindness", note: "淘淘大哭 likely typo for 嚎啕大哭" },
];

const REJECTED_DURING_QC = {
  "18867-fangzi": "text is Traditional Chinese despite the Simplified label",
  "99719-zhua-zhua-zhua": "machine-translation artifacts (她跳起来并且很重要)",
  "99717-women-lai-wan-ba": "awkward machine-translated glossary (加慢)",
  "99706-ji-wu-de-moli": "translation calques (点点头而问) and mixed half-width punctuation",
  "577900-yi-tuan-mianhua-tang": "all story pages are empty",
};

const TRADITIONAL_ONLY = new Set(
  [..."們來對說話學會後開關長門問見現馬鳥龍東車買賣書這邊時過還與為從兒條舊發顧貓腳隻雞樹葉聽寫讀讓謝歡體點頭髮廳灣漢個幾麼裡沒錢銀紙餓館廚廁臉髒褲襪"],
);

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await new Promise((resolvePromise, reject) => {
        const request = get(url, { family: 4, headers: REQUEST_HEADERS, timeout: 30_000 }, (response) => {
          if (response.statusCode !== 200) {
            const status = response.statusCode;
            response.resume();
            const hint = status === 403
              ? " (Cloudflare challenge; set STORYWEAVER_UA and STORYWEAVER_COOKIE=cf_clearance=… from a browser session)"
              : "";
            reject(new Error(`${url} returned ${status}${hint}`));
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
  const named = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ", hellip: "…" };
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

function paragraphs(pageHtml) {
  const withLineBreaks = pageHtml.replace(/<br\s*\/?>/giu, "</p><p>");
  const matches = [...withLineBreaks.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
    .map((match) => cleanText(match[1]))
    .filter((text) => /\p{Script=Han}/u.test(text));
  return matches.map(normalizeChinese);
}

function normalizeChinese(text) {
  return text
    .replace(/ +([，。！？；：、…”])/gu, "$1")
    .replace(/(?<=[\p{Script=Han}”])[?!](?= |$|[“\p{Script=Han}])/gu, (mark) => (mark === "?" ? "\uFF1F" : "\uFF01"))
    .replace(/ {2,}/gu, " ")
    .trim();
}

function hanCharacters(text) {
  return text.match(/\p{Script=Han}/gu) ?? [];
}

function traditionalRatio(sentences) {
  let total = 0;
  let flagged = 0;
  for (const sentence of sentences) {
    for (const char of sentence) {
      if (/[\u3400-\u9fff]/u.test(char)) {
        total += 1;
        if (TRADITIONAL_ONLY.has(char)) flagged += 1;
      }
    }
  }
  return total === 0 ? 0 : flagged / total;
}

function coverFrom(metaData) {
  const sizes = metaData?.coverImage?.sizes ?? [];
  const best = sizes[sizes.length - 1];
  return best?.url ?? undefined;
}

function contributors(metaData) {
  if (!metaData) return [];
  const people = [];
  for (const author of metaData.authors ?? []) {
    people.push({ name: author.name, role: metaData.isTranslation ? "Translator" : "Author" });
  }
  for (const illustrator of metaData.illustrators ?? []) {
    people.push({ name: illustrator.name, role: "Illustrator" });
  }
  return people;
}

async function dictionaryIndex() {
  const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
  const collections = await Promise.all(levels.map((level) => readFile(resolve(ROOT, `public/content/hsk/level-${level}.json`), "utf8").then(JSON.parse)));
  const open = JSON.parse(await readFile(resolve(ROOT, "public/content/open-dictionary.json"), "utf8"));
  const words = new Map(open.map((entry) => [entry.word, entry]));
  for (const entries of collections) for (const entry of entries) {
    const previous = words.get(entry.word);
    const previousLevel = previous?.level === "7-9" ? 7 : Number(previous?.level ?? 99);
    const nextLevel = entry.level === "7-9" ? 7 : Number(entry.level);
    if (!previous || nextLevel < previousLevel) words.set(entry.word, entry);
  }
  return [...words.keys()].filter((word) => /\p{Script=Han}/u.test(word)).sort((a, b) => b.length - a.length);
}

let dictionaryCandidates;
function segmentChinese(text) {
  const result = [];
  for (let index = 0; index < text.length;) {
    if (!/[\u3400-\u9fff]/u.test(text[index])) { index += 1; continue; }
    const match = dictionaryCandidates?.find((word) => text.startsWith(word, index));
    if (match) { result.push(match); index += match.length; } else { result.push(text[index]); index += 1; }
  }
  return result;
}

function pinyinFor(text) {
  return pinyin(text, { toneType: "symbol", type: "string" }).replace(/\s+([，。！？；：、“”])/gu, "$1").replace(/\s+/gu, " ").trim();
}

async function syncStory(entry) {
  // The meta endpoint requires browser session cookies; the read endpoint does not.
  // Fall back to allowlist metadata whenever meta is unavailable.
  const meta = await fetchJson(`${META_API}/${entry.slug}`).catch(() => undefined);
  const data = meta?.data;
  if (data) {
    const languageName = typeof data.language === "string" ? data.language : data.language?.name;
    if (languageName && languageName !== "Chinese (Simplified)") throw new Error(`unexpected language ${languageName}`);
  }

  const read = await fetchJson(`${READ_API}/${entry.slug}/read?ignore_count=true&source=`);
  const storyPages = (read.data?.pages ?? []).filter((page) => page.pageType === "StoryPage");
  const lines = storyPages.flatMap((page) => paragraphs(page.html));
  if (!lines.length) throw new Error("no Chinese text found on any StoryPage");

  const chineseTitle = cleanText(data?.name) || entry.title;
  const title = data?.originalStory?.name?.trim() || chineseTitle;
  const description = cleanText(data?.description) || `A StoryWeaver level ${read.data?.level ?? entry.hskLevel} story in Simplified Chinese.`;
  const sourceLevel = `StoryWeaver Level ${data?.level ?? read.data?.level ?? entry.hskLevel}`;
  const publisher = (typeof data?.publisher === "object" ? data?.publisher?.name : data?.publisher) ?? entry.publisher;

  const sentences = lines.map((chinese, index) => ({
    id: `sw-${entry.slug}-${index + 1}`,
    chinese,
    pinyin: pinyinFor(chinese),
    english: "",
    words: segmentChinese(chinese),
  }));

  const characterCount = sentences.reduce((total, sentence) => total + hanCharacters(sentence.chinese).length, 0);
  if (characterCount < 20) throw new Error(`only ${characterCount} Han characters extracted`);

  const ratio = traditionalRatio(sentences.flatMap((sentence) => sentence.chinese));
  if (ratio > 0.02) throw new Error(`${Math.round(ratio * 100)}% traditional-only characters; text is mislabeled`);

  return {
    id: `sw-${entry.slug}`,
    hskLevel: entry.hskLevel,
    title,
    chineseTitle,
    description,
    theme: entry.theme,
    minutes: Math.max(2, Math.ceil(characterCount / 90)),
    coverImage: coverFrom(data),
    source: {
      name: "StoryWeaver",
      url: `https://storyweaver.org.in/stories/${entry.slug}`,
      license: "CC BY 4.0",
      sourceLevel,
      publisher,
      contributors: contributors(data),
    },
    sentences,
  };
}

function selection() {
  const override = process.env.STORYWEAVER_SLUGS;
  if (!override) return ALLOWLIST;
  const wanted = new Set(override.split(",").map((slug) => slug.trim()).filter(Boolean));
  return ALLOWLIST.filter((entry) => wanted.has(entry.slug));
}

async function main() {
  const entries = selection();
  if (!entries.length) throw new Error("STORYWEAVER_SLUGS did not match any allowlist entry");
  dictionaryCandidates = await dictionaryIndex();
  const stories = [];
  const skipped = [];
  for (const entry of entries) {
    try {
      stories.push(await syncStory(entry));
      console.log(`ok ${entry.slug} (${stories.length})`);
    } catch (error) {
      skipped.push(`${entry.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!stories.length) throw new Error(`no stories synced\n${skipped.join("\n")}`);
  await writeFile(OUTPUT, `${JSON.stringify(stories, null, 2)}\n`);
  const sentenceCount = stories.reduce((total, story) => total + story.sentences.length, 0);
  console.log(`Synced ${stories.length} StoryWeaver stories (${sentenceCount} sentences) to ${OUTPUT}.`);
  console.log(stories.map((story) => `HSK ${story.hskLevel} · ${story.chineseTitle} · ${story.sentences.length} sections`).join("\n"));
  if (skipped.length) console.log(`\nSkipped ${skipped.length}:\n${skipped.join("\n")}`);
  if (stories.length < entries.length * 0.75) process.exitCode = 1;
}

await main();
