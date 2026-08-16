import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const content = path.join(root, "public", "content");
const required = ["characters.json", "frequency.json", "word-frequency.json", "lexical-evidence.json", "spoken-sentences.json", "grammar.json", "readings.json", "sentences/hsk.json", "networks.json", "word-insights.json", "semantic-relations.json"];
let failures = 0;
const hskEntries = [];
for (const file of required) {
  try {
    const data = JSON.parse(await readFile(path.join(content, file), "utf8"));
    const count = Array.isArray(data) ? data.length : Object.keys(data).length;
    if (!count) throw new Error("empty");
    console.log(`✓ ${file}: ${count.toLocaleString()} top-level records`);
  } catch (error) { failures += 1; console.error(`✗ ${file}:`, error.message); }
}
for (const file of (await readdir(path.join(content, "hsk"))).filter((name) => /^level-(?:[1-6]|7-9)\.json$/.test(name))) {
  const words = JSON.parse(await readFile(path.join(content, "hsk", file), "utf8"));
  hskEntries.push(...words);
  if (!Array.isArray(words) || !words.every((word) => word.word && word.pinyin && Array.isArray(word.definitions) && word.definitions.some(Boolean))) { failures += 1; console.error(`✗ Invalid word data in ${file}`); }
  else console.log(`✓ hsk/${file}: ${words.length.toLocaleString()} words`);
}
try {
  const expectedPrimarySenses = [
    ["喝", "hē", "to drink"],
    ["还", "hái", "still"],
    ["大学", "dàxué", "university; college"],
    ["本", "běn", "classifier for books, periodicals, files etc"],
  ];
  for (const [word, pinyin, expected] of expectedPrimarySenses) {
    const entry = hskEntries.find((item) => item.word === word && item.pinyin === pinyin);
    if (!entry || entry.definitions[0] !== expected) throw new Error(`${word} ${pinyin} should begin with “${expected}”`);
  }
  console.log("✓ pronunciation-aware primary meanings pass regression checks");
} catch (error) { failures += 1; console.error("✗ Primary meaning quality:", error.message); }
try {
  const manifest = JSON.parse(await readFile(path.join(content, "hsk", "manifest.json"), "utf8"));
  const cultures = JSON.parse(await readFile(path.join(content, "hsk", "cultural-terms.json"), "utf8"));
  if (manifest.coreEntries !== 11000 || Object.values(manifest.levelCounts ?? {}).reduce((sum, count) => sum + count, 0) !== 11000) throw new Error("official glossary count is not 11,000");
  if (!Array.isArray(cultures) || cultures.length !== manifest.culturalTerms || !cultures.every((term) => term.word && term.category && term.stage)) throw new Error("cultural glossary is malformed");
  console.log(`✓ hsk/manifest.json: ${manifest.coreEntries.toLocaleString()} official entries, syllabus ${manifest.version}`);
  console.log(`✓ hsk/cultural-terms.json: ${cultures.length.toLocaleString()} cultural terms`);
} catch (error) { failures += 1; console.error("✗ Official HSK metadata:", error.message); }
try {
  const relations = JSON.parse(await readFile(path.join(content, "semantic-relations.json"), "utf8"));
  const records = Object.values(relations.words ?? {});
  if (records.length < 3000 || !records.every((record) => Array.isArray(record.synonyms) && record.synonyms.length > 0 && (Array.isArray(record.synsetIds) || Array.isArray(record.hypernyms) || Array.isArray(record.hyponyms)))) throw new Error("semantic relation coverage is incomplete");
  if (!relations.source?.includes("OpenHowNet")) throw new Error("OpenHowNet relations are not merged");
  const withHierarchy = records.filter((record) => Array.isArray(record.hypernyms) || Array.isArray(record.hyponyms));
  if (withHierarchy.length < 2000 || !withHierarchy.every((record) => [...(record.hypernyms ?? []), ...(record.hyponyms ?? [])].every((word) => typeof word === "string" && word.length >= 1))) throw new Error("OpenHowNet hypernym/hyponym coverage is incomplete");
  console.log(`✓ semantic relations: ${records.length.toLocaleString()} HSK words connected by sense (${withHierarchy.length.toLocaleString()} with OpenHowNet hypernym/hyponym links)`);
} catch (error) { failures += 1; console.error("✗ Semantic relations:", error.message); }
try {
  const frequency = JSON.parse(await readFile(path.join(content, "word-frequency.json"), "utf8"));
  const records = Object.values(frequency.words ?? {});
  if (records.length < 10000 || !frequency.source?.includes("SUBTLEX-CH") || !records.every((item) => Number.isInteger(item.rank) && item.rank > 0 && item.contextCount >= 0 && item.contextPercent >= 0)) throw new Error("spoken word frequency coverage is incomplete");
  console.log(`✓ spoken word frequency: ${records.length.toLocaleString()} HSK words with contextual diversity`);
} catch (error) { failures += 1; console.error("✗ Spoken word frequency:", error.message); }
try {
  const evidence = JSON.parse(await readFile(path.join(content, "lexical-evidence.json"), "utf8"));
  const records = Object.values(evidence.words ?? {});
  if (records.length < 10000 || !evidence.source?.includes("Chinese Lexical Database") || !records.every((item) => Number.isFinite(item.characterFamilySize) && Number.isFinite(item.phonologicalNeighbors) && Number.isFinite(item.phonologicalDistance) && Number.isFinite(item.strokes))) throw new Error("lexical evidence coverage is incomplete");
  console.log(`✓ CLD lexical evidence: ${records.length.toLocaleString()} HSK words with transfer and difficulty signals`);
} catch (error) { failures += 1; console.error("✗ CLD lexical evidence:", error.message); }
try {
  const spoken = JSON.parse(await readFile(path.join(content, "spoken-sentences.json"), "utf8"));
  const records = spoken.sentences ?? [];
  const humanAudio = records.filter((sentence) => sentence.audioNormal).length;
  if (records.length < 4000 || spoken.candidateCount < 40000 || humanAudio < 1000 || !records.every((sentence) => sentence.chinese && sentence.pinyin && sentence.english && sentence.words?.length >= 2 && Number.isFinite(sentence.utilityScore))) throw new Error("online spoken sentence coverage is incomplete");
  console.log(`✓ online spoken sentences: ${records.length.toLocaleString()} high-utility pairs, including ${humanAudio.toLocaleString()} human recordings`);
} catch (error) { failures += 1; console.error("✗ Online spoken sentences:", error.message); }
try {
  const insights = JSON.parse(await readFile(path.join(content, "word-insights.json"), "utf8"));
  const records = Object.values(insights.words ?? {});
  if (insights.sourceCounts?.hskWords !== 10896 || records.length !== 10896) throw new Error("expected insights for 10,896 HSK headwords");
  if (!records.every((item) => Number.isInteger(item.sentenceCount) && Number.isInteger(item.contextCount) && Array.isArray(item.collocations) && item.collocations.every((chunk) => !chunk.english.includes(" + ")) && Array.isArray(item.exampleIds))) throw new Error("word insight record is malformed or contains assembled glosses");
  console.log(`✓ word insights: ${records.length.toLocaleString()} headwords enriched from ${(insights.sourceCounts.hskSentences + insights.sourceCounts.openSentences).toLocaleString()} sentences`);
} catch (error) { failures += 1; console.error("✗ Word insights:", error.message); }
try {
  const manifest = JSON.parse(await readFile(path.join(content, "word-details", "manifest.json"), "utf8"));
  if (manifest.shardCount !== 64 || manifest.headwords !== 10896) throw new Error("detail manifest count is incorrect");
  const shards = await Promise.all(Array.from({ length: manifest.shardCount }, (_, index) => readFile(
    path.join(content, "word-details", `${String(index).padStart(2, "0")}.json`),
    "utf8",
  ).then(JSON.parse)));
  const records = shards.flatMap((shard) => Object.values(shard));
  if (records.length !== manifest.headwords) throw new Error(`found ${records.length} detail records; expected ${manifest.headwords}`);
  if (!records.every((detail) => detail.insight && Array.isArray(detail.examples) && detail.characters && detail.insight.collocations.every((chunk) => chunk.phrase && chunk.pinyin && chunk.english && Array.isArray(chunk.wordKeys)) && detail.examples.every((example) => example.chinese && example.pinyin && example.english))) throw new Error("a detail record is missing required learning data");
  console.log(`✓ word detail shards: ${records.length.toLocaleString()} complete, on-demand learning pages`);
} catch (error) { failures += 1; console.error("✗ Word detail shards:", error.message); }
try {
  const manifest = JSON.parse(await readFile(path.join(content, "character-curriculum", "manifest.json"), "utf8"));
  const index = JSON.parse(await readFile(path.join(content, "character-curriculum", "index.json"), "utf8"));
  const families = JSON.parse(await readFile(path.join(content, "character-curriculum", "families.json"), "utf8"));
  if (manifest.characters !== 3088 || manifest.shardCount !== 64 || index.length !== manifest.characters) throw new Error("expected all 3,088 HSK characters");
  if (!index.every((entry) => entry.char && entry.pinyin && entry.english && entry.level && Number.isInteger(entry.strokes) && entry.wordCount > 0)) throw new Error("character index contains incomplete entries");
  for (const kind of ["meaning", "sound", "visual"]) {
    if (!Array.isArray(families[kind]) || families[kind].length !== manifest.familyCounts[kind] || !families[kind].every((family) => family.id && family.component && family.members.length >= 2 && family.members.every((member) => member.pinyin && member.english))) throw new Error(`${kind} families are malformed`);
  }
  const shards = await Promise.all(Array.from({ length: manifest.shardCount }, (_, indexNumber) => readFile(path.join(content, "character-curriculum", "details", `${String(indexNumber).padStart(2, "0")}.json`), "utf8").then(JSON.parse)));
  const details = shards.flatMap((shard) => Object.values(shard));
  if (details.length !== manifest.characters || !details.every((detail) => detail.char && detail.pinyin && detail.definition && Array.isArray(detail.words) && detail.words.length > 0 && detail.words.every((word) => word.word && word.pinyin && word.english) && Array.isArray(detail.examples) && detail.examples.every((example) => example.chinese && example.pinyin && example.english))) throw new Error("character detail page is incomplete");
  console.log(`✓ character curriculum: ${details.length.toLocaleString()} complete reading pages across ${Object.values(manifest.familyCounts).reduce((sum, count) => sum + count, 0)} clue families`);
} catch (error) { failures += 1; console.error("✗ Character curriculum:", error.message); }
try {
  const networks = JSON.parse(await readFile(path.join(content, "networks.json"), "utf8"));
  const expected = { wordWebs: 150, soundFamilies: 15, meaningFamilies: 25, scenarios: 15, contrastSets: 8 };
  for (const [key, minimum] of Object.entries(expected)) {
    if (!Array.isArray(networks[key]) || networks[key].length < minimum) throw new Error(`${key} has ${networks[key]?.length ?? 0}; expected at least ${minimum}`);
    if (!networks[key].every((item) => item.id && item.title && item.wordKeys?.length >= 2 && item.sentenceIds?.length >= 1)) throw new Error(`${key} contains malformed packs`);
    if (!networks[key].every((item) => (item.collocations ?? []).every((chunk) => chunk.phrase && chunk.pinyin && chunk.english && Number.isInteger(chunk.count)))) throw new Error(`${key} contains an unverified natural chunk`);
    console.log(`✓ ${key}: ${networks[key].length.toLocaleString()} learning networks`);
  }
  const soundCoherence = networks.soundFamilies.filter((family) => family.coherence >= 0.5).length;
  if (soundCoherence !== networks.soundFamilies.length) throw new Error("sound family below coherence threshold");
  console.log("✓ sound families meet the 0.50 rhyme/final coherence threshold");
} catch (error) { failures += 1; console.error("✗ Network quality:", error.message); }
try {
  const manifest = JSON.parse(await readFile(path.join(content, "priority-features", "manifest.json"), "utf8"));
  if (manifest.words !== 10896 || manifest.featureFields.length !== 4) throw new Error("expected ranking features for 10,896 headwords");
  let features = 0;
  for (const file of manifest.files) {
    const records = JSON.parse(await readFile(path.join(content, "priority-features", file), "utf8"));
    const values = Object.values(records);
    if (!values.every((value) => Array.isArray(value) && value.length === 4 && value.every((number) => Number.isFinite(number)))) throw new Error(file + " contains malformed feature records");
    features += values.length;
  }
  if (features < 10896) throw new Error("expected at least 10,896 feature records, found " + features);
  console.log("✓ priority features: " + features.toLocaleString() + " precomputed ranking records across " + manifest.files.length + " level files");
} catch (error) { failures += 1; console.error("✗ Priority features:", error.message); }
try {
  const hskIndex = JSON.parse(await readFile(path.join(content, "sentences", "hsk-index.json"), "utf8"));
  const hskShards = (await readdir(path.join(content, "sentences", "hsk-shards"))).filter((name) => /^\d{2}\.json$/.test(name));
  const hskSentences = (await Promise.all(hskShards.map((name) => readFile(path.join(content, "sentences", "hsk-shards", name), "utf8").then(JSON.parse)))).flat();
  if (hskShards.length !== 16 || hskSentences.length < 4000 || !Object.keys(hskIndex).every((word) => Array.isArray(hskIndex[word]) && hskIndex[word].length > 0)) throw new Error("graded sentence shards are incomplete");
  if (!hskSentences.every((sentence) => sentence.id && sentence.chinese && sentence.pinyin && sentence.english && Array.isArray(sentence.words))) throw new Error("a graded sentence shard contains a malformed sentence");
  console.log("✓ graded sentence shards: " + hskSentences.length.toLocaleString() + " sentences across " + hskShards.length + " shards + word index");
} catch (error) { failures += 1; console.error("✗ Graded sentence shards:", error.message); }
try {
  const spokenIndex = JSON.parse(await readFile(path.join(content, "spoken-index.json"), "utf8"));
  const spokenShards = (await readdir(path.join(content, "spoken-shards"))).filter((name) => /^\d{2}\.json$/.test(name));
  const spokenSentences = (await Promise.all(spokenShards.map((name) => readFile(path.join(content, "spoken-shards", name), "utf8").then(JSON.parse)))).flat();
  if (spokenShards.length !== 16 || spokenSentences.length < 4000 || !Object.keys(spokenIndex).every((word) => Array.isArray(spokenIndex[word]) && spokenIndex[word].length > 0)) throw new Error("spoken sentence shards are incomplete");
  if (!spokenSentences.every((sentence) => sentence.id && sentence.chinese && sentence.pinyin && sentence.english && sentence.words?.length >= 2 && Number.isFinite(sentence.utilityScore))) throw new Error("a spoken sentence shard contains a malformed sentence");
  console.log("✓ spoken sentence shards: " + spokenSentences.length.toLocaleString() + " sentences across " + spokenShards.length + " shards + word index");
} catch (error) { failures += 1; console.error("✗ Spoken sentence shards:", error.message); }
try {
  const shardNames = (await readdir(path.join(content, "open-dictionary-shards"))).filter((name) => /^\d{2}\.json$/.test(name));
  if (shardNames.length !== 64) throw new Error("expected 64 open-dictionary shards");
  const entries = (await Promise.all(shardNames.map((name) => readFile(path.join(content, "open-dictionary-shards", name), "utf8").then(JSON.parse)))).flatMap((shard) => Object.values(shard));
  if (entries.length < 100000 || !entries.every((entry) => entry.word && entry.pinyin && Array.isArray(entry.definitions) && entry.definitions.some(Boolean))) throw new Error("open dictionary shards are incomplete");
  console.log("✓ open dictionary shards: " + entries.length.toLocaleString() + " searchable entries across " + shardNames.length + " on-demand shards");
} catch (error) { failures += 1; console.error("✗ Open dictionary shards:", error.message); }
if (failures) process.exit(1);
