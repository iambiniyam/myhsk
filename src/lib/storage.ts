import type { AppState, AttemptRecord, HskLevel, ItemKind, LearningBatch, MasteryRecord, Preferences, Skill, SkillSchedule, WordLearningStatus } from "../types";
import { createEmptyCard, fsrs, Rating, State, type Card, type CardInput } from "ts-fsrs";

const STORAGE_KEY = "mingbai-open-state-v3";
const LEGACY_STORAGE_KEYS = ["mingbai-open-state-v2", "mingbai-open-state-v1"];
const memoryScheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 3650,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["10m"],
  relearning_steps: ["10m"],
});

export const defaultPreferences: Preferences = {
  level: "1",
  learningGoal: "fluency",
  roundWords: 6,
  roundCharacters: 6,
  learningPath: "smart",
  learningEngine: "smart",
  showPinyin: "tap",
  audioSpeed: "normal",
  voiceGender: "female",
};

export const defaultState: AppState = {
  version: 4,
  preferences: defaultPreferences,
  mastery: {},
  wordLists: {},
  attempts: [],
  sessionHistory: {},
  streak: { current: 0, best: 0 },
  learning: {
    roundsCompleted: 0,
    totalWords: 0,
    totalCharacters: 0,
    totalSentences: 0,
    recentWords: [],
    recentCharacters: [],
    recentNetworks: [],
  },
};

function safeParse(raw: string | null, strict = false): AppState {
  if (!raw) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(raw) as Partial<AppState> & {
      preferences?: Partial<Preferences> & { dailyWords?: number; dailyCharacters?: number };
    };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (!parsed.mastery && !parsed.preferences && !parsed.learning)) {
      throw new Error("Not a MyHSK progress backup");
    }
    const preferences = (parsed.preferences ?? {}) as Partial<Preferences> & { dailyWords?: number; dailyCharacters?: number };
    const requestedWordCount = Number(preferences.roundWords ?? preferences.dailyWords ?? defaultPreferences.roundWords);
    const savedWordCount = Number.isFinite(requestedWordCount) ? requestedWordCount : defaultPreferences.roundWords;
    const savedEngine = preferences.learningEngine;
    const vocabularyEngine = savedEngine === "word-web" || savedEngine === "scenario" || savedEngine === "contrast" || savedEngine === "smart"
      ? savedEngine
      : "smart";
    return {
      ...structuredClone(defaultState),
      ...parsed,
      version: 4,
      preferences: {
        ...defaultPreferences,
        ...preferences,
        roundWords: Math.max(4, Math.min(40, savedWordCount)),
        roundCharacters: preferences.roundCharacters ?? preferences.dailyCharacters ?? defaultPreferences.roundCharacters,
        learningEngine: vocabularyEngine,
      },
      mastery: parsed.mastery ?? {},
      wordLists: parsed.wordLists ?? {},
      attempts: parsed.attempts ?? [],
      sessionHistory: parsed.sessionHistory ?? {},
      streak: { ...defaultState.streak, ...(parsed.streak ?? {}) },
      learning: { ...defaultState.learning, ...(parsed.learning ?? {}) },
    };
  } catch {
    if (strict) throw new Error("Invalid MyHSK progress backup");
    return structuredClone(defaultState);
  }
}

export function normalizeState(value: unknown): AppState {
  return safeParse(JSON.stringify(value), true);
}

export function loadState(): AppState {
  if (typeof window === "undefined") return structuredClone(defaultState);
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) return safeParse(current);
  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = localStorage.getItem(key);
    if (legacy) { const migrated = safeParse(legacy); saveState(migrated); return migrated; }
  }
  return structuredClone(defaultState);
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Learning remains usable when private browsing or a full storage quota blocks persistence.
  }
}

export function itemKey(kind: ItemKind, text: string): string {
  return `${kind}:${text}`;
}

export function setWordLearningStatus(state: AppState, word: string, status?: WordLearningStatus): AppState {
  const wordLists = { ...state.wordLists };
  if (status) wordLists[word] = { status, updatedAt: new Date().toISOString() };
  else wordLists[word] = { status: "none", updatedAt: new Date().toISOString() };
  return { ...state, wordLists };
}

export function getOrCreateMastery(state: AppState, kind: ItemKind, text: string): MasteryRecord {
  const key = itemKey(kind, text);
  return state.mastery[key] ?? {
    key,
    kind,
    text,
    skills: {},
    schedules: {},
    dueAt: new Date().toISOString(),
    intervalDays: 0,
    ease: 2.3,
    repetitions: 0,
    lapses: 0,
  };
}

export function scheduleAttempt(
  state: AppState,
  kind: ItemKind,
  text: string,
  skill: Skill,
  score: 0 | 1 | 2 | 3,
): AppState {
  const now = new Date();
  const record = getOrCreateMastery(state, kind, text);
  const previous = record.skills[skill] ?? 0;
  const evidence = score / 3;
  const nextSkill = Math.max(0, Math.min(1, previous * 0.72 + evidence * 0.28));
  const currentSchedule = record.schedules?.[skill] ?? {
    dueAt: now.toISOString(), intervalDays: 0, ease: 2.3, repetitions: 0, lapses: 0,
  };
  const nextCard = memoryScheduler.next(cardFromSchedule(currentSchedule, record.lastSeenAt, now), now, scoreToRating(score)).card;
  const intervalDays = nextCard.scheduled_days;
  const repetitions = nextCard.reps;
  const lapses = nextCard.lapses;
  const ease = Math.max(1.35, Math.min(2.8, 3.15 - nextCard.difficulty * 0.18));
  const skillDue = nextCard.due.toISOString();
  const schedules = {
    ...(record.schedules ?? {}),
    [skill]: {
      dueAt: skillDue,
      intervalDays,
      ease,
      repetitions,
      lapses,
      fsrs: snapshotCard(nextCard),
    },
  };
  const earliestDue = Object.values(schedules).reduce((earliest, schedule) =>
    new Date(schedule.dueAt).getTime() < new Date(earliest).getTime() ? schedule.dueAt : earliest,
    skillDue,
  );
  const nextRecord: MasteryRecord = {
    ...record,
    skills: { ...record.skills, [skill]: nextSkill },
    schedules,
    dueAt: earliestDue,
    intervalDays,
    ease,
    repetitions,
    lapses,
    lastSeenAt: now.toISOString(),
  };

  const attempt: AttemptRecord = { at: now.toISOString(), key: record.key, skill, score };
  return {
    ...state,
    mastery: { ...state.mastery, [record.key]: nextRecord },
    attempts: [...state.attempts.slice(-4999), attempt],
  };
}

function scoreToRating(score: 0 | 1 | 2 | 3): Rating.Again | Rating.Hard | Rating.Good | Rating.Easy {
  return [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy][score] as Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;
}

function cardFromSchedule(schedule: SkillSchedule | undefined, lastSeenAt: string | undefined, now: Date): Card | CardInput {
  if (schedule?.fsrs) {
    const card = schedule.fsrs;
    return {
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsedDays,
      scheduled_days: card.scheduledDays,
      learning_steps: card.learningSteps,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.lastReview,
    };
  }
  if (!schedule || schedule.repetitions === 0) return createEmptyCard(now);
  return {
    due: schedule.dueAt,
    stability: Math.max(0.1, schedule.intervalDays || 1),
    difficulty: Math.max(1, Math.min(10, (3.15 - schedule.ease) / 0.18)),
    elapsed_days: 0,
    scheduled_days: schedule.intervalDays,
    learning_steps: 0,
    reps: schedule.repetitions,
    lapses: schedule.lapses,
    state: State.Review,
    last_review: lastSeenAt ?? now,
  };
}

function snapshotCard(card: Card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.toISOString(),
  };
}

export function completeLearningRound(state: AppState, batch: LearningBatch): AppState {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const last = state.streak.lastStudyDate;
  const currentStreak = last === today ? state.streak.current : last === yesterday ? state.streak.current + 1 : 1;
  const recentWords = [...batch.words.map((word) => word.word), ...state.learning.recentWords]
    .filter((word, index, values) => values.indexOf(word) === index)
    .slice(0, 180);
  const recentCharacters = [...batch.characters.map((item) => item.char), ...state.learning.recentCharacters]
    .filter((character, index, values) => values.indexOf(character) === index)
    .slice(0, 180);

  return {
    ...state,
    learning: {
      roundsCompleted: state.learning.roundsCompleted + 1,
      totalWords: state.learning.totalWords + batch.words.length,
      totalCharacters: state.learning.totalCharacters + batch.characters.length,
      totalSentences: state.learning.totalSentences + batch.sentences.length,
      recentWords,
      recentCharacters,
      recentNetworks: [batch.networkId, ...(state.learning.recentNetworks ?? [])].filter((id, index, values) => values.indexOf(id) === index).slice(0, 80),
      lastRoundAt: now.toISOString(),
    },
    sessionHistory: {
      ...state.sessionHistory,
      [`${now.toISOString()}-${batch.id}`]: {
        completed: true,
        words: batch.words.map((word) => word.word),
        characters: batch.characters.map((item) => item.char),
        networkId: batch.networkId,
      },
    },
    streak: { current: currentStreak, best: Math.max(state.streak.best, currentStreak), lastStudyDate: today },
  };
}

export function updatePreferences(state: AppState, patch: Partial<Preferences>): AppState {
  return { ...state, preferences: { ...state.preferences, ...patch } };
}

export function exportState(state: AppState): Blob {
  return new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
}

export async function importState(file: File): Promise<AppState> {
  const text = await file.text();
  const parsed = safeParse(text, true);
  saveState(parsed);
  return parsed;
}

export function changeLevel(state: AppState, level: HskLevel): AppState {
  return updatePreferences(state, { level });
}
