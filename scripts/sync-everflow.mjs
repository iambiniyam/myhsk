// EverFlow Mandarin (University of Colorado Boulder) → graded readings.
// CC BY-NC-SA 4.0 · intermediate–advanced texts with native narration.
// macOS maintainer tool: shells out to curl + textutil for DOCX extraction.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { customPinyin, pinyin } from "pinyin-pro";

const ROOT = process.cwd();
const OUT = resolve(ROOT, "public/content/everflow-stories.json");
const BASE = "https://www.colorado.edu/project/everflowmandarin";
const TMP = "/tmp/opencode/everflow-cache.docx";

const LESSONS = [
  { key: "L3a", docx: "L3%20%E8%AF%BE%E6%96%87%20S", audio: `${BASE}/media/359`, level: 5, theme: "Language", match: /^课文一\s*/, stop: "课文二" },
  { key: "L3b", docx: "L3%20%E8%AF%BE%E6%96%87%20S", audio: `${BASE}/media/363`, level: 5, theme: "Language", match: /^课文二\s*/, stop: null },
  { key: "L5", docx: "L5%20%E8%AF%BE%E6%96%87%20S", audio: `${BASE}/media/360`, level: 5, theme: "Education", match: null, stop: "本文选自" },
  { key: "L6", docx: "L6%20%E8%AF%BE%E6%96%87%20S", audio: `${BASE}/media/381`, level: 5, theme: "Internet culture", match: null, stop: "本文选自" },
  { key: "L7a", docx: "L7%20%E8%AF%BE%E6%96%87%20S", audio: `${BASE}/media/387`, level: 6, theme: "Culture", match: /^课文一\s*/, stop: "课文二" },
  { key: "L7b", docx: "L7%20%E8%AF%BE%E6%96%87%20S", audio: `${BASE}/media/388`, level: 6, theme: "Modern life", match: /^课文二\s*/, stop: null },
  { key: "L10", docx: "L10%20%E8%AF%BE%E6%96%87%20S", audio: `${BASE}/media/412`, level: 6, theme: "Environment", match: null, stop: "本文选自" },
];

async function extract(docxUrl) {
  let ok=false;
  for (let i=0;i<3 && !ok;i++){ try { execFileSync("curl", ["-sfL","--retry","3",docxUrl,"-o",TMP],{stdio:"pipe"}); ok=true; } catch { await new Promise(r=>setTimeout(r,1500)); } }
  if(!ok) throw new Error("download failed after retries");
  return execFileSync("textutil", ["-convert", "txt", "-stdout", TMP], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function clean(line) {
  let text = line.replace(/\u00a0|\u000c/g, " ");
  // Footnote digits: single digit glued after a Han character, not part of dates/quantities.
  text = text.replace(/(?<=[\u4e00-\u9fff])[1-9](?![0-9.年月日亿万百千%])/gu, "");
  // Ruby leftovers: tone-marked syllables glued mid-word (庙miào堂táng → 庙堂).
  text = text.replace(/(?<=[\u4e00-\u9fff])[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+(?=[\u4e00-\u9fff，。、；：""''？！（）…—]|$)/gu, "");
  return text.replace(/\s+/gu, " ").trim();
}

function hanziCount(text) {
  return (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
}

function parseReading(rawLines, lesson) {
  const lines = rawLines.map(clean).filter(Boolean);
  let startIndex = 0;
  let title;
  if (lesson.match) {
    startIndex = lines.findIndex((line) => lesson.match.test(line.replace(/^第[一二三四五六七八九十]+课\s*/, "")));
    if (startIndex === -1) throw new Error(`${lesson.key}: marker ${lesson.match} not found`);
  }
  title = lines[startIndex].replace(/^第[一二三四五六七八九十]+课\s*/, "").replace(/^课文[一二]\s*/, "").trim();
  const bodyStart = startIndex + 1;
  const endMarker = lines.findIndex((line, index) => index >= bodyStart && /本文选自|重点词汇/.test(line));
  const hardStop = lesson.stop && lesson.stop !== "本文选自"
    ? lines.findIndex((line, index) => index >= bodyStart && line.startsWith(lesson.stop))
    : -1;
  const end = Math.min(endMarker === -1 ? lines.length : endMarker, hardStop === -1 ? lines.length : hardStop);
  const paragraphs = lines.slice(bodyStart, end)
    .filter((line) => hanziCount(line) >= 20);
  if (paragraphs.length < 2) throw new Error(`${lesson.key}: only ${paragraphs.length} usable paragraphs`);
  return { title: title || lesson.key, paragraphs };
}

async function dictionaryCandidates() {
  const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
  const collections = await Promise.all(levels.map((level) => readFile(resolve(ROOT, `public/content/hsk/level-${level}.json`), "utf8").then(JSON.parse)));
  const open = JSON.parse(await readFile(resolve(ROOT, "public/content/open-dictionary.json"), "utf8"));
  const words = new Map(open.map((entry) => [entry.word, entry]));
  for (const entries of collections) for (const entry of entries) words.set(entry.word, entry);
  return [...words.keys()].filter((word) => /\p{Script=Han}/u.test(word)).sort((a, b) => b.length - a.length);
}

let candidatesCache;
function segment(text) {
  candidatesCache ??= [];
  const result = [];
  for (let index = 0; index < text.length;) {
    if (!/[\u3400-\u9fff]/u.test(text[index])) { index += 1; continue; }
    const match = candidatesCache.find((word) => text.startsWith(word, index));
    if (match) { result.push(match); index += match.length; } else { result.push(text[index]); index += 1; }
  }
  return result;
}

const pinyinFor = (text) => pinyin(text, { toneType: "symbol" }).replace(/\s+([，。！？；：、“”])/gu, "$1").trim();

async function main() {
  candidatesCache = await dictionaryCandidates();
  const stories = [];
  for (const lesson of LESSONS) {
    try {
      const raw = await extract(`${BASE}/${lesson.docx}`);
      const { title, paragraphs } = parseReading(raw.split(/\r?\n/), lesson);
      stories.push({
        id: `everflow-${lesson.key.toLowerCase()}`,
        hskLevel: lesson.level,
        title,
        chineseTitle: title,
        description: `University-authored reading from EverFlow Mandarin (CU Boulder), native narration included.`,
        theme: lesson.theme,
        minutes: Math.max(3, Math.ceil(paragraphs.reduce((total, line) => total + hanziCount(line), 0) / 160)),
        audioUrl: lesson.audio,
        source: {
          name: "EverFlow Mandarin",
          url: `${BASE}/`,
          license: "CC BY-NC-SA 4.0",
          sourceLevel: `HSK ${lesson.level}`,
          publisher: "University of Colorado Boulder",
          contributors: [{ name: "EverFlow Mandarin authors", role: "Author" }],
        },
        sentences: paragraphs.map((chinese, index) => ({
          id: `everflow-${lesson.key.toLowerCase()}-${index + 1}`,
          chinese, pinyin: pinyinFor(chinese), english: "", words: segment(chinese),
        })),
      });
      console.log(`ok ${lesson.key}: ${title} (${paragraphs.length} paras)`);
    } catch (error) {
      console.warn(`skip ${lesson.key}: ${error.message}`);
    }
  }
  if (stories.length < 5) throw new Error("too few EverFlow readings parsed");
  await writeFile(OUT, `${JSON.stringify(stories, null, 2)}\n`);
  console.log(`EverFlow ready: ${stories.length} readings → ${OUT}`);
}

await main();
