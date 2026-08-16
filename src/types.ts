export type HskLevel = "1" | "2" | "3" | "4" | "5" | "6" | "7-9";
export type Skill = "recognition" | "meaning" | "sound" | "writing" | "context" | "production";
export type ItemKind = "word" | "character";
export type LearningPath = "smart" | "new" | "weak" | "frequency";
export type LearningGoal = "fluency" | "hsk";
export type LearningEngine = "smart" | "word-web" | "sound-family" | "meaning-family" | "scenario" | "contrast";
export type NetworkKind = Exclude<LearningEngine, "smart">;

export interface WordEntry {
  id: number;
  level: HskLevel;
  word: string;
  sourceWord?: string;
  pinyin: string;
  partOfSpeech?: string;
  traditional?: string;
  definitions: string[];
  syllabusLevelName?: string;
  syllabusSort?: number;
  syllabusVersion?: string;
  source?: string;
}

export interface HskManifest {
  title: string;
  version: string;
  published: string;
  effective: string;
  sourceUrl: string;
  queryUrl: string;
  syncedAt: string;
  coreEntries: number;
  uniqueHeadwords: number;
  culturalTerms: number;
  levelCounts: Record<HskLevel, number>;
  cumulativeCounts: Record<HskLevel, number>;
}

export interface CulturalTerm {
  id: string;
  stage: string;
  word: string;
  pinyin: string;
  category: string;
  traditional?: string;
  definitions: string[];
  syllabusSort: number;
  syllabusVersion: string;
  source: string;
}

export interface WordInsight {
  sentenceCount: number;
  hskSentenceCount: number;
  openSentenceCount: number;
  contextCount: number;
  usageBand: "very common" | "common" | "useful" | "specialized" | "syllabus only";
  topics: Array<{ topic: string; count: number }>;
  collocations: Array<{ phrase: string; pinyin: string; english: string; count: number; wordKeys: string[] }>;
  grammarPoints: Array<{ point: string; count: number }>;
  exampleIds: number[];
}

export interface WordDetailConnection {
  engine: NetworkKind;
  id: string;
  title: string;
  subtitle: string;
  wordKeys: string[];
}

export interface WordDetailData {
  insight: WordInsight;
  examples: SentenceEntry[];
  characters: Record<string, CharacterEntry>;
  connection?: WordDetailConnection;
  semanticRelations?: string[];
}

export interface WordDetailManifest {
  generatedAt: string;
  shardCount: number;
  headwords: number;
  examples: number;
}

export interface CharacterEntry {
  pinyin: string[];
  definition: string;
  radical?: string;
  decomposition?: string;
  strokes?: number;
  etymology?: { type?: string; hint?: string; semantic?: string; phonetic?: string };
}

export interface CharacterIndexEntry {
  char: string;
  pinyin: string;
  english: string;
  level: HskLevel;
  frequencyRank: number;
  radical: string;
  strokes: number;
  wordCount: number;
  componentPower?: number;
}

export interface CharacterWordRef {
  word: string;
  pinyin: string;
  english: string;
  level: HskLevel;
}

export interface CharacterFamily {
  id: string;
  kind: "meaning" | "sound" | "visual";
  component: string;
  title: string;
  subtitle: string;
  minLevel: HskLevel;
  members: CharacterIndexEntry[];
}

export interface CharacterFamiliesData {
  generatedAt: string;
  meaning: CharacterFamily[];
  sound: CharacterFamily[];
  visual: CharacterFamily[];
}

export interface CharacterDetailData extends CharacterIndexEntry {
  definition: string;
  decomposition: string;
  type: string;
  hint: string;
  semantic: string;
  phonetic: string;
  words: CharacterWordRef[];
  examples: SentenceEntry[];
  familyIds: Partial<Record<"meaning" | "sound" | "visual", string>>;
}

export interface CharacterCurriculumManifest {
  generatedAt: string;
  characters: number;
  shardCount: number;
  levelCounts: Record<HskLevel, number>;
  familyCounts: Record<"meaning" | "sound" | "visual", number>;
}

export interface PriorityFeatures {
  /** frequencyValue: 1 - min(1, average character rank / 9000) */
  f: number;
  /** spokenValue: spoken utility from SUBTLEX-CH rank/context + insight sentence counts */
  s: number;
  /** transferValue: lexical-value score from CLD evidence */
  t: number;
  /** learnability: 1 - lexical-difficulty score from CLD evidence */
  l: number;
}

export interface SentenceEntry {
  id: number;
  hskLevel: number;
  topic: string;
  chinese: string;
  traditional?: string;
  pinyin: string;
  english: string;
  words: string[];
  grammarPoints: string[];
  audioNormal?: string;
  audioSlow?: string;
  source?: string;
  attribution?: Record<string, unknown>;
}

export interface SpokenSentenceEntry extends SentenceEntry {
  utilityScore: number;
}


export interface ReadingStorySentence {
  id: string;
  chinese: string;
  pinyin: string;
  english: string;
  words: string[];
  grammar?: string;
}

export interface ReadingStory {
  id: string;
  hskLevel: number;
  title: string;
  chineseTitle: string;
  description: string;
  theme: string;
  minutes: number;
  coverImage?: string;
  audioUrl?: string;
  source: {
    name: string;
    url: string;
    license: string;
    sourceLevel: string;
    publisher: string;
    contributors: Array<{ name: string; role: string }>;
  };
  sentences: ReadingStorySentence[];
}

export interface NetworkMember {
  char: string;
  pinyin: string[];
  definition: string;
  semantic?: string;
  hint?: string;
}

export interface BaseNetwork {
  id: string;
  title: string;
  subtitle: string;
  minLevel: number;
  wordKeys: string[];
  sentenceIds: number[];
  collocations?: Array<{ phrase: string; pinyin: string; english: string; count: number }>;
}

export interface WordWebNetwork extends BaseNetwork {
  anchor: string;
  productivity: number;
  frequencyRank: number;
}

export interface CharacterFamilyNetwork extends BaseNetwork {
  component: string;
  members: NetworkMember[];
  coherence?: number;
}

export interface ScenarioNetwork extends BaseNetwork {
  topic: string;
}

export interface NetworkData {
  generatedAt: string;
  sourceCounts: { words: number; characters: number; sentences: number };
  wordWebs: WordWebNetwork[];
  soundFamilies: CharacterFamilyNetwork[];
  meaningFamilies: CharacterFamilyNetwork[];
  scenarios: ScenarioNetwork[];
  contrastSets: BaseNetwork[];
}

export interface SkillSchedule {
  dueAt: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  fsrs?: {
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: number;
    lastReview?: string;
  };
}

export interface MasteryRecord {
  key: string;
  kind: ItemKind;
  text: string;
  skills: Partial<Record<Skill, number>>;
  schedules?: Partial<Record<Skill, SkillSchedule>>;
  dueAt: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  lastSeenAt?: string;
}

export interface AttemptRecord {
  at: string;
  key: string;
  skill: Skill;
  score: 0 | 1 | 2 | 3;
}

export interface Preferences {
  level: HskLevel;
  learningGoal: LearningGoal;
  roundWords: number;
  roundCharacters: number;
  learningPath: LearningPath;
  learningEngine: LearningEngine;
  selectedNetworkId?: string;
  showPinyin: "always" | "tap" | "never";
  audioSpeed: "normal" | "slow";
  voiceGender: "female" | "male";
}

export interface LearningStats {
  roundsCompleted: number;
  totalWords: number;
  totalCharacters: number;
  totalSentences: number;
  recentWords: string[];
  recentCharacters: string[];
  recentNetworks: string[];
  lastRoundAt?: string;
}

export type WordLearningStatus = "learning" | "known";

export interface WordListRecord {
  status: WordLearningStatus | "none";
  updatedAt: string;
}

export interface AppState {
  version: 4;
  preferences: Preferences;
  mastery: Record<string, MasteryRecord>;
  wordLists: Record<string, WordListRecord>;
  attempts: AttemptRecord[];
  sessionHistory: Record<string, { completed: boolean; words: string[]; characters: string[]; networkId?: string }>;
  streak: { current: number; best: number; lastStudyDate?: string };
  learning: LearningStats;
}

export interface LearningBatch {
  id: string;
  round: number;
  engine: NetworkKind;
  networkId: string;
  title: string;
  subtitle: string;
  anchor?: string;
  members?: NetworkMember[];
  collocations: Array<{ phrase: string; pinyin: string; english: string; count: number }>;
  anchorCount: number;
  words: WordEntry[];
  characters: Array<{ char: string; data?: CharacterEntry; words: WordEntry[] }>;
  sentences: SentenceEntry[];
  sprintSentences: SpokenSentenceEntry[];
  reviews: MasteryRecord[];
  reviewWordKeys: string[];
  remainingNewWords: number;
}
