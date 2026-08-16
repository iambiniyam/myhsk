import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const hskDir = path.join(root, "public", "content", "hsk");
const endpoint = "https://www.chinesetest.cn/api/hsk/outline/glossaryPage";
const syllabusUrl = "https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf";
const levelFiles = ["1", "2", "3", "4", "5", "6", "7-9"];

async function fetchGlossary(type) {
  const url = new URL(endpoint);
  url.searchParams.set("type", String(type));
  url.searchParams.set("current", "1");
  url.searchParams.set("size", "12000");
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "user-agent": "MyHSK/1.0 curriculum sync" },
  });
  if (!response.ok) throw new Error(`Official HSK glossary request failed: ${response.status}`);
  const payload = await response.json();
  if (payload.code !== 0 || !Array.isArray(payload.data?.records)) throw new Error("Official HSK glossary returned an unexpected response");
  return payload.data.records;
}

function canonicalWord(sourceWord) {
  return sourceWord.replace(/[0-9]+$/u, "");
}

function baseLevel(levelName) {
  if (levelName.startsWith("一级")) return "1";
  if (levelName.startsWith("二级")) return "2";
  if (levelName.startsWith("三级")) return "3";
  if (levelName.startsWith("四级")) return "4";
  if (levelName.startsWith("五级")) return "5";
  if (levelName.startsWith("六级")) return "6";
  return "7-9";
}

const existing = [];
for (const level of levelFiles) {
  existing.push(...JSON.parse(await readFile(path.join(hskDir, `level-${level}.json`), "utf8")));
}
const existingBySource = new Map(existing.map((entry) => [entry.sourceWord ?? entry.word, entry]));

let dictionary = [];
try {
  dictionary = JSON.parse(await readFile(path.join(root, "public", "content", "open-dictionary.json"), "utf8"));
} catch { /* Existing HSK enrichment remains sufficient when the optional dictionary is absent. */ }
const dictionaryByWord = new Map();
for (const entry of dictionary) {
  const candidates = dictionaryByWord.get(entry.word) ?? [];
  candidates.push(entry);
  dictionaryByWord.set(entry.word, candidates);
}

function normalizePinyin(value) {
  return String(value ?? "").normalize("NFC").toLowerCase().replace(/[\s'’·-]+/gu, "");
}

function findDictionaryEntry(word, pinyin) {
  const candidates = dictionaryByWord.get(word) ?? [];
  const target = normalizePinyin(pinyin);
  return candidates.find((entry) => normalizePinyin(entry.pinyin) === target) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

function mergeDefinitions(dictionaryEntry, prior) {
  const dictionaryDefinitions = dictionaryEntry?.definitions?.filter(Boolean) ?? [];
  const priorDefinitions = prior?.definitions?.filter(Boolean) ?? [];
  if (!dictionaryDefinitions.length) return priorDefinitions.length ? priorDefinitions : ["Definition not available in the open dictionary."];
  const dictionarySet = new Set(dictionaryDefinitions.map((definition) => definition.trim().toLowerCase()));
  const preferred = priorDefinitions.filter((definition) => dictionarySet.has(definition.trim().toLowerCase()));
  return [...new Set([...preferred, ...dictionaryDefinitions])];
}

const officialWords = await fetchGlossary(1);
if (officialWords.length !== 11000) throw new Error(`Expected 11,000 official HSK entries, received ${officialWords.length}`);

const byLevel = new Map(levelFiles.map((level) => [level, []]));
for (const record of officialWords) {
  const word = canonicalWord(record.word);
  const prior = existingBySource.get(record.word);
  const dictionaryEntry = findDictionaryEntry(word, record.pinyin);
  const level = baseLevel(record.levelName);
  byLevel.get(level).push({
    id: Number(record.id),
    level,
    word,
    sourceWord: record.word,
    pinyin: record.pinyin,
    partOfSpeech: record.cixing,
    traditional: dictionaryEntry?.traditional || prior?.traditional || "",
    definitions: mergeDefinitions(dictionaryEntry, prior),
    syllabusLevelName: record.levelName,
    syllabusSort: Number(record.sort),
    syllabusVersion: "2025-11",
    source: "Official HSK syllabus",
  });
}

for (const level of levelFiles) {
  await writeFile(path.join(hskDir, `level-${level}.json`), JSON.stringify(byLevel.get(level)));
}

const cultureRecords = await fetchGlossary(2);
const culture = cultureRecords.map((record) => {
  const dictionaryEntry = (dictionaryByWord.get(record.word) ?? [])[0];
  return {
    id: record.id,
    stage: record.levelName,
    word: record.word,
    pinyin: dictionaryEntry?.pinyin ?? "",
    category: record.cixing,
    traditional: dictionaryEntry?.traditional ?? "",
    definitions: dictionaryEntry?.definitions?.length ? dictionaryEntry.definitions : [],
    syllabusSort: Number(record.sort),
    syllabusVersion: "2025-11",
    source: "Official HSK syllabus",
  };
});
await writeFile(path.join(hskDir, "cultural-terms.json"), JSON.stringify(culture));

const counts = Object.fromEntries(levelFiles.map((level) => [level, byLevel.get(level).length]));
let cumulative = 0;
const cumulativeCounts = Object.fromEntries(levelFiles.map((level) => [level, cumulative += counts[level]]));
const manifest = {
  title: "Syllabus for the Chinese Proficiency Test",
  version: "2025-11",
  published: "2025-11",
  effective: "2026-07",
  sourceUrl: syllabusUrl,
  queryUrl: "https://www.chinesetest.cn/syllabus",
  syncedAt: new Date().toISOString(),
  coreEntries: officialWords.length,
  uniqueHeadwords: new Set(officialWords.map((entry) => canonicalWord(entry.word))).size,
  culturalTerms: culture.length,
  levelCounts: counts,
  cumulativeCounts,
};
await writeFile(path.join(hskDir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`✓ Official HSK ${manifest.version}: ${manifest.coreEntries.toLocaleString()} glossary entries, ${manifest.culturalTerms} cultural terms`);
console.log(`✓ Level entries: ${levelFiles.map((level) => `${level}: ${counts[level]}`).join(" · ")}`);
