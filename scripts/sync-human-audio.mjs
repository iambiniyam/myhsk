import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const QUALITY = process.argv.includes("--quality") ? process.argv[process.argv.indexOf("--quality") + 1] : "64k";
const CONCURRENCY = process.argv.includes("--concurrency") ? Number(process.argv[process.argv.indexOf("--concurrency") + 1]) : 32;
const SOURCE_REPO = "hugolpz/audio-cmn";
const SOURCE_REVISION = "master";
const LEVEL_FILES = {
  "1": "level-1.json", "2": "level-2.json", "3": "level-3.json", "4": "level-4.json",
  "5": "level-5.json", "6": "level-6.json", "7-9": "level-7-9.json",
};
const OUTPUT = path.join(ROOT, "public", "audio", "human");
const MANIFEST = path.join(ROOT, "public", "human-audio-v1.json");

if (!new Set(["18k-abr", "24k-abr", "64k", "96k"]).has(QUALITY)) {
  throw new Error(`Unsupported quality: ${QUALITY}`);
}

function fileName(word) {
  return `${Buffer.from(word, "utf8").toString("hex")}.mp3`;
}

async function exists(file) {
  try { return (await stat(file)).size > 512; } catch { return false; }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "MyHSK audio sync" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function fetchAudio(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { headers: { "User-Agent": "MyHSK audio sync" }, signal: controller.signal });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = new Error(`${response.status} ${url}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) { lastError = error; }
    finally { clearTimeout(timeout); }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw lastError ?? new Error(`Could not download ${url}`);
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  const tree = await fetchJson(`https://api.github.com/repos/${SOURCE_REPO}/git/trees/${SOURCE_REVISION}?recursive=1`);
  if (tree.truncated) throw new Error("GitHub returned a truncated audio index.");
  const sourceRevision = tree.sha;
  const prefix = `${QUALITY}/hsk/cmn-`;
  const sourceByWord = new Map(tree.tree
    .filter((item) => item.type === "blob" && item.path.startsWith(prefix) && item.path.endsWith(".mp3"))
    .map((item) => [item.path.slice(prefix.length, -4), item.path]));

  const wordsByLevel = {};
  const allWords = new Set();
  for (const [level, file] of Object.entries(LEVEL_FILES)) {
    const entries = JSON.parse(await readFile(path.join(ROOT, "public", "content", "hsk", file), "utf8"));
    wordsByLevel[level] = new Set(entries.map((entry) => entry.word));
    for (const word of wordsByLevel[level]) allWords.add(word);
  }
  const matched = [...allWords].filter((word) => sourceByWord.has(word)).sort((a, b) => a.localeCompare(b, "zh-CN"));
  let completed = 0;
  let downloaded = 0;
  const errors = [];

  async function download(word) {
    const destination = path.join(OUTPUT, fileName(word));
    if (!(await exists(destination))) {
      const sourcePath = sourceByWord.get(word);
      const sourceUrl = `https://raw.githubusercontent.com/${SOURCE_REPO}/${sourceRevision}/${sourcePath.split("/").map(encodeURIComponent).join("/")}`;
      const bytes = await fetchAudio(sourceUrl);
      if (bytes.length <= 512) throw new Error(`Empty audio: ${word}`);
      const temporary = `${destination}.${createHash("sha1").update(word).digest("hex").slice(0, 8)}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, destination);
      downloaded += 1;
    }
    completed += 1;
    if (completed % 250 === 0 || completed === matched.length) process.stdout.write(`\rAudio ready: ${completed}/${matched.length}`);
  }

  let cursor = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < matched.length) {
      const word = matched[cursor++];
      try { await download(word); } catch (error) { errors.push(`${word}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }));
  process.stdout.write("\n");
  if (errors.length) throw new Error(`Failed to download ${errors.length} recordings:\n${errors.slice(0, 20).join("\n")}`);

  const coverage = Object.fromEntries(Object.entries(wordsByLevel).map(([level, words]) => {
    const count = [...words].filter((word) => sourceByWord.has(word)).length;
    return [level, { recordings: count, headwords: words.size, percent: Number((count / words.size * 100).toFixed(1)) }];
  }));
  await writeFile(MANIFEST, `${JSON.stringify({
    version: 1,
    source: `https://github.com/${SOURCE_REPO}`,
    sourceRevision,
    speaker: "Yue Tan",
    curator: "Hugo Lopez / PLIDAM, INALCO",
    license: "CC BY-SA",
    quality: QUALITY,
    recordings: matched.length,
    totalHeadwords: allWords.size,
    coverage,
    words: matched,
  }, null, 2)}\n`, "utf8");
  console.log(`Human Mandarin audio synced: ${matched.length}/${allWords.size} headwords; ${downloaded} files downloaded.`);
}

await main();
