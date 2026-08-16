import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contentDir = path.join(root, "public", "content");
const strokeSource = path.join(root, "node_modules", "hanzi-writer-data");
const strokeTarget = path.join(contentDir, "strokes");

const levelFiles = ["level-1.json", "level-2.json", "level-3.json", "level-4.json", "level-5.json", "level-6.json", "level-7-9.json"];
const characters = new Set();
for (const file of levelFiles) {
  const words = JSON.parse(await readFile(path.join(contentDir, "hsk", file), "utf8"));
  for (const entry of words) for (const char of entry.word) if (/^[\u3400-\u9fff]$/u.test(char)) characters.add(char);
}
await mkdir(strokeTarget, { recursive: true });
let copied = 0;
try {
  await stat(strokeSource);
  await Promise.all([...characters].map(async (char) => {
    const source = path.join(strokeSource, `${char}.json`);
    try { await cp(source, path.join(strokeTarget, `${char}.json`)); copied += 1; } catch { /* uncommon extension characters may be absent */ }
  }));
} catch {
  console.warn("hanzi-writer-data is not installed; handwriting will require the package during the final build.");
}
const summary = { generatedAt: new Date().toISOString(), hskCharacters: characters.size, strokeFiles: copied };
await writeFile(path.join(contentDir, "build-summary.json"), JSON.stringify(summary, null, 2));
console.log(`Content ready: ${characters.size} HSK characters, ${copied} local stroke files.`);
