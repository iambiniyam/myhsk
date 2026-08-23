import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "public/content/course.json");
const MAX_CHAPTER_WORDS = 9;
const COLLISION_RATIO = 0.4;

const MILESTONES = [
  { atWords: 60, label: "Order food & drinks" },
  { atWords: 140, label: "Introduce yourself and chat" },
  { atWords: 240, label: "Get around any city" },
  { atWords: 350, label: "Handle daily errands" },
  { atWords: 500, label: "Talk about work & plans" },
  { atWords: 700, label: "Follow real conversations" },
  { atWords: 950, label: "HSK 1–2 fully covered" },
  { atWords: 1300, label: "Share opinions & stories" },
  { atWords: 1800, label: "HSK 3 territory" },
  { atWords: 2400, label: "Read graded news" },
  { atWords: 3000, label: "Converse freely — HSK 4 wall broken" },
];

const KINDS = ["word-web", "scenario", "contrast", "meaning-family", "sound-family"];

/**
 * Pedagogy: within an HSK band, teach whole-meaning groups first (scenarios,
 * webs — easy to memorize because words support each other), then character/
 * sound families, and schedule synonym CONTRASTS last: discriminating 近义词
 * only sticks once both words are already familiar, and revisiting them is a
 * powerful retention booster (expanding retrieval).
 */
const KIND_ORDER = { scenario: 0, "word-web": 1, "meaning-family": 2, "sound-family": 3, contrast: 4 };

/** Curriculum phases shown on the trail so the 8-week arc is visible. */
const PHASES = [
  { atWords: 0, label: "Weeks 1–2 · Survival Mandarin" },
  { atWords: 180, label: "Weeks 3–4 · Everyday life" },
  { atWords: 450, label: "Weeks 5–6 · Getting things done" },
  { atWords: 900, label: "Weeks 7–8 · Real conversations" },
  { atWords: 1500, label: "Beyond · Broad fluency" },
];

async function json(file) {
  return JSON.parse(await readFile(resolve(ROOT, file), "utf8"));
}

function freqRank(frequency) {
  const cache = new Map();
  return (word) => {
    if (!cache.has(word)) cache.set(word, frequency.words[word]?.rank ?? 60_000);
    return cache.get(word);
  };
}

function chineseTitle(network) {
  const anchor = network.anchor ?? network.component ?? network.wordKeys[0] ?? "";
  return anchor.slice(0, 2) || network.title;
}

async function main() {
  const [networks, frequency] = await Promise.all([json("public/content/networks.json"), json("public/content/word-frequency.json")]);
  const rank = freqRank(frequency);
  const candidates = [];
  for (const kind of KINDS) {
    for (const network of networks[`${kind === "contrast" ? "contrastSets" : kind === "meaning-family" ? "meaningFamilies" : kind === "sound-family" ? "soundFamilies" : kind === "scenario" ? "scenarios" : "wordWebs"}`]) {
      const words = [...new Set(network.wordKeys.filter(Boolean))];
      if (words.length < 3) continue;
      const ranks = words.map(rank);
      const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
      const minLevel = network.minLevel ?? 1;
      candidates.push({ kind, network, words, avgRank, minLevel });
    }
  }
  candidates.sort((a, b) => a.minLevel - b.minLevel || a.avgRank - b.avgRank || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const usedWords = new Set();
  const chapters = [];
  const pass1 = candidates.filter((c) => c.kind !== "contrast");
  const pass2 = candidates.filter((c) => c.kind === "contrast");
  const ordered = [...pass1, ...pass2]; // contrasts close each level band
  for (const candidate of ordered) {
    if ((candidate.network.title ?? "").startsWith("Daily routines")) continue;
    const fresh = candidate.words.filter((word) => !usedWords.has(word));
    // Contrast sets consolidate words the learner already met elsewhere — allow
    // full reuse (that overlap IS the lesson). Other kinds must stay mostly fresh.
    const minFresh = candidate.kind === "contrast" ? 0 : 3;
    if (fresh.length < minFresh) continue;
    if (candidate.kind !== "contrast" && usedWords.size > 0 && fresh.length / candidate.words.length < 1 - COLLISION_RATIO) continue;
    // Slice big families into chapter-sized pieces, keeping frequency order inside.
    const ordered = [...candidate.words].sort((a, b) => rank(a) - rank(b));
    const keepCount = Math.min(ordered.length, Math.max(3, Math.round((fresh.length / candidate.words.length) * ordered.length)));
    const slice = ordered.slice(0, keepCount);
    for (let index = 0; index < slice.length; index += MAX_CHAPTER_WORDS) {
      const part = slice.slice(index, index + MAX_CHAPTER_WORDS);
      if (part.length < 3 && chapters.length) {
        chapters[chapters.length - 1].words.push(...part);
        continue;
      }
      const totalParts = Math.ceil(slice.length / MAX_CHAPTER_WORDS);
      const partNo = index / MAX_CHAPTER_WORDS + 1;
      const cumulative = chapters.reduce((total, entry) => total + entry.words.length, 0);
      const phase = [...PHASES].reverse().find((entry) => cumulative >= entry.atWords)?.label ?? PHASES[0].label;
      chapters.push({
        id: `ch-${String(chapters.length + 1).padStart(3, "0")}`,
        kind: candidate.kind,
        networkId: candidate.network.id,
        title: totalParts > 1 ? `${candidate.network.title} · ${partNo}/${totalParts}` : candidate.network.title,
        chineseTitle: chineseTitle(candidate.network),
        subtitle: candidate.network.subtitle ?? "",
        minLevel: candidate.minLevel,
        part: partNo,
        phase,
        words: part,
      });
      part.forEach((word) => usedWords.add(word));
    }
  }

  const wordTotal = chapters.reduce((total, chapter) => total + chapter.words.length, 0);
  const payload = { generatedAt: new Date().toISOString(), wordTotal, chapters, milestones: MILESTONES };
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Course ready: ${chapters.length} chapters · ${wordTotal} unique word slots → ${OUT}`);
  console.log(chapters.slice(0, 8).map((chapter) => `${chapter.id} [${chapter.kind}] ${chapter.title} (${chapter.words.length}w)`).join("\n"));
}

await main();
