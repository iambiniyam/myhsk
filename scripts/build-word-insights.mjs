import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const levelFiles = ["level-1.json", "level-2.json", "level-3.json", "level-4.json", "level-5.json", "level-6.json", "level-7-9.json"];
const wordEntries = (await Promise.all(levelFiles.map(async (file) => JSON.parse(await readFile(path.join(content, "hsk", file), "utf8"))))).flat();
const openDictionary = JSON.parse(await readFile(path.join(content, "open-dictionary.json"), "utf8"));
const hskSentences = JSON.parse(await readFile(path.join(content, "sentences", "hsk.json"), "utf8"));
const tatoebaSentences = JSON.parse(await readFile(path.join(content, "sentences", "tatoeba.json"), "utf8"));
const characters = JSON.parse(await readFile(path.join(content, "characters.json"), "utf8"));
const networks = JSON.parse(await readFile(path.join(content, "networks.json"), "utf8"));
let semanticRelations = { words: {} };
try { semanticRelations = JSON.parse(await readFile(path.join(content, "semantic-relations.json"), "utf8")); } catch { /* Optional open semantic layer. */ }
const sentences = [...hskSentences, ...tatoebaSentences];
const uniqueWords = [...new Set(wordEntries.map((entry) => entry.word))];
const sentenceIndex = new Map(sentences.map((sentence) => [sentence.id, sentence]));
const byToken = new Map();
const entriesByWord = new Map();
const openByWord = new Map(openDictionary.map((entry) => [entry.word, entry]));
const glossOverrides = new Map([
  ["的", "possessive particle"], ["了", "completed-action particle"], ["地", "adverb marker"], ["得", "complement marker"],
  ["着", "ongoing-action particle"], ["过", "have experienced"], ["是", "be"], ["有", "have"], ["在", "be at"],
  ["不", "not"], ["没", "not; have not"], ["没有", "not have"], ["会", "can; will"], ["能", "can"], ["要", "want; need"],
  ["还", "still; also"], ["和", "and; with"], ["给", "give; to"], ["对", "correct; toward"], ["可", "can"], ["并", "and; emphatically"],
  ["喝", "drink"], ["看", "look; watch; read"], ["行", "okay; go"], ["认识", "know; recognize"], ["爱", "love"], ["吃", "eat"],
]);

for (const entry of wordEntries) {
  if (!entriesByWord.has(entry.word)) entriesByWord.set(entry.word, []);
  entriesByWord.get(entry.word).push(entry);
}

for (const sentence of sentences) {
  for (const token of new Set(sentence.words ?? [])) {
    if (!byToken.has(token)) byToken.set(token, []);
    byToken.get(token).push(sentence);
  }
}

const cjkText = /^[\u3400-\u9fff]+$/u;
const weakNeighbors = new Set(["我", "你", "您", "他", "她", "它", "们", "我们", "你们", "他们", "她们", "的", "了", "着", "过", "吗", "呢", "吧", "啊", "呀", "和", "与", "也", "都", "这", "那", "这个", "那个", "一个", "一些", "但", "但是", "还是", "是", "有", "要", "会", "能", "可以", "需要", "如果", "是否", "没有"]);
const unsafeChunkEdges = new Set(["我", "你", "您", "他", "她", "它", "我们", "你们", "他们", "她们", "的", "了", "着", "过", "吗", "呢", "吧", "啊", "呀", "也", "都", "很", "真", "太", "更", "最", "个", "位", "张", "条", "次", "种", "些"]);
const grammarSignals = /[+（）()]|把|被|正在|已经|一边|越来越|虽然|但是|不仅|而且|除了|以外|比|得很|起来|下去|上来|连.+都|一.+就|只要|如果|因为|所以/u;
const detailShardCount = 64;

function levelNumber(level) { return level === "7-9" ? 7 : Number(level); }
function detailShard(word) {
  let hash = 2166136261;
  for (const character of word) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % detailShardCount;
}

function connectionFor(word) {
  const groups = [
    ["word-web", networks.wordWebs], ["scenario", networks.scenarios], ["contrast", networks.contrastSets],
    ["meaning-family", networks.meaningFamilies], ["sound-family", networks.soundFamilies],
  ];
  for (const [engine, candidates] of groups) {
    const network = candidates.find((candidate) => candidate.wordKeys.includes(word));
    if (network) return { engine, id: network.id, title: network.title, subtitle: network.subtitle, wordKeys: network.wordKeys };
  }
  return undefined;
}
function cleanSentence(sentence) { return !/[A-Za-z0-9@]/u.test(sentence.chinese) && sentence.chinese.length >= 4 && sentence.chinese.length <= 42; }
function usageBand(count) {
  if (count >= 100) return "very common";
  if (count >= 35) return "common";
  if (count >= 10) return "useful";
  if (count > 0) return "specialized";
  return "syllabus only";
}

function countTop(values, limit) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-CN")).slice(0, limit).map(([value, count]) => ({ value, count }));
}

function wordInfo(word) {
  const entries = entriesByWord.get(word) ?? [];
  const open = openByWord.get(word);
  return {
    pinyin: entries.find((entry) => entry.pinyin)?.pinyin ?? open?.pinyin ?? "",
    english: glossOverrides.get(word) ?? entries.flatMap((entry) => entry.definitions ?? []).find(Boolean) ?? open?.definitions?.find(Boolean) ?? "",
  };
}

function shortGloss(value) {
  return value.split(/[;(（]/)[0].replace(/^to\s+/i, "").trim().slice(0, 46);
}

function collocationsFor(word, source) {
  const counts = new Map();
  const add = (sentence, parts, weight) => {
    if (parts.some((part) => !cjkText.test(part)) || weakNeighbors.has(parts[0]) || weakNeighbors.has(parts.at(-1)) || unsafeChunkEdges.has(parts[0]) || unsafeChunkEdges.has(parts.at(-1))) return;
    const phrase = parts.join("");
    if (phrase.length < 2 || phrase.length > 8 || phrase === word || !sentence.chinese.includes(phrase)) return;
    const existing = counts.get(phrase) ?? { count: 0, parts };
    existing.count += weight;
    counts.set(phrase, existing);
  };
  for (const sentence of source) {
    const tokens = sentence.words ?? [];
    const weight = sentence.source === "tatoeba" ? 1 : 3;
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== word) continue;
      for (const [start, end] of [[index - 2, index + 1], [index - 1, index + 1], [index, index + 2], [index, index + 3], [index - 1, index + 2]]) {
        if (start >= 0 && end <= tokens.length) add(sentence, tokens.slice(start, end), weight);
      }
    }
  }
  const ranked = [...counts.entries()].filter(([phrase, data], _index, entries) => !entries.some(([other, otherData]) => other !== phrase && other.includes(phrase) && otherData.count >= data.count));
  return ranked
    .filter(([, data]) => data.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([phrase, data]) => {
      const exact = wordInfo(phrase);
      const partInfo = data.parts.map(wordInfo);
      const pinyin = exact.pinyin || partInfo.map((item) => item.pinyin).filter(Boolean).join(" ");
      const english = exact.english ? shortGloss(exact.english) : "";
      return { phrase, pinyin, english, count: data.count, wordKeys: data.parts.filter((part) => entriesByWord.has(part)) };
    })
    .filter((item) => item.pinyin && item.english);
}

function exampleScore(sentence, level) {
  const isHsk = sentence.source !== "tatoeba";
  const clean = cleanSentence(sentence);
  const distance = Math.abs((sentence.hskLevel || level) - level);
  const idealLength = Math.abs(sentence.chinese.length - 13);
  return (isHsk ? 120 : 25) + (clean ? 40 : -80) + Math.max(0, 24 - idealLength) + Math.max(0, 18 - distance * 5) + (sentence.grammarPoints?.length ? 6 : 0);
}

const output = {};
for (const word of uniqueWords) {
  const entries = entriesByWord.get(word) ?? [];
  const level = Math.min(...entries.map((entry) => levelNumber(entry.level)));
  const exact = byToken.get(word) ?? [];
  const clean = exact.filter(cleanSentence);
  const hsk = exact.filter((sentence) => sentence.source !== "tatoeba");
  const tatoeba = exact.filter((sentence) => sentence.source === "tatoeba");
  const topics = countTop(hsk.map((sentence) => sentence.topic).filter((topic) => topic && topic !== "misc"), 4)
    .map(({ value, count }) => ({ topic: value, count }));
  if (tatoeba.length && topics.length < 4) topics.push({ topic: "real-world examples", count: tatoeba.length });
  const grammarPoints = countTop(hsk.flatMap((sentence) => sentence.grammarPoints ?? []).filter((point) => grammarSignals.test(point)), 6)
    .map(({ value, count }) => ({ point: value, count }));
  const exampleIds = [...clean].sort((a, b) => exampleScore(b, level) - exampleScore(a, level) || a.chinese.length - b.chinese.length).slice(0, 14).map((sentence) => sentence.id);
  output[word] = {
    sentenceCount: exact.length,
    hskSentenceCount: hsk.length,
    openSentenceCount: tatoeba.length,
    contextCount: new Set(exact.map((sentence) => sentence.topic)).size,
    usageBand: usageBand(exact.length),
    topics,
    collocations: collocationsFor(word, clean),
    grammarPoints,
    exampleIds,
  };
}

for (const insight of Object.values(output)) insight.exampleIds = insight.exampleIds.filter((id) => sentenceIndex.has(id));

const data = {
  generatedAt: new Date().toISOString(),
  sourceCounts: { hskWords: uniqueWords.length, hskSentences: hskSentences.length, openSentences: tatoebaSentences.length },
  words: output,
};
await writeFile(path.join(content, "word-insights.json"), JSON.stringify(data));

const detailsDirectory = path.join(content, "word-details");
await rm(detailsDirectory, { recursive: true, force: true });
await mkdir(detailsDirectory, { recursive: true });
const detailShards = Array.from({ length: detailShardCount }, () => ({}));
for (const [word, insight] of Object.entries(output)) {
  const characterDetails = {};
  for (const character of new Set(Array.from(word).filter((value) => /[\u3400-\u9fff]/u.test(value)))) {
    if (characters[character]) characterDetails[character] = characters[character];
  }
  detailShards[detailShard(word)][word] = {
    insight,
    examples: insight.exampleIds.map((id) => sentenceIndex.get(id)).filter(Boolean).slice(0, 8),
    characters: characterDetails,
    connection: connectionFor(word),
    semanticRelations: [
      ...(semanticRelations.words?.[word]?.synonyms ?? []),
      ...(semanticRelations.words?.[word]?.hypernyms ?? []),
      ...(semanticRelations.words?.[word]?.hyponyms ?? []),
    ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 12),
  };
}
await Promise.all(detailShards.map((shard, index) => writeFile(
  path.join(detailsDirectory, `${String(index).padStart(2, "0")}.json`),
  JSON.stringify(shard),
)));
await writeFile(path.join(detailsDirectory, "manifest.json"), JSON.stringify({
  generatedAt: data.generatedAt,
  shardCount: detailShardCount,
  headwords: uniqueWords.length,
  examples: sentences.length,
}));
console.log(`Word details ready: ${uniqueWords.length.toLocaleString()} headwords in ${detailShardCount} on-demand shards.`);
