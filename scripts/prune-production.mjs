import { rm } from "node:fs/promises";
import path from "node:path";

const dist = path.join(process.cwd(), "dist");
const sourceOnlyArtifacts = [
  "content/open-dictionary.json",
  "content/word-insights.json",
  "content/word-frequency.json",
  "content/lexical-evidence.json",
  "content/frequency.json",
  "content/sentences/hsk.json",
  "content/spoken-sentences.json",
  "content/sentences/tatoeba.json",
  "content/characters.json",
  "content/grammar.json",
  "content/readings.json",
];

await Promise.all(sourceOnlyArtifacts.map((artifact) => rm(path.join(dist, artifact), { recursive: true, force: true })));
console.log(`Production bundle pruned: ${sourceOnlyArtifacts.length} source-only curriculum artifacts excluded.`);
