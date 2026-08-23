import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ear,
  Eye,
  GitBranch,
  Grid2X2,
  Layers3,
  Library,
  RotateCcw,
  Search,
  Shapes,
  Target,
  Volume2,
  X,
} from "lucide-react";
import type {
  AppState,
  CharacterCurriculumManifest,
  CharacterDetailData,
  CharacterFamiliesData,
  CharacterFamily,
  CharacterIndexEntry,
  HskLevel,
  Skill,
} from "../types";
import { loadCharacterDetail, loadCharacterFamilies, loadCharacterIndex, loadCharacterManifest } from "../lib/content";
import { itemKey } from "../lib/storage";
import { readUiState, writeUiState } from "../lib/persistentUi";
import { AudioButton } from "./AudioButton";
import { HanziPractice } from "./HanziPractice";
import { PinyinLine } from "./PinyinLine";
import { useDialogFocus } from "../hooks/useDialogFocus";

type RecordAttempt = (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void;
type CharacterMode = "path" | "families" | "library";
type FamilyKind = "meaning" | "sound" | "visual";

interface CharacterPack {
  id: string;
  kind: "level" | FamilyKind;
  title: string;
  subtitle: string;
  component?: string;
  members: CharacterIndexEntry[];
}

interface CharacterUiState {
  mode?: CharacterMode;
  pathLevel?: HskLevel;
  familyKind?: FamilyKind;
  query?: string;
  visibleCount?: number;
  selectedCharacter?: string;
  detailOpen?: boolean;
}

const levels: HskLevel[] = ["1", "2", "3", "4", "5", "6", "7-9"];

export function CharacterPage({ active, state, record, onOpenWord, focusCharacter }: {
  active: boolean;
  state: AppState;
  record: RecordAttempt;
  onOpenWord: (word: string) => void;
  focusCharacter?: string;
}) {
  const savedUi = useRef(readUiState<CharacterUiState>("character-library", {})).current;
  const [characters, setCharacters] = useState<CharacterIndexEntry[]>([]);
  const [families, setFamilies] = useState<CharacterFamiliesData>();
  const [manifest, setManifest] = useState<CharacterCurriculumManifest>();
  const [mode, setMode] = useState<CharacterMode>(savedUi.mode ?? "path");
  const [pathLevel, setPathLevel] = useState<HskLevel>(savedUi.pathLevel ?? state.preferences.level);
  const [familyKind, setFamilyKind] = useState<FamilyKind>(savedUi.familyKind ?? "meaning");
  const [query, setQuery] = useState(savedUi.query ?? "");
  const [visibleCount, setVisibleCount] = useState(savedUi.visibleCount ?? 120);
  const [selectedCharacter, setSelectedCharacter] = useState<string | undefined>(savedUi.selectedCharacter);
  const [detail, setDetail] = useState<{ char: string; data: CharacterDetailData }>();
  const [detailLoading, setDetailLoading] = useState<string>();
  const [detailFailed, setDetailFailed] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(savedUi.detailOpen ?? false);
  const [activePack, setActivePack] = useState<CharacterPack>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const searchMounted = useRef(false);

  useEffect(() => {
    writeUiState<CharacterUiState>("character-library", { mode, pathLevel, familyKind, query, visibleCount, selectedCharacter, detailOpen });
  }, [detailOpen, familyKind, mode, pathLevel, query, selectedCharacter, visibleCount]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadCharacterIndex(), loadCharacterFamilies(), loadCharacterManifest()]).then(([index, familyData, curriculumManifest]) => {
      if (!active) return;
      setCharacters(index);
      setFamilies(familyData);
      setManifest(curriculumManifest);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedCharacter) return;
    let active = true;
    setDetailLoading(selectedCharacter);
    setDetailFailed(undefined);
    void loadCharacterDetail(selectedCharacter).then((data) => {
      if (!active) return;
      if (data) setDetail({ char: selectedCharacter, data });
      else setDetailFailed(selectedCharacter);
    }).catch(() => {
      if (active) setDetailFailed(selectedCharacter);
    }).finally(() => {
      if (active) setDetailLoading(undefined);
    });
    return () => { active = false; };
  }, [selectedCharacter]);

  useEffect(() => {
    if (!searchMounted.current) { searchMounted.current = true; return; }
    setVisibleCount(120);
  }, [query]);
  useEffect(() => {
    if (!focusCharacter || !characters.some((entry) => entry.char === focusCharacter)) return;
    setMode("library");
    setQuery(focusCharacter);
    setSelectedCharacter(focusCharacter);
    setDetailOpen(true);
  }, [characters, focusCharacter]);
  useEffect(() => {
    if (!active || (!detailOpen && !activePack)) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [active, activePack, detailOpen]);
  useDialogFocus(detailOpen && active, detailRef, () => setDetailOpen(false));
  useEffect(() => { if (detailOpen) detailRef.current?.scrollTo({ top: 0 }); }, [detailOpen, selectedCharacter]);

  const indexMap = useMemo(() => new Map(characters.map((entry) => [entry.char, entry])), [characters]);
  const familyMap = useMemo(() => {
    const map = new Map<string, CharacterFamily>();
    if (families) for (const family of [...families.meaning, ...families.sound, ...families.visual]) map.set(family.id, family);
    return map;
  }, [families]);

  const pathCharacters = useMemo(() => characters.filter((entry) => entry.level === pathLevel), [characters, pathLevel]);
  const pathPacks = useMemo(() => chunk(pathCharacters, 8).map((members, index) => ({
    id: `hsk-${pathLevel}-${index + 1}`,
    kind: "level" as const,
    title: `Reading set ${index + 1}`,
    subtitle: `${members.length} characters anchored in useful HSK ${pathLevel} words.`,
    members,
  })), [pathCharacters, pathLevel]);
  const normalizedQuery = normalizeSearch(query);
  const searchResults = useMemo(() => characters.filter((entry) => !normalizedQuery || normalizeSearch(`${entry.char} ${entry.pinyin} ${entry.english} ${entry.radical}`).includes(normalizedQuery)), [characters, normalizedQuery]);
  const activeDetail = selectedCharacter && detail?.char === selectedCharacter ? detail.data : undefined;
  const selectedIndex = searchResults.findIndex((entry) => entry.char === selectedCharacter);

  const openCharacter = (character: string) => {
    setSelectedCharacter(character);
    setDetailOpen(true);
  };

  const startPack = (pack: CharacterPack) => {
    setActivePack(pack);
  };

  const openFamily = (family: CharacterFamily) => startPack({
    id: family.id,
    kind: family.kind,
    title: family.title,
    subtitle: family.subtitle,
    component: family.component,
    members: family.members,
  });

  const knownCount = characters.filter((entry) => (state.mastery[itemKey("character", entry.char)]?.skills.recognition ?? 0) >= .72).length;
  const nextPack = useMemo(() => {
    const now = Date.now();
    const due = pathCharacters.filter((entry) => {
      const record = state.mastery[itemKey("character", entry.char)];
      return Boolean(record?.lastSeenAt) && new Date(record?.dueAt ?? 0).getTime() <= now;
    }).sort((a, b) => new Date(state.mastery[itemKey("character", a.char)]?.dueAt ?? 0).getTime() - new Date(state.mastery[itemKey("character", b.char)]?.dueAt ?? 0).getTime()).slice(0, 2);
    const dueSet = new Set(due.map((entry) => entry.char));
    const next = pathCharacters.filter((entry) => !dueSet.has(entry.char) && (state.mastery[itemKey("character", entry.char)]?.skills.recognition ?? 0) < .72).slice(0, 8 - due.length);
    const members = [...due, ...next];
    if (!members.length) return pathPacks[0];
    return {
      id: `hsk-${pathLevel}-best-next`,
      kind: "level" as const,
      title: "Best next reading set",
      subtitle: due.length ? `${next.length} developing characters and ${due.length} returning at the right time.` : `${next.length} useful characters in a component-aware order.`,
      members,
    };
  }, [pathCharacters, pathLevel, pathPacks, state.mastery]);
  const nextPackKnown = nextPack?.members.filter((entry) => (state.mastery[itemKey("character", entry.char)]?.skills.recognition ?? 0) >= .72).length ?? 0;

  return <div className="character-page">
    <section className="character-hero">
      <div><span className="eyebrow">CHARACTER READING</span><h1>See the clue.<br/><em>Read the character.</em></h1><p>Build recognition through useful HSK sets, meaning and sound families, exact visual contrasts, and complete character pages.</p></div>
      <div className="character-progress-orbit"><span>YOUR READING MAP</span><strong>{knownCount.toLocaleString()}</strong><small>of {manifest?.characters.toLocaleString() ?? "3,088"}<br/>characters recognized</small></div>
    </section>

    <label className="character-global-search"><Search size={20}/><input aria-label="Search all HSK characters" value={query} onFocus={() => setMode("library")} onChange={(event) => {
      const value = event.target.value;
      setQuery(value);
      if (value) setMode("library");
    }} placeholder="Find a character by form, pinyin, meaning, or component…" autoComplete="off" enterKeyHint="search"/>{query && <button onClick={() => setQuery("")} aria-label="Clear character search"><X size={16}/>Clear</button>}</label>

    <nav className="character-mode-nav" aria-label="Character learning sections">
      <button aria-pressed={mode === "path"} className={mode === "path" ? "active" : ""} onClick={() => setMode("path")}><BookOpen size={17}/><span><strong>Reading path</strong><small>Every HSK character</small></span></button>
      <button aria-pressed={mode === "families"} className={mode === "families" ? "active" : ""} onClick={() => setMode("families")}><GitBranch size={17}/><span><strong>Clue families</strong><small>Meaning, sound, contrast</small></span></button>
      <button aria-pressed={mode === "library"} className={mode === "library" ? "active" : ""} onClick={() => setMode("library")}><Library size={17}/><span><strong>All characters</strong><small>Search and inspect</small></span></button>
    </nav>

    {loadError ? <section className="data-error" role="alert"><AlertTriangle size={28}/><div><h2>The character curriculum could not load</h2><p>Check your connection, then try again. Your progress remains safe.</p></div><button className="primary-button" onClick={() => window.location.reload()}><RotateCcw size={17}/> Try again</button></section>
      : loading ? <div className="character-loading"><div className="skeleton"/><div className="skeleton"/></div>
      : mode === "path" ? <>
        <section className="clue-principles">
          <div><Eye size={20}/><span><strong>1 · See the form</strong><small>Notice components and position.</small></span></div>
          <div><Ear size={20}/><span><strong>2 · Hear the clue</strong><small>Connect the shape to its syllable.</small></span></div>
          <div><BookOpen size={20}/><span><strong>3 · Read a word</strong><small>Make recognition useful immediately.</small></span></div>
        </section>
        <section className="reading-path-section">
          <div className="character-section-heading"><div><span className="eyebrow">COMPLETE READING LADDER</span><h2>Build recognition by level</h2></div><span>{pathCharacters.length.toLocaleString()} characters · {pathPacks.length} sets</span></div>
          <div className="character-level-strip" aria-label="Character HSK level">
            {levels.map((level) => <button key={level} aria-pressed={pathLevel === level} className={pathLevel === level ? "active" : ""} onClick={() => setPathLevel(level)}><strong>HSK {level}</strong><small>{manifest?.levelCounts[level] ?? 0}</small></button>)}
          </div>
          {nextPack && <button className="character-continue-card" onClick={() => startPack(nextPack)}><div><span>CONTINUE HSK {pathLevel}</span><strong>{nextPack.title}</strong><p>{nextPack.subtitle}</p></div><div className="character-continue-preview">{nextPack.members.map((member) => <b key={member.char}>{member.char}</b>)}</div><footer><span><i style={{ width: `${(nextPackKnown / nextPack.members.length) * 100}%` }}/></span><small>{nextPackKnown}/{nextPack.members.length} recognized</small><em>{nextPackKnown ? "Continue" : "Start"}<ArrowRight size={14}/></em></footer></button>}
          <div className="character-pack-grid">{pathPacks.map((pack) => <PackCard key={pack.id} pack={pack} state={state} onOpen={() => startPack(pack)}/>)}</div>
        </section>
      </> : mode === "families" ? <section className="families-section">
        <div className="character-section-heading"><div><span className="eyebrow">REUSABLE READING CLUES</span><h2>Learn one pattern. Read a family.</h2></div></div>
        <div className="family-kind-switch">
          <button aria-pressed={familyKind === "meaning"} className={familyKind === "meaning" ? "active" : ""} onClick={() => setFamilyKind("meaning")}><Shapes size={17}/><span><strong>Meaning clues</strong><small>{manifest?.familyCounts.meaning ?? 0} families</small></span></button>
          <button aria-pressed={familyKind === "sound"} className={familyKind === "sound" ? "active" : ""} onClick={() => setFamilyKind("sound")}><Volume2 size={17}/><span><strong>Sound clues</strong><small>{manifest?.familyCounts.sound ?? 0} families</small></span></button>
          <button aria-pressed={familyKind === "visual"} className={familyKind === "visual" ? "active" : ""} onClick={() => setFamilyKind("visual")}><Grid2X2 size={17}/><span><strong>Look-alikes</strong><small>{manifest?.familyCounts.visual ?? 0} contrasts</small></span></button>
        </div>
        <p className="family-guidance">{familyKind === "meaning" ? "The component suggests a meaning category—not a complete definition." : familyKind === "sound" ? "The shared part offers a pronunciation clue. Treat it as a helpful pattern, not a promise." : "Compare easily confused forms side by side until the difference becomes automatic."}</p>
        <div className="family-card-grid">{(families?.[familyKind] ?? []).map((family) => <FamilyCard key={family.id} family={family} onOpen={() => openFamily(family)} onCharacter={openCharacter}/>)}</div>
      </section> : <section className="character-library-section">
        <div className="character-section-heading"><div><span className="eyebrow">THE COMPLETE HSK CHARACTER LIBRARY</span><h2>Find any character</h2></div><span>{searchResults.length.toLocaleString()} results</span></div>
        <div className="character-library-layout">
          <div className="character-grid">{searchResults.slice(0, visibleCount).map((entry) => {
            const known = (state.mastery[itemKey("character", entry.char)]?.skills.recognition ?? 0) >= .72;
            return <button key={entry.char} className={selectedCharacter === entry.char ? "selected" : ""} onClick={() => openCharacter(entry.char)}><strong>{entry.char}</strong><span>{entry.pinyin}</span><small>{entry.english}</small><em>HSK {entry.level}{known && <Check size={11}/>}</em></button>;
          })}</div>
          {visibleCount < searchResults.length && <button className="catalog-more character-more" onClick={() => setVisibleCount((count) => count + 120)}>Load 120 more <ChevronDown size={17}/><small>{(searchResults.length - visibleCount).toLocaleString()} remaining</small></button>}
        </div>
      </section>}

    {detailOpen && <button className="study-backdrop character-backdrop" aria-label="Close character details" onClick={() => setDetailOpen(false)}/>} 
    <aside ref={detailRef} className={detailOpen ? "character-detail-panel open" : "character-detail-panel"} role={detailOpen ? "dialog" : undefined} aria-modal={detailOpen || undefined} aria-label="Character learning details" tabIndex={-1}>
      <button data-dialog-autofocus className="study-close character-detail-close" onClick={() => setDetailOpen(false)} aria-label="Close character details"><X size={20}/></button>
      {selectedCharacter && <div className="detail-navigation character-detail-nav">
        <button disabled={selectedIndex <= 0} onClick={() => openCharacter(searchResults[selectedIndex - 1]?.char)}><ChevronLeft size={18}/><span><small>Previous</small><strong>{searchResults[selectedIndex - 1]?.char ?? "—"}</strong></span></button>
        <span>Character details</span>
        <button disabled={selectedIndex < 0 || selectedIndex >= searchResults.length - 1} onClick={() => openCharacter(searchResults[selectedIndex + 1]?.char)}><span><small>Next</small><strong>{searchResults[selectedIndex + 1]?.char ?? "—"}</strong></span><ChevronRight size={18}/></button>
      </div>}
      {selectedCharacter ? <CharacterDetailView key={selectedCharacter}
        entry={indexMap.get(selectedCharacter)}
        detail={activeDetail}
        loading={detailLoading === selectedCharacter}
        failed={detailFailed === selectedCharacter}
        familyMap={familyMap}
        indexMap={indexMap}
        state={state}
        record={record}
        onCharacter={openCharacter}
        onFamily={openFamily}
        onWord={onOpenWord}
      /> : <CharacterDetailEmpty/>}
    </aside>

    {activePack && <CharacterLesson active={!detailOpen} pack={activePack} state={state} record={record} onClose={() => setActivePack(undefined)} onCharacter={openCharacter} onWord={onOpenWord}/>} 
  </div>;
}

function PackCard({ pack, state, onOpen }: { pack: CharacterPack; state: AppState; onOpen: () => void }) {
  const known = pack.members.filter((entry) => (state.mastery[itemKey("character", entry.char)]?.skills.recognition ?? 0) >= .72).length;
  return <button className="character-pack-card" onClick={onOpen}><div><span>{pack.members.map((entry) => entry.char).join(" ")}</span><em>{known}/{pack.members.length}</em></div><strong>{pack.title}</strong><p>{pack.subtitle}</p><span className="pack-progress"><i style={{ width: `${(known / pack.members.length) * 100}%` }}/></span><small>{known === pack.members.length ? "Complete" : known ? "Continue set" : "Start set"}<ArrowRight size={14}/></small></button>;
}

function FamilyCard({ family, onOpen, onCharacter }: { family: CharacterFamily; onOpen: () => void; onCharacter: (character: string) => void }) {
  return <article className={`family-card ${family.kind}`}><div><span className="family-component">{family.component}</span><span><small>{family.kind === "meaning" ? "MEANING CLUE" : family.kind === "sound" ? "SOUND CLUE" : "SHAPE CONTRAST"}</small><strong>{family.title}</strong></span></div><p>{family.subtitle}</p><div className="family-member-row">{family.members.slice(0, 9).map((member) => <button key={member.char} onClick={() => onCharacter(member.char)}><strong>{member.char}</strong><span>{member.pinyin}</span><small>{member.english}</small></button>)}</div><button className="family-learn-button" onClick={onOpen}>Learn this family <ArrowRight size={15}/></button></article>;
}

function CharacterLesson({ active, pack, state, record, onClose, onCharacter, onWord }: {
  active: boolean;
  pack: CharacterPack;
  state: AppState;
  record: RecordAttempt;
  onClose: () => void;
  onCharacter: (character: string) => void;
  onWord: (word: string) => void;
}) {
  const [phase, setPhase] = useState<"map" | "recall" | "read" | "done">("map");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [details, setDetails] = useState<Record<string, CharacterDetailData>>({});
  const lessonRef = useRef<HTMLElement>(null);
  const current = pack.members[index];
  useDialogFocus(active, lessonRef, onClose);

  useEffect(() => {
    if (phase !== "read") return;
    let active = true;
    void Promise.all(pack.members.map(async (member) => [member.char, await loadCharacterDetail(member.char)] as const)).then((items) => {
      if (active) setDetails(Object.fromEntries(items.filter((item): item is readonly [string, CharacterDetailData] => Boolean(item[1]))));
    });
    return () => { active = false; };
  }, [pack, phase]);

  const score = (value: 1 | 3) => {
    record("character", current.char, "recognition", value);
    if (index < pack.members.length - 1) {
      setIndex((position) => position + 1);
      setRevealed(false);
    } else {
      setIndex(0);
      setPhase("read");
    }
  };

  const finishLesson = () => {
    setPhase("done");
  };

  return <div className="character-lesson-backdrop"><section ref={lessonRef} className="character-lesson" role="dialog" aria-modal="true" aria-label={`${pack.title} character lesson`} tabIndex={-1}>
    <header><div><span className="eyebrow">{phase === "map" ? "NOTICE" : phase === "recall" ? `RECALL · ${index + 1}/${pack.members.length}` : phase === "read" ? "READ IN WORDS" : "SET COMPLETE"}</span><strong>{pack.title}</strong></div><button data-dialog-autofocus onClick={onClose} aria-label="Close lesson"><X size={20}/></button></header>
    <div className="character-lesson-progress"><span style={{ width: phase === "map" ? "12%" : phase === "recall" ? `${20 + ((index + 1) / pack.members.length) * 52}%` : phase === "read" ? "86%" : "100%" }}/></div>
    {phase === "map" ? <div className="character-map-phase">
      <div className="lesson-clue"><Layers3 size={22}/><span><small>{pack.kind === "meaning" ? "MEANING COMPONENT" : pack.kind === "sound" ? "SOUND COMPONENT" : pack.kind === "visual" ? "COMPARE THE FORMS" : "READING SET"}</small><strong>{pack.component ?? pack.members.map((member) => member.char).join(" · ")}</strong><p>{pack.subtitle}</p></span></div>
      <div className="lesson-character-map">{pack.members.map((member) => <button key={member.char} onClick={() => onCharacter(member.char)}><strong>{member.char}</strong><span>{member.pinyin}</span><small>{member.english}</small></button>)}</div>
      <div className="lesson-method-note">{pack.kind === "meaning" ? "Use the shared component to predict a broad meaning area." : pack.kind === "sound" ? "Listen for the shared final or syllable pattern; tones and initials may change." : pack.kind === "visual" ? "Name the exact stroke or component that makes each character different." : "Meet the whole set first. Next, retrieve each sound and meaning without English."}</div>
      <button className="primary-button lesson-next" onClick={() => setPhase("recall")}>Start recall <ArrowRight size={17}/></button>
    </div> : phase === "recall" ? <div className="character-recall-phase">
      <div className="recall-character"><strong>{current.char}</strong></div>
      {!revealed ? <><p>Say the sound and one meaning before you reveal.</p><button className="primary-button" onClick={() => setRevealed(true)}>Reveal sound + meaning</button></> : <div className="recall-reveal"><PinyinLine pinyin={current.pinyin} mode="always"/><h2>{current.english}</h2><AudioButton text={current.char} speed={state.preferences.audioSpeed} gender={state.preferences.voiceGender}/><div><button onClick={() => score(1)}>Still learning</button><button onClick={() => score(3)}><Check size={16}/> Recognized</button></div></div>}
    </div> : phase === "read" ? <div className="character-read-phase">
      <div className="lesson-read-heading"><span className="eyebrow">CHARACTER → WORD → MEANING</span><h2>Now read them where they matter.</h2></div>
      <div className="lesson-word-bridges">{pack.members.map((member) => {
        const word = details[member.char]?.words[0];
        return <article key={member.char}><button className="bridge-character" onClick={() => onCharacter(member.char)}>{member.char}</button>{word ? <button className="bridge-word" onClick={() => onWord(word.word)}><strong>{highlightCharacter(word.word, member.char)}</strong><span>{word.pinyin}</span><small>{word.english}</small><ChevronRight size={15}/></button> : <div className="bridge-word"><strong>{member.char}</strong><span>{member.pinyin}</span><small>{member.english}</small></div>}</article>;
      })}</div>
      <button className="primary-button lesson-next" onClick={finishLesson}>Finish set <ArrowRight size={17}/></button>
    </div> : <div className="character-done-phase"><div><CheckCircle2 size={30}/></div><span className="eyebrow">READING SET COMPLETE</span><h1>{pack.members.map((member) => member.char).join(" ")}</h1><p>You connected each form to sound, meaning, and a useful word. Difficult characters will return in later sets.</p><button className="primary-button" onClick={onClose}>Back to reading path</button></div>}
  </section></div>;
}

function CharacterDetailView({ entry, detail, loading, failed, familyMap, indexMap, state, record, onCharacter, onFamily, onWord }: {
  entry?: CharacterIndexEntry;
  detail?: CharacterDetailData;
  loading: boolean;
  failed: boolean;
  familyMap: Map<string, CharacterFamily>;
  indexMap: Map<string, CharacterIndexEntry>;
  state: AppState;
  record: RecordAttempt;
  onCharacter: (character: string) => void;
  onFamily: (family: CharacterFamily) => void;
  onWord: (word: string) => void;
}) {
  const [showWriting, setShowWriting] = useState(false);
  if (!entry) return <CharacterDetailEmpty/>;
  const mastery = state.mastery[itemKey("character", entry.char)]?.skills.recognition ?? 0;
  const linkedFamilies = detail ? Object.values(detail.familyIds).map((id) => id ? familyMap.get(id) : undefined).filter((family): family is CharacterFamily => Boolean(family)) : [];
  const componentEntries = detail ? [detail.semantic, detail.phonetic].filter((value, index, source) => value && source.indexOf(value) === index).map((component) => indexMap.get(component)).filter((value): value is CharacterIndexEntry => Boolean(value)) : [];
  const soundClue = phoneticClue(detail, indexMap);
  // Same-sound confusables: group every indexed character by tone-stripped pinyin.
  const bareSound = entry.pinyin.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const soundAlikes = [...indexMap.values()].filter((other) => other.char !== entry.char
    && other.pinyin.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === bareSound)
    .sort((a, b) => a.frequencyRank - b.frequencyRank).slice(0, 8);
  // Word power: rank member words by the best (lowest) frequency rank of their characters.
  const wordRank = (word: string) => Math.min(...Array.from(word).map((ch) => indexMap.get(ch)?.frequencyRank ?? 99999));
  const powerWords = detail ? [...detail.words].sort((a, b) => wordRank(a.word) - wordRank(b.word)) : [];
  return <div className="character-detail-view">
    <div className="character-detail-hero"><div className="study-badges"><span>HSK {entry.level}</span><span>{entry.strokes} strokes</span></div><div><strong>{entry.char}</strong><AudioButton text={entry.char} speed={state.preferences.audioSpeed} gender={state.preferences.voiceGender} prefetch/></div><PinyinLine pinyin={entry.pinyin} mode="always"/><p>{detail?.definition ?? entry.english}</p>{loading && <div className="detail-data-status"><span/>Loading words and clues…</div>}{failed && <div className="detail-data-status unavailable">Core character data is ready. Extra details are temporarily unavailable.</div>}</div>
    {soundAlikes.length > 0 && <section className="character-signal-section"><span className="section-number">DON\u2019T CONFUSE</span><div><h3>Same sound \u2014 different meaning</h3><div className="component-links">{soundAlikes.map((other) => <button key={other.char} onClick={() => onCharacter(other.char)}>{other.char}<span>{other.pinyin}</span><small>{other.english.slice(0, 14)}</small></button>)}</div></div></section>}
    <section className="character-signal-section"><span className="section-number">CLUES</span><div><h3>How to read the form</h3><div className="character-signals"><div><small>MEANING SIDE</small><strong>{detail?.semantic || entry.radical || "—"}</strong><span>{detail?.hint || "Broad category clue—not a full definition"}</span></div><div><small>SOUND SIDE</small><strong>{detail?.phonetic || "—"}</strong><span>{soundClue}</span></div><div><small>STRUCTURE</small><strong>{cleanDecomposition(detail?.decomposition)}</strong><span>{formatCharacterType(detail?.type)}</span></div></div>{componentEntries.length > 0 && <div className="component-links"><small>Open a component</small>{componentEntries.map((component) => <button key={component.char} onClick={() => onCharacter(component.char)}>{component.char}<span>{component.pinyin}</span><ChevronRight size={12}/></button>)}</div>}</div></section>
    {detail?.words.length ? <section className="character-words-section"><span className="section-number">WORDS</span><div><h3>Read it inside useful words</h3><div>{powerWords.slice(0, 12).map((word) => <button key={word.word} onClick={() => onWord(word.word)}><strong>{highlightCharacter(word.word, entry.char)}</strong><span>{word.pinyin}</span><small>{word.english}</small><em>HSK {word.level}</em><ChevronRight size={14}/></button>)}</div></div></section> : null}
    {linkedFamilies.length > 0 && <section className="character-family-links"><span className="section-number">FAMILY</span><div><h3>Reuse the pattern</h3>{linkedFamilies.map((family) => <button key={family.id} onClick={() => onFamily(family)}><span>{family.component}</span><div><strong>{family.title}</strong><small>{family.members.map((member) => `${member.char} ${member.pinyin}`).join(" · ")}</small></div><ChevronRight size={16}/></button>)}</div></section>}
    {detail?.examples.length ? <section className="study-section full-study-section"><span className="section-number">READ</span><div><h3>See it in a sentence</h3><div className="study-examples">{detail.examples.slice(0, 4).map((example) => <article key={example.id}><div><strong>{highlightCharacter(example.chinese, entry.char)}</strong><AudioButton text={example.chinese} kind="sentence" label=""/></div><PinyinLine pinyin={example.pinyin} mode={state.preferences.showPinyin}/><p>{example.english}</p></article>)}</div></div></section> : null}
    <section className="optional-writing"><button onClick={() => setShowWriting((value) => !value)}><span><small>OPTIONAL FORM CHECK</small><strong>{showWriting ? "Hide stroke practice" : "Trace it once"}</strong></span><ChevronDown size={17}/></button>{showWriting && <HanziPractice character={entry.char} onComplete={() => record("character", entry.char, "writing", 3)}/>}</section>
    <section className="mastery-check character-mastery"><div><Target size={19}/><span><strong>Can you recognize {entry.char} inside a word?</strong><small>{mastery >= .72 ? "Recognition is currently strong" : "Answer from memory, without relying on pinyin."}</small></span></div><div><button onClick={() => record("character", entry.char, "recognition", 1)}>Still learning</button><button className={mastery >= .72 ? "known" : ""} onClick={() => record("character", entry.char, "recognition", 3)}><Check size={15}/> Recognized</button></div></section>
  </div>;
}

function CharacterDetailEmpty() {
  return <div className="study-placeholder character-detail-empty"><Shapes size={42}/><h3>Choose a character</h3><p>Its sound, components, words, families, and reading examples will appear here.</p></div>;
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/u:/g, "v").replace(/ü/g, "v").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[1-5\s'’-]+/g, "").trim();
}

function phoneticClue(detail: CharacterDetailData | undefined, indexMap: Map<string, CharacterIndexEntry>): string {
  if (!detail?.phonetic) return "No dependable sound component—learn this reading directly";
  const component = indexMap.get(detail.phonetic);
  if (!component) return "Possible historical sound clue; modern reading may differ";
  const target = normalizeSearch(detail.pinyin).split("·")[0];
  const source = normalizeSearch(component.pinyin).split("·")[0];
  if (target === source) return `Strong clue: ${component.char} is also read ${component.pinyin}`;
  const final = (pinyin: string) => pinyin.replace(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])/u, "");
  if (target && source && final(target) === final(source)) return `Useful rhyme clue: compare ${detail.pinyin} with ${component.pinyin}`;
  return `Weak or historical clue: compare ${detail.pinyin} with ${component.pinyin}`;
}

function cleanDecomposition(value?: string): string {
  if (!value || value === "？") return "Single form";
  return value.replace(/[⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻？]/gu, " + ").replace(/\s*\+\s*/g, " + ").replace(/^\s*\+|\+\s*$/g, "");
}

function formatCharacterType(value?: string): string {
  if (value === "pictophonetic") return "Meaning + sound compound";
  if (value === "ideographic") return "Meaning-built character";
  if (value === "pictographic") return "Picture-origin character";
  return "Character structure";
}

function highlightCharacter(text: string, character: string) {
  return <>{Array.from(text).map((value, index) => value === character ? <mark key={`${value}-${index}`}>{value}</mark> : value)}</>;
}
