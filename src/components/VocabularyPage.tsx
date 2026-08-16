import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BookOpenText, Flame, GitBranch, RotateCw } from "lucide-react";
import type { AppState, LearningBatch, Skill } from "../types";
import { CurriculumPage } from "./CurriculumPage";
import { readUiState, writeUiState } from "../lib/persistentUi";

const LearnPage = lazy(() => import("./LearnPage").then((module) => ({ default: module.LearnPage })));

type RecordAttempt = (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void;

function dueToday(state: AppState): { words: number; characters: number } {
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

function TodayStrip({ state, onOpenGroups }: { state: AppState; onOpenGroups: () => void }) {
  const { words, characters } = useMemo(() => dueToday(state), [state.mastery]);
  const totalDue = words + characters;
  return <div className="today-strip" role="status" aria-label="Today summary">
    <span className="today-streak"><Flame size={15}/><strong>{state.streak.current}</strong><small>day streak</small></span>
    {totalDue > 0 ? (
      <button className="today-due" onClick={onOpenGroups} aria-label="Open groups with due reviews">
        <RotateCw size={15}/><strong>{words} word{words === 1 ? "" : "s"} · {characters} character{characters === 1 ? "" : "s"}</strong><small>due for review — groups include them</small>
      </button>
    ) : <span className="today-clear"><RotateCw size={15}/><strong>All caught up</strong><small>no reviews due today</small></span>}
  </div>;
}

export function VocabularyPage({ active, state, setState, batch, loading, record, onShuffle, onCompleteGroup, onNextGroup, onGroupModeChange, sessionTotals, focusWord, onOpenCharacter }: {
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
}) {
  const [mode, setMode] = useState<"curriculum" | "groups">(() => readUiState("vocabulary-mode", "curriculum"));

  useEffect(() => { if (focusWord) setMode("curriculum"); }, [focusWord]);
  useEffect(() => {
    writeUiState("vocabulary-mode", mode);
  }, [mode]);
  useEffect(() => { onGroupModeChange(active && mode === "groups"); }, [active, mode, onGroupModeChange]);

  return <>
    <TodayStrip state={state} onOpenGroups={() => setMode("groups")}/>
    <nav className="vocab-mode-nav" aria-label="Vocabulary sections">
      <button aria-pressed={mode === "curriculum"} className={mode === "curriculum" ? "active" : ""} onClick={() => setMode("curriculum")}><BookOpenText size={17}/><span><strong>Word library</strong><small>Search every HSK word</small></span></button>
      <button aria-pressed={mode === "groups"} className={mode === "groups" ? "active" : ""} onClick={() => setMode("groups")}><GitBranch size={17}/><span><strong>Learn a group</strong><small>Families, scenes, contrasts</small></span></button>
    </nav>

    {mode === "curriculum" ? (
      <CurriculumPage active={active} state={state} setState={setState} record={record} onOpenGroup={() => setMode("groups")} focusWord={focusWord} onOpenCharacter={onOpenCharacter}/>
    ) : (
      <Suspense fallback={<div className="page-loading" role="status"><span className="skeleton"/><strong>Preparing your connected group…</strong></div>}>
        <LearnPage state={state} setState={setState} batch={batch} loading={loading} record={record} onShuffle={onShuffle} onCompleteGroup={onCompleteGroup} onNextGroup={onNextGroup} sessionTotals={sessionTotals}/>
      </Suspense>
    )}
  </>;
}
