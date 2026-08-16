import type {
  AppState,
  BaseNetwork,
  LearningBatch,
  LearningEngine,
  MasteryRecord,
  NetworkData,
  NetworkKind,
  PriorityFeatures,
  SentenceEntry,
  SpokenSentenceEntry,
  WordEntry,
  WordWebNetwork,
} from "../types";
import { chineseCharacters, levelNumber, loadHskSentencesForWords, loadNetworks, loadPriorityFeaturesUpTo, loadSpokenSentencesForWords, loadWordsUpTo } from "./content";
import { itemKey } from "./storage";

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed || 1;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function masteryAverage(record?: MasteryRecord): number {
  if (!record) return 0;
  const values = Object.values(record.skills).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function wordPriority(word: WordEntry, state: AppState, features: Record<string, PriorityFeatures>): number {
  const progress = state.mastery[itemKey("word", word.word)];
  const mastery = masteryAverage(progress);
  const unseenBonus = progress?.lastSeenAt ? 0 : 0.34;
  // Frequency, spoken, transfer, and learnability signals are precomputed offline per word
  // (see scripts/build-priority-features.mjs) so batch building no longer downloads the
  // full ranking corpora. The formulas are identical to the originals.
  const feature = features[word.word];
  const frequencyValue = feature?.f ?? 0;
  const productivity = Math.min(1, word.word.length / 3);
  const spokenValue = feature?.s ?? 0;
  const transferValue = feature?.t ?? 0;
  const learnability = feature?.l ?? 0.5;
  if (state.preferences.learningGoal === "fluency") {
    return (1 - mastery) * 0.38 + (progress?.lastSeenAt ? 0 : 0.3) + spokenValue * 0.42 + transferValue * 0.18 + learnability * 0.08 + frequencyValue * 0.08 + productivity * 0.06;
  }
  const levelGap = Math.abs(levelNumber(word.level) - levelNumber(state.preferences.level));
  const syllabusFit = levelGap === 0 ? 1 : levelGap === 1 ? 0.45 : 0;
  return (1 - mastery) * 0.4 + unseenBonus + syllabusFit * 0.18 + frequencyValue * 0.14 + spokenValue * 0.2 + transferValue * 0.08 + productivity * 0.05;
}

function dueReviews(state: AppState): MasteryRecord[] {
  const now = Date.now();
  return Object.values(state.mastery)
    .filter((item) => new Date(item.dueAt).getTime() <= now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .slice(0, 24);
}

function resolveEngine(engine: LearningEngine, round: number): NetworkKind {
  if (engine === "word-web" || engine === "scenario" || engine === "contrast") return engine;
  const rotation: NetworkKind[] = ["word-web", "scenario", "word-web", "contrast", "scenario"];
  return rotation[round % rotation.length];
}

function networksForKind(data: NetworkData, kind: NetworkKind): BaseNetwork[] {
  if (kind === "word-web") return data.wordWebs;
  if (kind === "sound-family") return data.soundFamilies;
  if (kind === "meaning-family") return data.meaningFamilies;
  if (kind === "scenario") return data.scenarios;
  return data.contrastSets;
}

function networkPriority(
  network: BaseNetwork,
  allWords: WordEntry[],
  state: AppState,
  features: Record<string, PriorityFeatures>,
): number {
  const byText = new Map(allWords.map((word) => [word.word, word]));
  const priorities = network.wordKeys
    .map((key) => byText.get(key))
    .filter((word): word is WordEntry => Boolean(word))
    .map((word) => wordPriority(word, state, features))
    .sort((a, b) => b - a);
  if (!priorities.length) return 0;
  const top = priorities.slice(0, Math.min(8, priorities.length));
  const dueCount = network.wordKeys.filter((word) => {
    const record = state.mastery[itemKey("word", word)];
    return record && new Date(record.dueAt).getTime() <= Date.now();
  }).length;
  const unseenRatio = network.wordKeys.filter((word) => !state.mastery[itemKey("word", word)]?.lastSeenAt).length / network.wordKeys.length;
  return top.reduce((sum, value) => sum + value, 0) / top.length + dueCount * 0.08 + unseenRatio * 0.06;
}

function chooseNetwork(
  data: NetworkData,
  kind: NetworkKind,
  state: AppState,
  round: number,
  seed: string,
  allWords: WordEntry[],
  features: Record<string, PriorityFeatures>,
): BaseNetwork {
  const all = networksForKind(data, kind);
  const maxLevel = levelNumber(state.preferences.level) + Number(state.preferences.learningGoal === "fluency");
  const wordLevels = new Map<string, number>();
  for (const word of allWords) wordLevels.set(word.word, Math.min(wordLevels.get(word.word) ?? 7, levelNumber(word.level)));
  const levelPool = all.filter((network) => network.minLevel <= maxLevel && network.wordKeys.filter((word) => (wordLevels.get(word) ?? 7) <= maxLevel).length >= 4);
  const recent = new Set(state.learning.recentNetworks.slice(0, 40));
  const fresh = levelPool.filter((network) => !recent.has(network.id));
  const pool = fresh.length >= 3 ? fresh : levelPool.length ? levelPool : all;
  const pinned = state.preferences.selectedNetworkId
    ? all.find((network) => network.id === state.preferences.selectedNetworkId)
    : undefined;
  if (pinned) return pinned;
  const dueWordKeys = new Set(dueReviews(state).filter((item) => item.kind === "word").map((item) => item.text));
  if (dueWordKeys.size) {
    const dueNetworks = pool
      .map((network) => ({ network, dueCount: network.wordKeys.reduce((count, word) => count + Number(dueWordKeys.has(word)), 0) }))
      .filter((item) => item.dueCount > 0)
      .sort((a, b) => b.dueCount - a.dueCount);
    if (dueNetworks.length) {
      const bestCount = dueNetworks[0].dueCount;
      return seededShuffle(dueNetworks.filter((item) => item.dueCount === bestCount).map((item) => item.network), hashString(`${seed}:due:${round}:${kind}`))[0];
    }
  }
  const scored = pool.map((network) => ({
    network,
    score: networkPriority(network, allWords, state, features),
    tieBreak: hashString(`${seed}:${round}:${kind}:${network.id}`) / 0xffffffff,
  }));
  scored.sort((a, b) => b.score - a.score || b.tieBreak - a.tieBreak);
  return scored[0]?.network ?? all[0];
}

function rankNetworkWords(
  network: BaseNetwork,
  allWords: WordEntry[],
  state: AppState,
  features: Record<string, PriorityFeatures>,
): WordEntry[] {
  const byText = new Map<string, WordEntry>();
  for (const word of allWords) {
    const current = byText.get(word.word);
    if (!current || levelNumber(word.level) < levelNumber(current.level)) byText.set(word.word, word);
  }
  const maxLevel = levelNumber(state.preferences.level) + Number(state.preferences.learningGoal === "fluency");
  const resolved = network.wordKeys.map((key) => byText.get(key)).filter((word): word is WordEntry => Boolean(word));
  return [...resolved].sort((a, b) => {
    const aBeyondLevel = levelNumber(a.level) > maxLevel ? 1 : 0;
    const bBeyondLevel = levelNumber(b.level) > maxLevel ? 1 : 0;
    const aSeen = state.mastery[itemKey("word", a.word)]?.lastSeenAt ? 1 : 0;
    const bSeen = state.mastery[itemKey("word", b.word)]?.lastSeenAt ? 1 : 0;
    return aBeyondLevel - bBeyondLevel || aSeen - bSeen || wordPriority(b, state, features) - wordPriority(a, state, features);
  });
}

function chooseWords(
  network: BaseNetwork,
  allWords: WordEntry[],
  state: AppState,
  features: Record<string, PriorityFeatures>,
): { words: WordEntry[]; reviewWordKeys: string[] } {
  const ranked = rankNetworkWords(network, allWords, state, features);
  const dueKeys = new Set(dueReviews(state).filter((item) => item.kind === "word").map((item) => item.text));
  const due = ranked.filter((word) => dueKeys.has(word.word));
  const roundSize = Math.max(4, Math.min(40, state.preferences.roundWords));
  const selected = [...due, ...ranked.filter((word) => !dueKeys.has(word.word))].slice(0, roundSize);
  return { words: selected, reviewWordKeys: selected.filter((word) => dueKeys.has(word.word)).map((word) => word.word) };
}

function chooseSentences(network: BaseNetwork, sentenceMap: Map<number, SentenceEntry>, allSentences: SentenceEntry[], words: WordEntry[]): SentenceEntry[] {
  const targets = new Set(words.map((word) => word.word));
  const primary = network.sentenceIds
    .map((id) => sentenceMap.get(id))
    .filter((sentence): sentence is SentenceEntry => Boolean(sentence))
    .sort((a, b) => {
      const aCoverage = [...targets].reduce((sum, target) => sum + (a.chinese.includes(target) ? 1 : 0), 0);
      const bCoverage = [...targets].reduce((sum, target) => sum + (b.chinese.includes(target) ? 1 : 0), 0);
      return bCoverage - aCoverage || a.chinese.length - b.chinese.length;
    });
  const selected = [...primary.slice(0, Math.max(4, Math.ceil(words.length / 2)))];
  const covered = new Set(words.filter((word) => selected.some((sentence) => sentence.chinese.includes(word.word))).map((word) => word.word));
  for (const word of words) {
    if (covered.has(word.word)) continue;
    const example = allSentences
      .filter((sentence) => !/[A-Za-z0-9@]/u.test(sentence.chinese) && sentence.chinese.length >= 4 && sentence.chinese.length <= 34 && (sentence.words?.includes(word.word) || sentence.chinese.includes(word.word)))
      .sort((a, b) => Number(a.source === "tatoeba") - Number(b.source === "tatoeba") || Math.abs(a.hskLevel - levelNumber(word.level)) - Math.abs(b.hskLevel - levelNumber(word.level)) || a.chinese.length - b.chinese.length)[0];
    if (example && !selected.some((sentence) => sentence.chinese === example.chinese)) selected.push(example);
  }
  return selected.slice(0, Math.min(12, Math.max(6, words.length + 2)));
}

function chooseSprintSentences(sentences: SpokenSentenceEntry[], words: WordEntry[], maxLevel: number): SpokenSentenceEntry[] {
  const selected = [];
  const used = new Set<number>();
  for (const word of words) {
    const best = sentences
      .filter((sentence) => !used.has(sentence.id) && sentence.hskLevel <= maxLevel + 1 && (sentence.words.includes(word.word) || sentence.chinese.includes(word.word)))
      .sort((a, b) => (b.utilityScore + Number(Boolean(b.audioNormal)) * 0.18) - (a.utilityScore + Number(Boolean(a.audioNormal)) * 0.18) || a.chinese.length - b.chinese.length)[0];
    if (!best) continue;
    selected.push(best);
    used.add(best.id);
    if (selected.length >= Math.min(4, words.length)) break;
  }
  return selected;
}

function anchorFor(network: BaseNetwork): string | undefined {
  if ("anchor" in network) return (network as WordWebNetwork).anchor;
  return undefined;
}

export async function buildLearningBatch(state: AppState, round = 0, seed = "open"): Promise<LearningBatch> {
  const maxLevel = levelNumber(state.preferences.level) + Number(state.preferences.learningGoal === "fluency");
  // Only the levels the learner can meet, plus compact precomputed ranking features,
  // are downloaded — not the full 6MB+ ranking corpora.
  const [allWords, features, networkData] = await Promise.all([
    loadWordsUpTo(maxLevel),
    loadPriorityFeaturesUpTo(maxLevel),
    loadNetworks(),
  ]);
  const engine = resolveEngine(state.preferences.learningEngine, round);
  const network = chooseNetwork(networkData, engine, state, round, seed, allWords, features);
  const { words: selectedWords, reviewWordKeys } = chooseWords(network, allWords, state, features);
  // Graded examples and sprint sentences are fetched from id-sharded corpora through the
  // offline word index, so only the shards containing relevant sentences are downloaded.
  const [hskSentences, spokenSentences] = await Promise.all([
    loadHskSentencesForWords(selectedWords.map((word) => word.word), network.sentenceIds),
    loadSpokenSentencesForWords(selectedWords.map((word) => word.word)),
  ]);
  const sentenceMap = new Map(hskSentences.map((sentence) => [sentence.id, sentence]));
  const currentLevelWords = allWords.filter((word) => word.level === state.preferences.level);
  const unseen = currentLevelWords.filter((word) => !state.mastery[itemKey("word", word.word)]?.lastSeenAt).length;
  return {
    id: `${network.id}-${round}-${hashString(selectedWords.map((word) => word.word).join("|"))}`,
    round,
    engine,
    networkId: network.id,
    title: network.title,
    subtitle: network.subtitle,
    anchor: anchorFor(network),
    members: undefined,
    collocations: network.collocations?.slice(0, 10) ?? [],
    anchorCount: selectedWords.length,
    words: selectedWords,
    characters: [],
    sentences: chooseSentences(network, sentenceMap, hskSentences, selectedWords),
    sprintSentences: chooseSprintSentences(spokenSentences, selectedWords, levelNumber(state.preferences.level)),
    reviews: dueReviews(state),
    reviewWordKeys,
    remainingNewWords: unseen,
  };
}
