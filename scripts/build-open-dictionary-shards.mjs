import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const SHARDS = 64;

// Must match wordDetailShard() in src/lib/content.ts (FNV-1a over code points).
function shardFor(word) {
  let hash = 2166136261;
  for (const character of word) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % SHARDS;
}

const openDictionary = JSON.parse(await readFile(path.join(content, "open-dictionary.json"), "utf8"));
const buckets = Array.from({ length: SHARDS }, () => ({}));
let uniqueWords = 0;
for (const entry of openDictionary) {
  const key = entry.word;
  if (!key) continue;
  buckets[shardFor(key)][key] = entry; // last entry per word wins, matching Map(...) semantics
}
const shardDir = path.join(content, "open-dictionary-shards");
await mkdir(shardDir, { recursive: true });
await Promise.all(buckets.map((bucket, shard) =>
  writeFile(path.join(shardDir, String(shard).padStart(2, "0") + ".json"), JSON.stringify(bucket)),
));
const sizes = buckets.map((bucket) => JSON.stringify(bucket).length);
console.log(`Open dictionary shards ready: ${openDictionary.length} entries, ${buckets.reduce((sum, b) => sum + Object.keys(b).length, 0)} unique words across ${SHARDS} shards.`);
console.log(`Largest shard: ${(Math.max(...sizes) / 1024).toFixed(0)}KB, smallest: ${(Math.min(...sizes) / 1024).toFixed(0)}KB, total: ${(sizes.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(1)}MB`);
