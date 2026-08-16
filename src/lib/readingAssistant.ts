import type { ReadingStory, ReadingStorySentence, WordEntry } from "../types";
import { assetPath } from "./content";

export type ReadingHelpMode = "explain" | "grammar" | "simplify" | "quiz";

export interface ReadingHelpResponse {
  title: string;
  summary: string;
  breakdown: Array<{ chinese: string; pinyin: string; meaning: string }>;
  tip?: string;
  question?: string;
}

export async function requestReadingHelp(input: {
  mode: ReadingHelpMode;
  story: ReadingStory;
  sentence: ReadingStorySentence;
  word?: WordEntry;
  mastery?: number;
}): Promise<ReadingHelpResponse> {
  const response = await fetch(assetPath("api/reading-help"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MyHSK-Reading": "1" },
    credentials: "same-origin",
    body: JSON.stringify({
      mode: input.mode,
      story: {
        id: input.story.id,
        title: input.story.title,
        chineseTitle: input.story.chineseTitle,
        hskLevel: input.story.hskLevel,
        passage: input.story.sentences.map((sentence) => sentence.chinese).join(""),
      },
      sentence: input.sentence,
      word: input.word ? {
        word: input.word.word,
        pinyin: input.word.pinyin,
        definitions: input.word.definitions.slice(0, 5),
        mastery: input.mastery ?? 0,
      } : undefined,
    }),
  });
  const body = await response.json().catch(() => ({})) as ReadingHelpResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || "Reading help is temporarily unavailable.");
  return body;
}
