import type { CharacterCurriculumManifest, CharacterDetailData, CharacterEntry, CourseData, CharacterFamiliesData, CharacterIndexEntry, CulturalTerm, HskLevel, HskManifest, NetworkData, PriorityFeatures, ReadingStory, SentenceEntry, SpokenSentenceEntry, WordDetailData, WordEntry } from "../types";

let readingStoriesPromise: Promise<ReadingStory[]> | undefined;
let storyweaverStoriesPromise: Promise<ReadingStory[]> | undefined;
let networksPromise: Promise<NetworkData> | undefined;
const wordPromises = new Map<HskLevel, Promise<WordEntry[]>>();
let hskManifestPromise: Promise<HskManifest> | undefined;
let culturalTermsPromise: Promise<CulturalTerm[]> | undefined;
const wordDetailShardPromises = new Map<number, Promise<Record<string, WordDetailData>>>();
const WORD_DETAIL_SHARDS = 64;
let characterIndexPromise: Promise<CharacterIndexEntry[]> | undefined;
let characterFamiliesPromise: Promise<CharacterFamiliesData> | undefined;
let characterManifestPromise: Promise<CharacterCurriculumManifest> | undefined;
const characterDetailShardPromises = new Map<number, Promise<Record<string, CharacterDetailData>>>();
const CHARACTER_DETAIL_SHARDS = 64;

export function assetPath(path: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(assetPath(path));
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

export function loadWords(level: HskLevel): Promise<WordEntry[]> {
  const existing = wordPromises.get(level);
  if (existing) return existing;
  const file = level === "7-9" ? "level-7-9.json" : `level-${level}.json`;
  const promise = fetchJson<WordEntry[]>(`content/hsk/${file}`);
  wordPromises.set(level, promise);
  return promise;
}

export async function loadAllWords(): Promise<WordEntry[]> {
  const levels: HskLevel[] = ["1", "2", "3", "4", "5", "6", "7-9"];
  return (await Promise.all(levels.map(loadWords))).flat();
}

function levelsUpTo(maxLevel: number): HskLevel[] {
  const levels: HskLevel[] = [];
  for (let number = 1; number <= Math.min(6, maxLevel); number += 1) levels.push(String(number) as HskLevel);
  if (maxLevel >= 7) levels.push("7-9");
  return levels;
}

/** Loads only the HSK levels up to (and including) maxLevel — batch building no longer needs the full syllabus. */
export async function loadWordsUpTo(maxLevel: number): Promise<WordEntry[]> {
  return (await Promise.all(levelsUpTo(maxLevel).map(loadWords))).flat();
}

const priorityFeaturePromises = new Map<HskLevel, Promise<Record<string, PriorityFeatures>>>();

export function loadPriorityFeatures(level: HskLevel): Promise<Record<string, PriorityFeatures>> {
  const existing = priorityFeaturePromises.get(level);
  if (existing) return existing;
  const file = level === "7-9" ? "7-9" : level;
  const promise = fetchJson<Record<string, [number, number, number, number]>>(`content/priority-features/level-${file}.json`)
    .then((records) => {
      const converted: Record<string, PriorityFeatures> = {};
      for (const [word, values] of Object.entries(records)) converted[word] = { f: values[0], s: values[1], t: values[2], l: values[3] };
      return converted;
    })
    .catch(() => ({}));
  priorityFeaturePromises.set(level, promise);
  return promise;
}

/** Merged ranking features for every level up to maxLevel. */
export async function loadPriorityFeaturesUpTo(maxLevel: number): Promise<Record<string, PriorityFeatures>> {
  return Object.assign({}, ...(await Promise.all(levelsUpTo(maxLevel).map(loadPriorityFeatures))));
}

const HSK_SENTENCE_SHARDS = 16;
const SPOKEN_SENTENCE_SHARDS = 16;
const OPEN_DICTIONARY_SHARDS = 64;
let hskSentenceIndexPromise: Promise<Record<string, number[]>> | undefined;
const hskSentenceShardPromises = new Map<number, Promise<SentenceEntry[]>>();
let spokenSentenceIndexPromise: Promise<Record<string, number[]>> | undefined;
const spokenSentenceShardPromises = new Map<number, Promise<SpokenSentenceEntry[]>>();
const openDictionaryShardPromises = new Map<number, Promise<Record<string, WordEntry>>>();

function loadHskSentenceIndex(): Promise<Record<string, number[]>> {
  hskSentenceIndexPromise ??= fetchJson<Record<string, number[]>>("content/sentences/hsk-index.json").catch(() => ({}));
  return hskSentenceIndexPromise;
}

function loadSpokenSentenceIndex(): Promise<Record<string, number[]>> {
  spokenSentenceIndexPromise ??= fetchJson<Record<string, number[]>>("content/spoken-index.json").catch(() => ({}));
  return spokenSentenceIndexPromise;
}

async function loadIdShards<T extends { id: number }>(ids: Set<number>, basePath: string, cache: Map<number, Promise<T[]>>, shardCount: number): Promise<T[]> {
  const shardNumbers = new Set<number>();
  for (const id of ids) shardNumbers.add(id % shardCount);
  const shards = await Promise.all([...shardNumbers].map((shard) => {
    let promise = cache.get(shard);
    if (!promise) {
      promise = fetchJson<T[]>(`${basePath}/${String(shard).padStart(2, "0")}.json`).catch((error) => {
        cache.delete(shard);
        throw error;
      });
      cache.set(shard, promise);
    }
    return promise;
  }));
  const entries = (ids.size ? shards.flat().filter((entry) => ids.has(entry.id)) : shards.flat())
    // Preserve the original corpus order (ascending id) so example selection with tied
    // sort keys stays identical to loading the full sentence files.
    .sort((a, b) => a.id - b.id);
  return entries;
}

/**
 * Loads exactly the graded HSK sentences that can serve as examples for the given words
 * (from the offline word index) plus any explicit sentence ids (e.g. a network's set).
 * The candidate set is identical to loading content/sentences/hsk.json in full.
 */
export async function loadHskSentencesForWords(words: string[], extraIds: number[] = []): Promise<SentenceEntry[]> {
  const index = await loadHskSentenceIndex();
  const needed = new Set<number>(extraIds);
  for (const word of words) {
    for (const id of index[word] ?? []) needed.add(id);
  }
  return loadIdShards(needed, "content/sentences/hsk-shards", hskSentenceShardPromises, HSK_SENTENCE_SHARDS);
}

/** Loads exactly the spoken sprint sentences containing any of the given words. */
export async function loadSpokenSentencesForWords(words: string[]): Promise<SpokenSentenceEntry[]> {
  const index = await loadSpokenSentenceIndex();
  const needed = new Set<number>();
  for (const word of words) {
    for (const id of index[word] ?? []) needed.add(id);
  }
  return loadIdShards(needed, "content/spoken-shards", spokenSentenceShardPromises, SPOKEN_SENTENCE_SHARDS);
}

function openDictionaryShard(word: string): number {
  let hash = 2166136261;
  for (const character of word) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % OPEN_DICTIONARY_SHARDS;
}

/** Looks up a single CC-CEDICT entry, fetching only the shard that contains it. */
export async function loadOpenDictionaryWord(word: string): Promise<WordEntry | undefined> {
  const shard = openDictionaryShard(word);
  let promise = openDictionaryShardPromises.get(shard);
  if (!promise) {
    promise = fetchJson<Record<string, WordEntry>>(`content/open-dictionary-shards/${String(shard).padStart(2, "0")}.json`).catch((error) => {
      openDictionaryShardPromises.delete(shard);
      throw error;
    });
    openDictionaryShardPromises.set(shard, promise);
  }
  return (await promise)[word];
}

export function loadHskManifest(): Promise<HskManifest> {
  hskManifestPromise ??= fetchJson<HskManifest>("content/hsk/manifest.json");
  return hskManifestPromise;
}

export function loadCulturalTerms(): Promise<CulturalTerm[]> {
  culturalTermsPromise ??= fetchJson<CulturalTerm[]>("content/hsk/cultural-terms.json");
  return culturalTermsPromise;
}

function wordDetailShard(word: string): number {
  let hash = 2166136261;
  for (const character of word) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % WORD_DETAIL_SHARDS;
}

export async function loadWordDetail(word: string): Promise<WordDetailData | undefined> {
  const shard = wordDetailShard(word);
  let promise = wordDetailShardPromises.get(shard);
  if (!promise) {
    promise = fetchJson<Record<string, WordDetailData>>(`content/word-details/${String(shard).padStart(2, "0")}.json`).catch((error) => {
      wordDetailShardPromises.delete(shard);
      throw error;
    });
    wordDetailShardPromises.set(shard, promise);
  }
  return (await promise)[word];
}

export function loadCharacterIndex(): Promise<CharacterIndexEntry[]> {
  characterIndexPromise ??= fetchJson<CharacterIndexEntry[]>("content/character-curriculum/index.json");
  return characterIndexPromise;
}

export function loadCharacterFamilies(): Promise<CharacterFamiliesData> {
  characterFamiliesPromise ??= fetchJson<CharacterFamiliesData>("content/character-curriculum/families.json");
  return characterFamiliesPromise;
}

export function loadCharacterManifest(): Promise<CharacterCurriculumManifest> {
  characterManifestPromise ??= fetchJson<CharacterCurriculumManifest>("content/character-curriculum/manifest.json");
  return characterManifestPromise;
}

export async function loadCharacterDetail(character: string): Promise<CharacterDetailData | undefined> {
  let hash = 2166136261;
  hash ^= character.codePointAt(0) ?? 0;
  hash = Math.imul(hash, 16777619);
  const shard = (hash >>> 0) % CHARACTER_DETAIL_SHARDS;
  let promise = characterDetailShardPromises.get(shard);
  if (!promise) {
    promise = fetchJson<Record<string, CharacterDetailData>>(`content/character-curriculum/details/${String(shard).padStart(2, "0")}.json`).catch((error) => {
      characterDetailShardPromises.delete(shard);
      throw error;
    });
    characterDetailShardPromises.set(shard, promise);
  }
  return (await promise)[character];
}

export function loadReadingStories(): Promise<ReadingStory[]> {
  readingStoriesPromise ??= fetchJson<ReadingStory[]>("content/reading-stories.json");
  return readingStoriesPromise;
}

function loadStoryweaverStories(): Promise<ReadingStory[]> {
  storyweaverStoriesPromise ??= fetchJson<ReadingStory[]>("content/storyweaver-stories.json").catch(() => []);
  return storyweaverStoriesPromise;
}

export async function loadAllReadingStories(): Promise<ReadingStory[]> {
  const [curated, storyweaver] = await Promise.all([loadReadingStories(), loadStoryweaverStories()]);
  return [...curated, ...storyweaver];
}

let coursePromise: Promise<CourseData> | undefined;

export function loadCourse(): Promise<CourseData> {
  coursePromise ??= fetchJson<CourseData>("content/course.json");
  return coursePromise;
}

export function loadNetworks(): Promise<NetworkData> {
  networksPromise ??= fetchJson<NetworkData>("content/networks.json");
  return networksPromise;
}

export function chineseCharacters(text: string): string[] {
  return Array.from(new Set(Array.from(text).filter((char) => /[\u3400-\u9fff]/u.test(char))));
}

export function levelNumber(level: HskLevel): number {
  return level === "7-9" ? 7 : Number(level);
}
