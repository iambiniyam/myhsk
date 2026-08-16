import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BookOpenText, Download, GitBranch, Library, Settings2, Shapes, Upload, Volume2 } from "lucide-react";
import type { AppState, HskLevel, LearningBatch, Skill } from "./types";
import { buildLearningBatch } from "./lib/curriculum";
import {
  completeLearningRound,
  exportState,
  importState,
  loadState,
  saveState,
  scheduleAttempt,
  updatePreferences,
} from "./lib/storage";
import { VocabularyPage } from "./components/VocabularyPage";
import { preloadAudioSystem } from "./lib/audio";
import { readUiState, writeUiState } from "./lib/persistentUi";
import { useDialogFocus } from "./hooks/useDialogFocus";
import "./styles.css";

type LearningArea = "vocabulary" | "characters" | "reading";
const CharacterPage = lazy(() => import("./components/CharacterPage").then((module) => ({ default: module.CharacterPage })));
const ReadingStudio = lazy(() => import("./components/ReadingStudio").then((module) => ({ default: module.ReadingStudio })));

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [batch, setBatch] = useState<LearningBatch>();
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [learningArea, setLearningArea] = useState<LearningArea>(() => readUiState<LearningArea>("learning-area", "vocabulary"));
  const [groupModeActive, setGroupModeActive] = useState(() => readUiState<"curriculum" | "groups">("vocabulary-mode", "curriculum") === "groups");
  const [visitedAreas, setVisitedAreas] = useState<Set<LearningArea>>(() => new Set([readUiState<LearningArea>("learning-area", "vocabulary")]));
  const [focusedWord, setFocusedWord] = useState<string>();
  const [focusedCharacter, setFocusedCharacter] = useState<string>();
  const [round, setRound] = useState(0);
  const [shuffleNonce, setShuffleNonce] = useState(0);
  const [sessionSeed] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [sessionTotals, setSessionTotals] = useState({ groups: 0, words: 0 });
  const importRef = useRef<HTMLInputElement | null>(null);
  const settingsCardRef = useRef<HTMLElement | null>(null);
  const areaRef = useRef<LearningArea>(learningArea);
  const areaScroll = useRef<Record<LearningArea, number>>(readUiState("area-scroll", { vocabulary: 0, characters: 0, reading: 0 }));

  const stateRef = useRef(state);
  stateRef.current = state;
  const flushSave = useCallback(() => saveState(stateRef.current), []);
  useEffect(() => {
    const timer = window.setTimeout(flushSave, 500);
    return () => window.clearTimeout(timer);
  }, [flushSave, state]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flushSave(); };
    window.addEventListener("beforeunload", flushSave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flushSave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushSave]);
  useEffect(() => { void preloadAudioSystem(); }, []);
  useEffect(() => {
    areaRef.current = learningArea;
    writeUiState("learning-area", learningArea);
  }, [learningArea]);

  const openArea = useCallback((next: LearningArea, addHistory = true, restoreScroll = true) => {
    const current = areaRef.current;
    areaScroll.current[current] = window.scrollY;
    writeUiState("area-scroll", areaScroll.current);
    setVisitedAreas((visited) => new Set([...visited, next]));
    setLearningArea(next);
    areaRef.current = next;
    if (addHistory && next !== current) window.history.pushState({ ...window.history.state, myhskArea: next }, "");
    window.requestAnimationFrame(() => window.scrollTo({ top: restoreScroll ? areaScroll.current[next] ?? 0 : 0, behavior: "auto" }));
  }, []);

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, myhskArea: areaRef.current }, "");
    const onPopState = (event: PopStateEvent) => {
      const next = event.state?.myhskArea ?? event.state?.mingbaiArea;
      if (next === "vocabulary" || next === "characters" || next === "reading") openArea(next, false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openArea]);

  useEffect(() => {
    if (!showSettings) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showSettings]);
  useDialogFocus(showSettings, settingsCardRef, () => setShowSettings(false));

  const refreshBatch = useCallback(async () => {
    setLoadingBatch(true);
    try {
      setBatch(await buildLearningBatch(state, round, `${sessionSeed}-${shuffleNonce}`));
    } finally {
      setLoadingBatch(false);
    }
  }, [round, sessionSeed, shuffleNonce, state.preferences.level, state.preferences.learningGoal, state.preferences.learningEngine, state.preferences.selectedNetworkId]);

  useEffect(() => {
    if (learningArea !== "vocabulary" || !groupModeActive) {
      setLoadingBatch(false);
      return;
    }
    void refreshBatch();
  }, [groupModeActive, learningArea, refreshBatch]);

  const record = useCallback((kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => {
    setState((current) => scheduleAttempt(current, kind, text, skill, score));
  }, []);

  const finishGroup = useCallback((completedBatch: LearningBatch) => {
    setState((current) => completeLearningRound(current, completedBatch));
    setSessionTotals((current) => ({
      groups: current.groups + 1,
      words: current.words + completedBatch.words.length,
    }));
  }, []);

  const nextGroup = useCallback(() => {
    setBatch(undefined);
    setState((current) => updatePreferences(current, { selectedNetworkId: undefined }));
    setRound((value) => value + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const downloadProgress = () => {
    const url = URL.createObjectURL(exportState(state));
    const link = document.createElement("a");
    link.href = url;
    link.download = `myhsk-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setSettingsMessage({ kind: "success", text: "Progress backup downloaded." });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to learning</a>
      <header className="topbar">
        <div className="brand" aria-label="MyHSK">
          <span className="brand-mark">汉</span>
          <span><strong>MyHSK</strong><small>Words · Characters · Reading</small></span>
        </div>
        <nav className="product-switch" aria-label="Learning areas">
          <button aria-pressed={learningArea === "vocabulary"} className={learningArea === "vocabulary" ? "active" : ""} onClick={() => { setFocusedWord(undefined); openArea("vocabulary"); }}><BookOpenText size={15}/>Words</button>
          <button aria-pressed={learningArea === "characters"} className={learningArea === "characters" ? "active" : ""} onClick={() => { setFocusedCharacter(undefined); openArea("characters"); }}><Shapes size={15}/>Characters</button>
          <button aria-pressed={learningArea === "reading"} className={learningArea === "reading" ? "active" : ""} onClick={() => openArea("reading")}><Library size={15}/>Read</button>
        </nav>
        <div className="topbar-actions">
          <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Open learning settings"><Settings2 size={19} /></button>
        </div>
      </header>

      <main id="main-content" className="main-content" tabIndex={-1}>
        {visitedAreas.has("vocabulary") && <section hidden={learningArea !== "vocabulary"}><VocabularyPage
          active={learningArea === "vocabulary"}
          state={state}
          setState={setState}
          batch={batch}
          loading={loadingBatch}
          record={record}
          onShuffle={() => setShuffleNonce((value) => value + 1)}
          onCompleteGroup={finishGroup}
          onNextGroup={nextGroup}
          onGroupModeChange={setGroupModeActive}
          sessionTotals={sessionTotals}
          focusWord={focusedWord}
          onOpenCharacter={(character) => { setFocusedCharacter(character); openArea("characters", true, false); }}
          onOpenReading={() => openArea("reading", true, false)}
          onOpenCharacters={() => openArea("characters", true, false)}
        /></section>}
        {visitedAreas.has("characters") && <section hidden={learningArea !== "characters"}>
          <Suspense fallback={<div className="page-loading" role="status"><span className="skeleton"/><strong>Opening the character library…</strong></div>}>
            <CharacterPage
              active={learningArea === "characters"}
              state={state}
              record={record}
              onOpenWord={(word) => { setFocusedWord(word); openArea("vocabulary", true, false); }}
              focusCharacter={focusedCharacter}
            />
          </Suspense>
        </section>}
        {visitedAreas.has("reading") && <section hidden={learningArea !== "reading"}>
          <Suspense fallback={<div className="page-loading" role="status"><span className="skeleton"/><strong>Opening the reading studio…</strong></div>}>
            <ReadingStudio active={learningArea === "reading"} state={state} record={record}/>
          </Suspense>
        </section>}
      </main>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <section ref={settingsCardRef} className="settings-card" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="settings-title" tabIndex={-1}>
            <div className="settings-heading">
              <div><Settings2 size={20}/><div><span className="eyebrow">LEARNING SETTINGS</span><h2 id="settings-title">Make it yours</h2></div></div>
              <button data-dialog-autofocus className="text-button" onClick={() => setShowSettings(false)}>Done</button>
            </div>

            <label>Chinese level
              <select value={state.preferences.level} onChange={(event) => setState((current) => updatePreferences(current, { level: event.target.value as HskLevel }))}>
                <option value="1">HSK 1 · Starting out</option>
                <option value="2">HSK 2 · Foundation</option>
                <option value="3">HSK 3 · Everyday Chinese</option>
                <option value="4">HSK 4 · Independent</option>
                <option value="5">HSK 5 · Advanced</option>
                <option value="6">HSK 6 · Fluent reading</option>
                <option value="7-9">HSK 7–9 · Expert</option>
              </select>
            </label>

            <div className="group-policy-note"><GitBranch size={18}/><p><strong>Groups stay complete.</strong> Each session follows the connected family to its natural end, with short recall rounds inside larger groups.</p></div>

            <label>Pinyin support
              <select value={state.preferences.showPinyin} onChange={(event) => setState((current) => updatePreferences(current, { showPinyin: event.target.value as AppState["preferences"]["showPinyin"] }))}>
                <option value="always">Always visible</option>
                <option value="tap">Reveal on tap</option>
                <option value="never">Hidden by default</option>
              </select>
            </label>

            <div className="audio-note"><Volume2 size={18}/><p><strong>Human Mandarin first.</strong> MyHSK uses native word recordings, high-quality neural voice packs, and on-demand neural audio. Open audio attribution is available <a href="/audio/HUMAN_AUDIO_LICENSE.txt" target="_blank" rel="noreferrer">here</a>.</p></div>

            <div className="data-actions">
              <button className="secondary-button" onClick={downloadProgress}><Download size={17}/> Export progress</button>
              <button className="secondary-button" onClick={() => importRef.current?.click()}><Upload size={17}/> Import progress</button>
              <input ref={importRef} type="file" accept="application/json" hidden onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setState(await importState(file));
                  setSettingsMessage({ kind: "success", text: "Progress restored successfully." });
                } catch {
                  setSettingsMessage({ kind: "error", text: "That file is not a valid MyHSK progress backup. Your current progress was not changed." });
                }
                event.target.value = "";
              }}/>
            </div>
            {settingsMessage && <p className={`settings-message ${settingsMessage.kind}`} role="status" aria-live="polite">{settingsMessage.text}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
