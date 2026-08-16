import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const content = path.join(root, "public", "content");
const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
const sourceUrl = "https://raw.githubusercontent.com/leonsilicon/subtlex-ch-wf/main/SUBTLEX-CH-WF.json";

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function downloadJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "MyHSK/1.0 SUBTLEX sync" },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

const hskWords = new Set((await Promise.all(levels.map(async (level) =>
  JSON.parse(await readFile(path.join(content, "hsk", `level-${level}.json`), "utf8")),
))).flat().map((entry) => entry.word));
const dataset = await downloadJson(sourceUrl);
const rows = Array.isArray(dataset.data) ? dataset.data : [];
const words = {};
let rank = 0;

for (const row of rows) {
  const word = String(row.Word ?? "").trim();
  if (!word) continue;
  rank += 1;
  if (!hskWords.has(word)) continue;
  words[word] = {
    rank,
    count: numberValue(row.WCount),
    perMillion: numberValue(row["W/million"]),
    contextCount: numberValue(row["W-CD"]),
    contextPercent: numberValue(row["W-CD%"]),
    logContextCount: numberValue(row["logW-CD"]),
  };
}

const metadata = dataset.metadata ?? {};
const corpusWords = numberValue(metadata.totalWordCount) || rows.reduce((sum, row) => sum + numberValue(row.WCount), 0);
const output = {
  generatedAt: new Date().toISOString(),
  source: "SUBTLEX-CH, Cai & Brysbaert (2010), subtitle corpus",
  sourceUrl,
  corpusWords,
  // The published paper reports 46.8M characters; the parsed package only exposes its token count.
  corpusCharacters: 46_800_000,
  contextCount: numberValue(metadata.contextNumber),
  words,
};

await writeFile(path.join(content, "word-frequency.json"), JSON.stringify(output));
console.log(`SUBTLEX-CH ready: ${Object.keys(words).length.toLocaleString()} HSK words matched.`);
