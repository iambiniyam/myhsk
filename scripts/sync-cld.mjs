import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const content = path.join(root, "public", "content");
const levels = ["1", "2", "3", "4", "5", "6", "7-9"];
const sourceUrl = "https://chineselexicaldatabase.com/downloads/chineselexicaldatabase2.1.csv.zip";

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function average(values) {
  const present = values.filter((value) => value !== undefined);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : undefined;
}

function sum(values) {
  const present = values.filter((value) => value !== undefined);
  return present.length ? present.reduce((total, value) => total + value, 0) : undefined;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

async function loadCsv() {
  if (process.env.CLD_CSV) return readFile(process.env.CLD_CSV, "utf8");
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "mingbai-cld-"));
  const archive = path.join(temporaryDirectory, "cld.zip");
  try {
    const response = await fetch(sourceUrl, {
      headers: { "user-agent": "Mingbai-Open/1.0 CLD sync" },
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`${sourceUrl}: ${response.status}`);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    const { stdout } = await execFileAsync("unzip", ["-p", archive, "chineselexicaldatabase2.1.csv"], { maxBuffer: 80 * 1024 * 1024 });
    return stdout;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const hskWords = new Set((await Promise.all(levels.map(async (level) =>
  JSON.parse(await readFile(path.join(content, "hsk", `level-${level}.json`), "utf8")),
))).flat().map((entry) => entry.word));
const csv = await loadCsv();
const lines = csv.split(/\r?\n/u).filter(Boolean);
const headers = parseCsvLine(lines[0]);
const rows = lines.slice(1);
const records = {};

for (const line of rows) {
  const cells = parseCsvLine(line);
  const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  const word = String(row.Word ?? "").trim();
  if (!word || !hskWords.has(word)) continue;

  const characterFamilySize = sum(["C1FamilySize", "C2FamilySize", "C3FamilySize", "C4FamilySize"].map((field) => numberValue(row[field])));
  const phoneticRegularity = average(["C1PRRegularity", "C2PRRegularity", "C3PRRegularity", "C4PRRegularity"].map((field) => numberValue(row[field])));

  records[word] = {
    characterFamilySize: characterFamilySize ?? 0,
    phonologicalNeighbors: numberValue(row.PhonologicalN) ?? 0,
    phonologicalDistance: numberValue(row.PLD) ?? 0,
    strokes: numberValue(row.Strokes) ?? 0,
    ...(phoneticRegularity === undefined ? {} : { phoneticRegularity }),
    ...(sum(["C1PRFriends", "C2PRFriends", "C3PRFriends", "C4PRFriends"].map((field) => numberValue(row[field]))) === undefined ? {} : {
      phoneticFriends: sum(["C1PRFriends", "C2PRFriends", "C3PRFriends", "C4PRFriends"].map((field) => numberValue(row[field]))),
    }),
    ...(numberValue(row.PMI) === undefined ? {} : { pointwiseMutualInformation: numberValue(row.PMI) }),
    ...(numberValue(row.C12ConditionalProbability) === undefined ? {} : { conditionalProbability: numberValue(row.C12ConditionalProbability) }),
  };
}

const output = {
  generatedAt: new Date().toISOString(),
  source: "Chinese Lexical Database 2.1, derived HSK subset",
  sourceUrl,
  fields: [
    "characterFamilySize",
    "phonologicalNeighbors",
    "phonologicalDistance",
    "strokes",
    "phoneticRegularity",
    "phoneticFriends",
    "pointwiseMutualInformation",
    "conditionalProbability",
  ],
  words: records,
};

await writeFile(path.join(content, "lexical-evidence.json"), JSON.stringify(output));
console.log(`CLD ready: ${Object.keys(records).length.toLocaleString()} HSK words matched.`);
