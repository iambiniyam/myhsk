import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
const baseUrl = "https://downloads.tatoeba.org/exports/per_language";
const sources = {
  chinese: `${baseUrl}/cmn/cmn_sentences_detailed.tsv.bz2`,
  links: `${baseUrl}/cmn/cmn-eng_links.tsv.bz2`,
  english: `${baseUrl}/eng/eng_sentences.tsv.bz2`,
  pinyin: `${baseUrl}/cmn/cmn_transcriptions.tsv.bz2`,
  audio: `${baseUrl}/cmn/cmn_sentences_with_audio.tsv.bz2`,
};
const localOverrides = {
  chinese: process.env.TATOEBA_CMN_DETAILED,
  links: process.env.TATOEBA_CMN_ENG_LINKS,
  english: process.env.TATOEBA_ENG_SENTENCES,
  pinyin: process.env.TATOEBA_CMN_TRANSCRIPTIONS,
  audio: process.env.TATOEBA_CMN_AUDIO,
};
const toneVowels = {
  a: ["a", "ā", "á", "ǎ", "à"], e: ["e", "ē", "é", "ě", "è"], i: ["i", "ī", "í", "ǐ", "ì"],
  o: ["o", "ō", "ó", "ǒ", "ò"], u: ["u", "ū", "ú", "ǔ", "ù"], ü: ["ü", "ǖ", "ǘ", "ǚ", "ǜ"],
};

async function download(url, target) {
  const response = await fetch(url, { headers: { "user-agent": "MyHSK/1.0 spoken sentence sync" }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function forEachCompressedLine(file, callback) {
  const process = spawn("bzip2", ["-dc", file], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
  for await (const line of lines) await callback(line);
  const [code] = await once(process, "close");
  if (code !== 0) throw new Error(`Could not decompress ${file}`);
}

function markSyllable(raw) {
  const match = raw.match(/^([A-Za-züÜvV:]+)([1-5])$/u);
  if (!match) return raw.toLowerCase().replace(/u:|v/gu, "ü");
  let syllable = match[1].toLowerCase().replace(/u:|v/gu, "ü");
  const tone = Number(match[2]);
  if (tone === 5) return syllable;
  let index = syllable.indexOf("a");
  if (index < 0) index = syllable.indexOf("e");
  if (index < 0 && syllable.includes("ou")) index = syllable.indexOf("o");
  if (index < 0) index = [...syllable].reduce((found, character, characterIndex) => toneVowels[character] ? characterIndex : found, -1);
  if (index >= 0) syllable = `${syllable.slice(0, index)}${toneVowels[syllable[index]][tone]}${syllable.slice(index + 1)}`;
  return syllable;
}

function pinyinMarks(raw) {
  return (raw.match(/[A-Za-züÜvV:]+[1-5]|[,.!?;:]/gu) ?? []).map(markSyllable).join(" ").replace(/\s+([,.!?;:])/gu, "$1");
}

function levelNumber(level) {
  return level === "7-9" ? 7 : Number(level);
}

function createTrie(entries) {
  const rootNode = {};
  for (const entry of entries) {
    let node = rootNode;
    for (const character of entry.word) node = node[character] ??= {};
    node.entry = entry;
  }
  return rootNode;
}

function tokenize(text, trie) {
  const matched = [];
  for (let start = 0; start < text.length; start += 1) {
    let node = trie;
    let longest;
    let end = start;
    for (let cursor = start; cursor < Math.min(text.length, start + 6); cursor += 1) {
      node = node[text[cursor]];
      if (!node) break;
      if (node.entry) { longest = node.entry; end = cursor; }
    }
    if (longest) {
      matched.push(longest);
      start = end;
    }
  }
  return [...new Map(matched.map((entry) => [entry.word, entry])).values()];
}

const wordEntries = (await Promise.all(levels.map(async (level) => JSON.parse(await readFile(path.join(content, "hsk", `level-${level}.json`), "utf8"))))).flat();
const uniqueEntries = [...new Map(wordEntries.sort((a, b) => levelNumber(a.level) - levelNumber(b.level)).map((entry) => [entry.word, entry])).values()];
const frequency = JSON.parse(await readFile(path.join(content, "word-frequency.json"), "utf8").catch(() => "{\"words\":{}}"));
const trie = createTrie(uniqueEntries);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "myhsk-tatoeba-"));
const files = {};

try {
  for (const [key, url] of Object.entries(sources)) {
    files[key] = localOverrides[key] || path.join(temporaryDirectory, `${key}.tsv.bz2`);
    if (!localOverrides[key]) await download(url, files[key]);
  }

  const links = new Map();
  await forEachCompressedLine(files.links, (line) => {
    const [chineseId, englishId] = line.split("\t");
    if (!links.has(chineseId)) links.set(chineseId, []);
    if (links.get(chineseId).length < 5) links.get(chineseId).push(englishId);
  });

  const candidates = new Map();
  await forEachCompressedLine(files.chinese, (line) => {
    const [id, , chinese, author] = line.split("\t");
    const cjk = chinese?.match(/[\u3400-\u9fff]/gu) ?? [];
    if (!links.has(id) || cjk.length < 4 || cjk.length > 24 || /[A-Za-z0-9０-９@#]/u.test(chinese)) return;
    const words = tokenize(chinese, trie);
    const covered = words.reduce((sum, word) => sum + word.word.length, 0);
    if (words.length < 2 || covered / cjk.length < 0.62) return;
    candidates.set(id, { id, chinese, author, words, coverage: covered / cjk.length });
  });

  const pinyin = new Map();
  await forEachCompressedLine(files.pinyin, (line) => {
    const [id, , script, author, transcription] = line.split("\t");
    if (script !== "Latn" || !candidates.has(id) || pinyin.has(id)) return;
    const marked = pinyinMarks(transcription);
    if (marked) pinyin.set(id, { text: marked, author });
  });

  const humanAudio = new Map();
  await forEachCompressedLine(files.audio, (line) => {
    const [sentenceId, audioId, author, license, attributionUrl] = line.split("\t");
    if (!candidates.has(sentenceId) || humanAudio.has(sentenceId)) return;
    humanAudio.set(sentenceId, { audioId, author, license, attributionUrl });
  });

  const neededEnglish = new Set([...candidates.keys()].flatMap((id) => links.get(id) ?? []));
  const english = new Map();
  await forEachCompressedLine(files.english, (line) => {
    const [id, , text] = line.split("\t");
    if (!neededEnglish.has(id) || !text || text.length < 3 || text.length > 140 || /https?:|www\.|[@#$%^*]/iu.test(text)) return;
    english.set(id, text);
  });

  const records = [];
  const seenChinese = new Set();
  for (const candidate of candidates.values()) {
    const transcription = pinyin.get(candidate.id);
    const translations = (links.get(candidate.id) ?? []).map((id) => ({ id, text: english.get(id) })).filter((item) => item.text).sort((a, b) => a.text.length - b.text.length);
    if (!transcription || !translations.length || seenChinese.has(candidate.chinese)) continue;
    seenChinese.add(candidate.chinese);
    const ranks = candidate.words.map((entry) => frequency.words?.[entry.word]?.rank).filter(Number.isFinite);
    const spokenValue = ranks.length ? ranks.reduce((sum, rank) => sum + (1 - Math.min(1, Math.log10(Math.max(1, rank)) / 5)), 0) / ranks.length : 0.25;
    const cjkLength = (candidate.chinese.match(/[\u3400-\u9fff]/gu) ?? []).length;
    const lengthFit = 1 - Math.min(1, Math.abs(cjkLength - 10) / 16);
    const dialogueValue = /[？?！!]/u.test(candidate.chinese) ? 1 : 0.55;
    const recording = humanAudio.get(candidate.id);
    const utilityScore = spokenValue * 0.44 + candidate.coverage * 0.28 + lengthFit * 0.13 + dialogueValue * 0.07 + (recording ? 0.08 : 0);
    const hskLevel = Math.max(...candidate.words.map((entry) => levelNumber(entry.level)));
    records.push({
      id: 1_000_000 + Number(candidate.id),
      hskLevel,
      topic: "real Chinese",
      chinese: candidate.chinese,
      pinyin: transcription.text,
      english: translations[0].text,
      words: candidate.words.map((entry) => entry.word),
      grammarPoints: [],
      source: "tatoeba-live",
      utilityScore: Number(utilityScore.toFixed(4)),
      ...(recording ? { audioNormal: `https://tatoeba.org/audio/download/${recording.audioId}` } : {}),
      attribution: {
        chineseId: Number(candidate.id),
        chineseAuthor: candidate.author || "Tatoeba contributor",
        pinyinAuthor: transcription.author || undefined,
        translationId: Number(translations[0].id),
        ...(recording ? { audioId: Number(recording.audioId), audioAuthor: recording.author, audioLicense: recording.license || undefined, audioAttributionUrl: recording.attributionUrl || undefined } : {}),
        license: "CC BY 2.0 FR",
        url: `https://tatoeba.org/en/sentences/show/${candidate.id}`,
      },
    });
  }

  const selected = [];
  for (let level = 1; level <= 7; level += 1) selected.push(...records.filter((record) => record.hskLevel === level).sort((a, b) => b.utilityScore - a.utilityScore || a.chinese.length - b.chinese.length).slice(0, 700));
  selected.sort((a, b) => a.hskLevel - b.hskLevel || b.utilityScore - a.utilityScore);
  const output = {
    generatedAt: new Date().toISOString(),
    source: "Tatoeba weekly Mandarin-English exports",
    sourceUrls: sources,
    candidateCount: records.length,
    sentences: selected,
  };
  await writeFile(path.join(content, "spoken-sentences.json"), JSON.stringify(output));
  console.log(`Spoken sentences ready: ${selected.length.toLocaleString()} selected from ${records.length.toLocaleString()} clean online pairs.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
