import { gunzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const cedictUrl = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz";
const hanziUrl = "https://cdn.jsdelivr.net/gh/skishore/makemeahanzi@master/dictionary.txt";
const cowUrl = "https://bond-lab.github.io/cow/data/0.9/wn-data-cmn.tab";

async function download(url) {
  const response = await fetch(url, { headers: { "user-agent": "MyHSK/1.0 open-data sync" }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function syncChineseOpenWordnet() {
  const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
  const hskWords = new Set((await Promise.all(levels.map(async (level) =>
    JSON.parse(await readFile(path.join(content, "hsk", `level-${level}.json`), "utf8")),
  ))).flat().map((entry) => entry.word));
  const raw = (await download(cowUrl)).toString("utf8");
  const bySynset = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [synset, relation, lemma] = line.replace(/^\uFEFF/u, "").split("\t");
    if (relation !== "cmn:lemma" || !hskWords.has(lemma) || !/^[\u3400-\u9fff]{1,5}$/u.test(lemma)) continue;
    if (!bySynset.has(synset)) bySynset.set(synset, new Set());
    bySynset.get(synset).add(lemma);
  }
  const words = {};
  for (const [synset, members] of bySynset) {
    if (members.size < 2 || members.size > 12) continue;
    for (const word of members) {
      const record = words[word] ?? { synonyms: [], synsetIds: [] };
      record.synonyms.push(...[...members].filter((member) => member !== word));
      record.synsetIds.push(synset);
      words[word] = record;
    }
  }
  for (const record of Object.values(words)) {
    record.synonyms = [...new Set(record.synonyms)].slice(0, 12);
    record.synsetIds = [...new Set(record.synsetIds)];
  }
  await writeFile(path.join(content, "semantic-relations.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "Chinese Open Wordnet 0.9",
    license: "COW permissive license",
    words,
  }));
  return Object.keys(words).length;
}

const toneVowels = {
  a: ["a", "ā", "á", "ǎ", "à"], e: ["e", "ē", "é", "ě", "è"], i: ["i", "ī", "í", "ǐ", "ì"],
  o: ["o", "ō", "ó", "ǒ", "ò"], u: ["u", "ū", "ú", "ǔ", "ù"], ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
};
function markSyllable(raw) {
  const match = raw.match(/^([A-Za-züÜvV:]+)([1-5])$/);
  if (!match) return raw.replace(/u:/gi, "ü").replace(/v/gi, "ü");
  let syllable = match[1].toLowerCase().replace(/u:|v/g, "ü");
  const tone = Number(match[2]);
  if (tone === 5) return syllable;
  let index = syllable.indexOf("a");
  if (index < 0) index = syllable.indexOf("e");
  if (index < 0 && syllable.includes("ou")) index = syllable.indexOf("o");
  if (index < 0) {
    const vowels = [...syllable].map((char, i) => toneVowels[char] ? i : -1).filter((i) => i >= 0);
    index = vowels.at(-1) ?? -1;
  }
  if (index >= 0) syllable = `${syllable.slice(0, index)}${toneVowels[syllable[index]][tone]}${syllable.slice(index + 1)}`;
  return syllable;
}
function pinyinMarks(numbered) {
  return numbered.split(/\s+/).map(markSyllable).join(" ");
}

async function syncCedict() {
  const compressed = await download(cedictUrl);
  const text = gunzipSync(compressed).toString("utf8");
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)]\s+\/(.+)\/$/);
    if (!match) continue;
    const [, traditional, simplified, numbered, definitionText] = match;
    if (!/^[\u3400-\u9fff]{1,5}$/u.test(simplified)) continue;
    const definitions = definitionText.split("/").map((item) => item.trim()).filter(Boolean);
    if (!definitions.length || definitions.every((item) => /^(variant|old variant|see also|surname)\b/i.test(item))) continue;
    const pinyin = pinyinMarks(numbered);
    const key = `${simplified}\u0000${pinyin.toLowerCase().replace(/[\s'’·-]+/gu, "")}`;
    const existing = entries.get(key);
    if (existing) {
      existing.definitions = [...new Set([...existing.definitions, ...definitions])].slice(0, 16);
      continue;
    }
    entries.set(key, {
      id: 100000 + entries.size,
      level: "7-9",
      word: simplified,
      sourceWord: simplified,
      pinyin,
      traditional: traditional === simplified ? "" : traditional,
      definitions: definitions.slice(0, 16),
      source: "CC-CEDICT",
    });
  }
  const output = [...entries.values()];
  await writeFile(path.join(content, "open-dictionary.json"), JSON.stringify(output));
  return output.length;
}

async function syncHanzi() {
  const raw = (await download(hanziUrl)).toString("utf8");
  const currentPath = path.join(content, "characters.json");
  const current = JSON.parse(await readFile(currentPath, "utf8"));
  let merged = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    const char = entry.character;
    if (!char || !current[char]) continue;
    const target = current[char];
    if (!target.decomposition && entry.decomposition) { target.decomposition = entry.decomposition; merged += 1; }
    if (!target.radical && entry.radical) target.radical = entry.radical;
    if (!target.etymology && entry.etymology) target.etymology = entry.etymology;
  }
  await writeFile(currentPath, JSON.stringify(current));
  return merged;
}

const results = { generatedAt: new Date().toISOString(), sources: [] };
try {
  const count = await syncCedict();
  results.sources.push({ name: "CC-CEDICT", url: cedictUrl, license: "CC BY-SA 4.0", records: count, status: "ok" });
  console.log(`✓ CC-CEDICT: ${count.toLocaleString()} lookup entries`);
} catch (error) {
  results.sources.push({ name: "CC-CEDICT", url: cedictUrl, license: "CC BY-SA 4.0", records: 0, status: "failed", error: String(error) });
  console.warn("CC-CEDICT sync failed:", error.message);
}
try {
  const count = await syncHanzi();
  results.sources.push({ name: "Make Me a Hanzi", url: hanziUrl, license: "LGPL / Arphic Public License components", records: count, status: "ok" });
  console.log(`✓ Make Me a Hanzi: ${count.toLocaleString()} missing decompositions merged`);
} catch (error) {
  results.sources.push({ name: "Make Me a Hanzi", url: hanziUrl, license: "LGPL / Arphic Public License components", records: 0, status: "failed", error: String(error) });
  console.warn("Make Me a Hanzi sync failed:", error.message);
}
try {
  const count = await syncChineseOpenWordnet();
  results.sources.push({ name: "Chinese Open Wordnet", url: cowUrl, license: "COW permissive license", records: count, status: "ok" });
  console.log(`✓ Chinese Open Wordnet: ${count.toLocaleString()} HSK words linked by meaning`);
} catch (error) {
  results.sources.push({ name: "Chinese Open Wordnet", url: cowUrl, license: "COW permissive license", records: 0, status: "failed", error: String(error) });
  console.warn("Chinese Open Wordnet sync failed:", error.message);
}
await writeFile(path.join(content, "open-data-sources.json"), JSON.stringify(results, null, 2));
