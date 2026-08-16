import type { AppState, HskLevel, NetworkData, Skill } from "../types";
import { itemKey } from "./storage";

export interface CourseState {
  streak: number;
  dueWords: number;
  dueCharacters: number;
  level: HskLevel;
  levelProgress: number; // 0..1 of current level's words seen at least once
  levelTotal: number;
  masteredAtLevel: number;
  readyForNextLevel: boolean;
  weekWords: number;
  weekAccuracy: Partial<Record<Skill, number>>; // 0..1 per skill over the last 7 days
  totalMastered: number;
}

const LEVEL_COUNTS: Record<HskLevel, number> = { "1": 300, "2": 200, "3": 500, "4": 1000, "5": 1600, "6": 1800, "7-9": 5600 };
const NEXT_LEVEL: Partial<Record<HskLevel, HskLevel>> = { "1": "2", "2": "3", "3": "4", "4": "5", "5": "6", "6": "7-9" };
const SKILLS: Skill[] = ["recognition", "meaning", "sound", "context", "writing", "production"];

export function dueCounts(state: AppState): { words: number; characters: number } {
  const now = Date.now();
  let words = 0;
  let characters = 0;
  for (const record of Object.values(state.mastery)) {
    if (new Date(record.dueAt).getTime() > now) continue;
    if (record.kind === "word") words += 1;
    else characters += 1;
  }
  return { words, characters };
}

export function weekStats(state: AppState, days = 7): { words: number; accuracy: Partial<Record<Skill, number>> } {
  const cutoff = Date.now() - days * 86_400_000;
  const seenWords = new Set<string>();
  const skillTotals: Partial<Record<Skill, { sum: number; count: number }>> = {};
  for (const attempt of state.attempts) {
    if (Date.parse(attempt.at) < cutoff) continue;
    if (attempt.key.startsWith("word:")) seenWords.add(attempt.key);
    const bucket = skillTotals[attempt.skill] ?? { sum: 0, count: 0 };
    bucket.sum += attempt.score;
    bucket.count += 1;
    skillTotals[attempt.skill] = bucket;
  }
  const accuracy: Partial<Record<Skill, number>> = {};
  for (const skill of SKILLS) {
    const bucket = skillTotals[skill];
    if (bucket && bucket.count > 0) accuracy[skill] = Math.round((bucket.sum / (bucket.count * 3)) * 100);
  }
  return { words: seenWords.size, accuracy };
}

export async function buildCourseState(state: AppState, wordsAtLevel: string[]): Promise<CourseState> {
  const { words: dueWords, characters: dueCharacters } = dueCounts(state);
  const level = state.preferences.level;
  const levelTotal = LEVEL_COUNTS[level];
  const masteredAtLevel = wordsAtLevel.filter((word) => Boolean(state.mastery[itemKey("word", word)]?.lastSeenAt)).length;
  const levelProgress = levelTotal ? masteredAtLevel / levelTotal : 0;
  const readyForNextLevel = levelProgress >= 0.8 && Boolean(NEXT_LEVEL[level]);
  const { words: weekWords, accuracy } = weekStats(state);
  return {
    streak: state.streak.current,
    dueWords,
    dueCharacters,
    level,
    levelProgress,
    levelTotal,
    masteredAtLevel,
    readyForNextLevel,
    weekWords,
    weekAccuracy: accuracy,
    totalMastered: Object.values(state.mastery).filter((record) => record.kind === "word" && record.lastSeenAt).length,
  };
}

/** A smart, interesting next family: the first unstudied connected group the learner can start. */
export function nextFamilySuggestion(networks: NetworkData | undefined, state: AppState, level: HskLevel): { id: string; title: string; wordCount: number; kind: string } | undefined {
  if (!networks) return undefined;
  const maxLevel = level === "7-9" ? 7 : Number(level) + 1;
  const groups: Array<{ id: string; title: string; wordKeys: string[]; minLevel: number; kind: string }> = [
    ...networks.wordWebs.map((n) => ({ ...n, kind: "Word web" })),
    ...networks.scenarios.map((n) => ({ ...n, kind: "Scene" })),
    ...networks.contrastSets.map((n) => ({ ...n, kind: "Contrast" })),
  ];
  const unseen = (wordKeys: string[]) => wordKeys.filter((word) => !state.mastery[itemKey("word", word)]?.lastSeenAt).length;
  const chosen = groups
    .filter((group) => group.minLevel <= maxLevel && unseen(group.wordKeys) >= Math.max(3, Math.ceil(group.wordKeys.length * 0.5)))
    .sort((a, b) => unseen(b.wordKeys) - unseen(a.wordKeys) || a.minLevel - b.minLevel)[0];
  if (!chosen) return undefined;
  return { id: chosen.id, title: chosen.title, wordCount: chosen.wordKeys.length, kind: chosen.kind };
}

export function nextLevel(level: HskLevel): HskLevel | undefined {
  return NEXT_LEVEL[level];
}
