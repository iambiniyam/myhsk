import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const SHARDS = 16;
const levelFiles = ["level-1.json", "level-2.json", "level-3.json", "level-4.json", "level-5.json", "level-6.json", "level-7-9.json"];

// Full set of HSK headwords (any level) — these are the words batches ever search for.
const wordSet = new Set();
for (const file of levelFiles) {
  for (const entry of JSON.parse(await readFile(path.join(content, "hsk", file), "utf8"))) wordSet.add(entry.word);
}
const maxLen = Math.min(5, Math.max(...[...wordSet].map((word) => word.length)));

// Every contiguous Chinese substring (length 1..maxLen) of a sentence that is an HSK
// headword — exactly the candidate set chooseSentences/chooseSprintSentences search.
function containedWords(chinese) {
  const found = new Set();
  const chars = Array.from(chinese);
  for (let start = 0; start < chars.length; start += 1) {
    let candidate = "";
    for (let end = start; end < Math.min(chars.length, start + maxLen); end += 1) {
      candidate += chars[end];
      if (wordSet.has(candidate)) found.add(candidate);
    }
  }
  return found;
}

async function writeShards(prefix, indexPath, sentences, index) {
  const shardDir = path.join(content, prefix);
  await mkdir(shardDir, { recursive: true });
  const buckets = Array.from({ length: SHARDS }, () => []);
  for (const sentence of sentences) buckets[sentence.id % SHARDS].push(sentence);
  await Promise.all(buckets.map((bucket, shard) =>
    writeFile(path.join(shardDir, String(shard).padStart(2, "0") + ".json"), JSON.stringify(bucket)),
  ));
  await writeFile(path.join(content, indexPath), JSON.stringify(index));
  const totalBytes = buckets.reduce((sum, bucket) => sum + JSON.stringify(bucket).length, 0);
  return { sentences: sentences.length, indexEntries: Object.keys(index).length, shardBytes: totalBytes };
}

const hskSentences = JSON.parse(await readFile(path.join(content, "sentences", "hsk.json"), "utf8"));
const hskIndex = {};
for (const sentence of hskSentences) {
  for (const word of containedWords(sentence.chinese)) {
    (hskIndex[word] ??= []).push(sentence.id);
  }
}
const hsk = await writeShards("sentences/hsk-shards", path.join("sentences", "hsk-index.json"), hskSentences, hskIndex);

const spokenData = JSON.parse(await readFile(path.join(content, "spoken-sentences.json"), "utf8"));
const spokenSentences = spokenData.sentences ?? [];
const spokenIndex = {};
for (const sentence of spokenSentences) {
  for (const word of containedWords(sentence.chinese)) {
    (spokenIndex[word] ??= []).push(sentence.id);
  }
}
const spoken = await writeShards("spoken-shards", "spoken-index.json", spokenSentences, spokenIndex);

console.log("hsk shards:", hsk.sentences, "sentences,", hsk.indexEntries, "indexed words,", (hsk.shardBytes / 1024).toFixed(0) + "KB", "of shards");
console.log("spoken shards:", spoken.sentences, "sentences,", spoken.indexEntries, "indexed words,", (spoken.shardBytes / 1024).toFixed(0) + "KB", "of shards");
const indexBytes = JSON.stringify(hskIndex).length + JSON.stringify(spokenIndex).length;
console.log("combined index size:", (indexBytes / 1024 / 1024).toFixed(2) + "MB");
