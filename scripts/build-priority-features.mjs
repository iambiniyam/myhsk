import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const levelFiles = ["level-1.json", "level-2.json", "level-3.json", "level-4.json", "level-5.json", "level-6.json", "level-7-9.json"];
const outputDir = path.join(content, "priority-features");

// --- Exact copies of the ranking math in src/lib/curriculum.ts -------------------------
function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function chineseCharacters(text) {
  return Array.from(new Set(Array.from(text).filter((char) => /[\u3400-\u9fff]/u.test(char))));
}

function spokenUtility(wordFrequency, insight) {
  if (wordFrequency) {
    const rankValue = 1 - Math.min(1, Math.log10(Math.max(1, wordFrequency.rank)) / 5);
    const contextValue = Math.min(1, wordFrequency.contextPercent / 100);
    return rankValue * 0.55 + contextValue * 0.3 + Math.min(1, (insight?.sentenceCount ?? 0) / 12) * 0.15;
  }
  return Math.min(1, (insight?.contextCount ?? 0) / 8) * 0.7 + Math.min(1, (insight?.sentenceCount ?? 0) / 12) * 0.3;
}

function lexicalValue(evidence) {
  if (!evidence) return 0;
  const family = evidence.characterFamilySize === undefined ? 0 : clamp(Math.log1p(evidence.characterFamilySize) / Math.log1p(500));
  const soundFamily = evidence.phoneticFriends === undefined ? 0 : clamp(Math.log1p(evidence.phoneticFriends) / Math.log1p(400));
  const compositionality = evidence.conditionalProbability ?? 0;
  const mutualInformation = evidence.pointwiseMutualInformation === undefined ? 0 : clamp((evidence.pointwiseMutualInformation + 5) / 15);
  return family * 0.32 + soundFamily * 0.28 + compositionality * 0.25 + mutualInformation * 0.15;
}

function lexicalDifficulty(evidence) {
  if (!evidence) return 0;
  const distance = evidence.phonologicalDistance === undefined ? 0 : clamp((evidence.phonologicalDistance - 1) / 7.2);
  const strokes = evidence.strokes === undefined ? 0 : clamp(evidence.strokes / 30);
  const regularity = evidence.phoneticRegularity === undefined ? 0 : evidence.phoneticRegularity;
  const isolatedSound = evidence.phonologicalNeighbors === undefined ? 0 : 1 - clamp(Math.log1p(evidence.phonologicalNeighbors) / Math.log1p(25));
  return distance * 0.35 + strokes * 0.25 + (1 - regularity) * 0.2 + isolatedSound * 0.2;
}
// ---------------------------------------------------------------------------------------

const levels = await Promise.all(levelFiles.map(async (file) => ({
  level: file.replace(/^level-(.+)\.json$/, "$1"),
  words: JSON.parse(await readFile(path.join(content, "hsk", file), "utf8")),
})));
const frequency = JSON.parse(await readFile(path.join(content, "frequency.json"), "utf8"));
const wordFrequency = JSON.parse(await readFile(path.join(content, "word-frequency.json"), "utf8")).words ?? {};
const insights = JSON.parse(await readFile(path.join(content, "word-insights.json"), "utf8")).words ?? {};
const lexicalEvidence = JSON.parse(await readFile(path.join(content, "lexical-evidence.json"), "utf8")).words ?? {};

// One feature record per unique headword (identical wherever the word appears).
const byWord = new Map();
for (const { words } of levels) {
  for (const entry of words) {
    if (byWord.has(entry.word)) continue;
    const charRanks = chineseCharacters(entry.word).map((char) => frequency[char]?.rank ?? 9000);
    const averageRank = charRanks.length ? charRanks.reduce((a, b) => a + b, 0) / charRanks.length : 9000;
    const frequencyValue = 1 - Math.min(1, averageRank / 9000);
    const spoken = spokenUtility(wordFrequency[entry.word], insights[entry.word]);
    const transfer = lexicalValue(lexicalEvidence[entry.word]);
    const evidence = lexicalEvidence[entry.word];
    const learnability = evidence ? 1 - lexicalDifficulty(evidence) : 0.5;
    byWord.set(entry.word, [
      Number(frequencyValue.toFixed(5)),
      Number(spoken.toFixed(5)),
      Number(transfer.toFixed(5)),
      Number(learnability.toFixed(5)),
    ]);
  }
}

await mkdir(outputDir, { recursive: true });
let total = 0;
for (const { level, words } of levels) {
  const record = {};
  const seen = new Set();
  for (const entry of words) {
    if (seen.has(entry.word)) continue;
    seen.add(entry.word);
    const features = byWord.get(entry.word);
    if (features) record[entry.word] = features;
  }
  total += Object.keys(record).length;
  await writeFile(path.join(outputDir, `level-${level}.json`), JSON.stringify(record));
}
await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  words: byWord.size,
  featureFields: ["frequencyValue", "spokenValue", "transferValue", "learnability"],
  files: levelFiles.map((file) => `level-${file.replace(/^level-(.+)\.json$/, "$1")}.json`),
}));
console.log(`Priority features ready: ${byWord.size} unique headwords across ${levels.length} level files.`);
