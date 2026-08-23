import { lazy, Suspense, useEffect, useState } from "react";
import { BookOpenText, GitBranch } from "lucide-react";
import type { AppState, LearningBatch, Skill } from "../types";
import { CurriculumPage } from "./CurriculumPage";
import { readUiState, writeUiState } from "../lib/persistentUi";

const LearnPage = lazy(() => import("./LearnPage").then((module) => ({ default: module.LearnPage })));

type RecordAttempt = (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void;

export function VocabularyPage({ active, state, setState, batch, loading, record, onShuffle, onCompleteGroup, onNextGroup, onGroupModeChange, sessionTotals, focusWord, onOpenCharacter, onOpenReading, onOpenCharacters }: {
  active: boolean;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  batch?: LearningBatch;
  loading: boolean;
  record: RecordAttempt;
  onShuffle: () => void;
  onCompleteGroup: (batch: LearningBatch) => void;
  onNextGroup: () => void;
  onGroupModeChange: (active: boolean) => void;
  sessionTotals: { groups: number; words: number };
  focusWord?: string;
  onOpenCharacter: (character: string) => void;
  onOpenReading: () => void;
  onOpenCharacters: () => void;
}) {
  const [mode, setMode] = useState<"curriculum" | "groups">(() => readUiState("vocabulary-mode", "curriculum"));

  useEffect(() => { if (focusWord) setMode("curriculum"); }, [focusWord]);
  useEffect(() => {
    writeUiState("vocabulary-mode", mode);
  }, [mode]);
  useEffect(() => { onGroupModeChange(active && mode === "groups"); }, [active, mode, onGroupModeChange]);

  return <>
    {mode === "curriculum" ? (
      <CurriculumPage active={active} state={state} setState={setState} record={record} onOpenGroup={() => setMode("groups")} focusWord={focusWord} onOpenCharacter={onOpenCharacter}/>
    ) : (
      <Suspense fallback={<div className="page-loading" role="status"><span className="skeleton"/><strong>Preparing your connected group…</strong></div>}>
        <LearnPage state={state} setState={setState} batch={batch} loading={loading} record={record} onShuffle={onShuffle} onCompleteGroup={onCompleteGroup} onNextGroup={onNextGroup} sessionTotals={sessionTotals}/>
      </Suspense>
    )}
  </>;
}
