// Verifies the sharded-content invariant: the id-sharded sentence corpora and the
// hash-sharded open dictionary must behave identically to the full JSON files.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const content = path.join(process.cwd(), "public", "content");
let failures = 0;

// --- 1. HSK graded sentence shards: candidate + selection parity -----------------------
{
  const full = JSON.parse(await readFile(path.join(content, "sentences", "hsk.json"), "utf8"));
  const index = JSON.parse(await readFile(path.join(content, "sentences", "hsk-index.json"), "utf8"));
  const shardNames = (await readdir(path.join(content, "sentences", "hsk-shards"))).sort();
  const shards = await Promise.all(shardNames.map((n) => readFile(path.join(content, "sentences", "hsk-shards", n), "utf8").then(JSON.parse)));
  const shardById = new Map();
  for (const bucket of shards) for (const s of bucket) shardById.set(s.id, s);
  if (shardById.size !== full.length) { console.error("✗ hsk shards lost sentences"); failures++; }
  const networks = JSON.parse(await readFile(path.join(content, "networks.json"), "utf8"));
  for (const network of [...networks.wordWebs, ...networks.soundFamilies, ...networks.meaningFamilies, ...networks.scenarios, ...networks.contrastSets]) {
    const words = network.wordKeys.slice(0, 10);
    const needed = new Set(network.sentenceIds);
    for (const w of words) for (const id of index[w] ?? []) needed.add(id);
    const loaded = [];
    for (const id of needed) { const s = shardById.get(id); if (s) loaded.push(s); }
    loaded.sort((a, b) => a.id - b.id);
    for (const id of network.sentenceIds) if (!shardById.has(id)) { console.error("✗ missing network sentence", network.id, id); failures++; }
    for (const w of words) {
      const fullC = full.filter((s) => s.chinese.includes(w) || (s.words ?? []).includes(w)).map((s) => s.id).sort((a, b) => a - b);
      const loadedC = loaded.filter((s) => s.chinese.includes(w) || (s.words ?? []).includes(w)).map((s) => s.id).sort((a, b) => a - b);
      if (JSON.stringify(fullC) !== JSON.stringify(loadedC)) { console.error("✗ candidate mismatch", network.id, w); failures++; }
    }
    const targets = new Set(words);
    const sentenceMap = new Map(loaded.map((s) => [s.id, s]));
    const select = (corpus) => {
      const primary = (network.sentenceIds.map((id) => sentenceMap.get(id)).filter(Boolean)).sort((a, b) => {
        const ac = [...targets].reduce((sum, t) => sum + (a.chinese.includes(t) ? 1 : 0), 0);
        const bc = [...targets].reduce((sum, t) => sum + (b.chinese.includes(t) ? 1 : 0), 0);
        return bc - ac || a.chinese.length - b.chinese.length;
      });
      const selected = [...primary.slice(0, Math.max(4, Math.ceil(words.length / 2)))];
      const covered = new Set(words.filter((w) => selected.some((s) => s.chinese.includes(w))));
      for (const w of words) {
        if (covered.has(w)) continue;
        const example = corpus
          .filter((s) => !/[A-Za-z0-9@]/u.test(s.chinese) && s.chinese.length >= 4 && s.chinese.length <= 34 && (s.words?.includes(w) || s.chinese.includes(w)))
          .sort((a, b) => Number(a.source === "tatoeba") - Number(b.source === "tatoeba") || Math.abs(a.hskLevel - 1) - Math.abs(b.hskLevel - 1) || a.chinese.length - b.chinese.length)[0];
        if (example && !selected.some((s) => s.chinese === example.chinese)) selected.push(example);
      }
      return selected.map((s) => s.id).sort((a, b) => a - b).join(",");
    };
    if (select(full) !== select(loaded)) { console.error("✗ selection mismatch", network.id); failures++; }
  }
  console.log("✓ hsk sentence shards: candidate and selection parity across all networks");
}

// --- 2. Spoken sentence shards ---------------------------------------------------------
{
  const spoken = JSON.parse(await readFile(path.join(content, "spoken-sentences.json"), "utf8")).sentences ?? [];
  const index = JSON.parse(await readFile(path.join(content, "spoken-index.json"), "utf8"));
  const shardNames = (await readdir(path.join(content, "spoken-shards"))).sort();
  const shards = await Promise.all(shardNames.map((n) => readFile(path.join(content, "spoken-shards", n), "utf8").then(JSON.parse)));
  const shardById = new Map();
  for (const bucket of shards) for (const s of bucket) shardById.set(s.id, s);
  if (shardById.size !== spoken.length) { console.error("✗ spoken shards lost sentences"); failures++; }
  const words = ["工作", "喜欢", "咖啡", "老师", "大学", "谢谢", "高兴", "时间", "天气", "电脑"];
  const needed = new Set();
  for (const w of words) for (const id of index[w] ?? []) needed.add(id);
  const loaded = [];
  for (const id of needed) { const s = shardById.get(id); if (s) loaded.push(s); }
  loaded.sort((a, b) => a.id - b.id);
  for (const w of words) {
    const fullC = spoken.filter((s) => s.words.includes(w) || s.chinese.includes(w)).map((s) => s.id).sort((a, b) => a - b);
    const loadedC = loaded.filter((s) => s.words.includes(w) || s.chinese.includes(w)).map((s) => s.id).sort((a, b) => a - b);
    if (JSON.stringify(fullC) !== JSON.stringify(loadedC)) { console.error("✗ spoken candidate mismatch", w); failures++; }
  }
  const selectSprint = (corpus) => {
    const selected = [];
    const used = new Set();
    for (const w of words) {
      const best = corpus.filter((s) => !used.has(s.id) && s.hskLevel <= 6 && (s.words.includes(w) || s.chinese.includes(w)))
        .sort((a, b) => (b.utilityScore + Number(Boolean(b.audioNormal)) * 0.18) - (a.utilityScore + Number(Boolean(a.audioNormal)) * 0.18) || a.chinese.length - b.chinese.length)[0];
      if (!best) continue;
      selected.push(best);
      used.add(best.id);
      if (selected.length >= Math.min(4, words.length)) break;
    }
    return selected.map((s) => s.id).join(",");
  };
  if (selectSprint(spoken) !== selectSprint(loaded)) { console.error("✗ spoken sprint selection mismatch"); failures++; }
  console.log("✓ spoken sentence shards: candidate and sprint-selection parity");
}

// --- 3. Open dictionary shards: every entry resolves through the client hash -----------
{
  const full = JSON.parse(await readFile(path.join(content, "open-dictionary.json"), "utf8"));
  const shardNames = (await readdir(path.join(content, "open-dictionary-shards"))).sort();
  if (shardNames.length !== 64) { console.error("✗ expected 64 open-dictionary shards"); failures++; }
  const shards = await Promise.all(shardNames.map((n) => readFile(path.join(content, "open-dictionary-shards", n), "utf8").then(JSON.parse)));
  const clientShard = (word) => {
    let hash = 2166136261;
    for (const character of word) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
    return (hash >>> 0) % 64;
  };
  for (let i = 0; i < 5000; i++) {
    const entry = full[Math.floor(Math.random() * full.length)];
    if (!shards[clientShard(entry.word)]?.[entry.word]) { console.error("✗ open dictionary lookup miss", entry.word); failures++; break; }
  }
  const unique = shards.reduce((sum, shard) => sum + Object.keys(shard).length, 0);
  if (unique < 100000) { console.error("✗ open dictionary shards incomplete"); failures++; }
  console.log("✓ open dictionary shards: client-hash lookups resolve for " + unique.toLocaleString() + " unique words");
}

if (failures) { console.error("✗ sharding verification failed with " + failures + " errors"); process.exit(1); }
console.log("✓ sharding verification complete");
