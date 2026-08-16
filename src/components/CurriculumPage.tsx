import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  GitBranch,
  Languages,
  RotateCcw,
  Search,
  Target,
  X,
} from "lucide-react";
import type {
  AppState,
  CharacterEntry,
  CulturalTerm,
  HskLevel,
  HskManifest,
  SentenceEntry,
  Skill,
  WordEntry,
  WordDetailConnection,
  WordDetailData,
  WordInsight,
} from "../types";
import {
  chineseCharacters,
  loadCulturalTerms,
  loadHskManifest,
  loadWords,
  loadWordDetail,
} from "../lib/content";
import { itemKey, setWordLearningStatus, updatePreferences } from "../lib/storage";
import { readUiState, writeUiState } from "../lib/persistentUi";
import { trackAnalytics } from "../lib/analytics";
import { AudioButton } from "./AudioButton";
import { PinyinLine } from "./PinyinLine";
import { useDialogFocus } from "../hooks/useDialogFocus";

type RecordAttempt = (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void;
type LevelFilter = "all" | HskLevel | "culture";
type MasteryFilter = "all" | "learning" | "known";

interface CurriculumUiState {
  level?: LevelFilter;
  masteryFilter?: MasteryFilter;
  query?: string;
  visibleCount?: number;
  selectedWord?: string;
  selectedCulture?: string;
  detailOpen?: boolean;
}

interface Headword {
  word: string;
  pinyin: string;
  entries: WordEntry[];
  definitions: string[];
  searchText: string;
}

const levels: HskLevel[] = ["1", "2", "3", "4", "5", "6", "7-9"];
const posNames: Record<string, string> = {
  名: "noun", 动: "verb", 形: "adjective", 副: "adverb", 代: "pronoun", 数: "numeral",
  量: "measure word", 介: "preposition", 连: "conjunction", 助: "particle", 叹: "interjection",
  拟声: "onomatopoeia", 前缀: "prefix", 后缀: "suffix", 成语: "idiom",
};

export function CurriculumPage({ active, state, setState, record, onOpenGroup, focusWord, onOpenCharacter }: {
  active: boolean;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  record: RecordAttempt;
  onOpenGroup: () => void;
  focusWord?: string;
  onOpenCharacter: (character: string) => void;
}) {
  const savedUi = useRef(readUiState<CurriculumUiState>("word-library", {})).current;
  const [words, setWords] = useState<WordEntry[]>([]);
  const [culture, setCulture] = useState<CulturalTerm[]>([]);
  const [manifest, setManifest] = useState<HskManifest>();
  const [wordDetail, setWordDetail] = useState<{ word: string; data: WordDetailData }>();
  const [detailLoadingWord, setDetailLoadingWord] = useState<string>();
  const [detailErrorWord, setDetailErrorWord] = useState<string>();
  const [level, setLevel] = useState<LevelFilter>(savedUi.level ?? state.preferences.level);
  const [masteryFilter, setMasteryFilter] = useState<MasteryFilter>(savedUi.masteryFilter ?? "all");
  const [query, setQuery] = useState(savedUi.query ?? "");
  const [visibleCount, setVisibleCount] = useState(savedUi.visibleCount ?? 80);
  const [selectedWord, setSelectedWord] = useState<string | undefined>(savedUi.selectedWord);
  const [selectedCulture, setSelectedCulture] = useState<string | undefined>(savedUi.selectedCulture);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailOpen, setDetailOpen] = useState(savedUi.detailOpen ?? false);
  const studyPanelRef = useRef<HTMLElement>(null);
  const filtersMounted = useRef(false);
  const loadedWordLevels = useRef(new Map<HskLevel, WordEntry[]>());
  const cultureLoaded = useRef(false);
  const searchTracked = useRef(Boolean(savedUi.query?.trim()));

  useEffect(() => {
    writeUiState<CurriculumUiState>("word-library", { level, masteryFilter, query, visibleCount, selectedWord, selectedCulture, detailOpen });
  }, [detailOpen, level, masteryFilter, query, selectedCulture, selectedWord, visibleCount]);

  useEffect(() => {
    let mounted = true;
    const requestedLevels = focusWord || level === "all"
      ? levels
      : level === "culture" ? [] : [level];
    const needsCulture = level === "culture";
    const missingLevel = requestedLevels.some((item) => !loadedWordLevels.current.has(item));
    if (missingLevel || (needsCulture && !cultureLoaded.current) || !manifest) setLoading(true);
    setLoadError(false);

    void Promise.all([
      Promise.all(requestedLevels.map(async (item) => [item, await loadWords(item)] as const)),
      needsCulture ? loadCulturalTerms() : Promise.resolve(undefined),
      loadHskManifest(),
    ]).then(([loadedLevels, culturalTerms, hskManifest]) => {
      if (!mounted) return;
      for (const [item, entries] of loadedLevels) loadedWordLevels.current.set(item, entries);
      setWords(levels.flatMap((item) => loadedWordLevels.current.get(item) ?? []));
      if (culturalTerms) {
        cultureLoaded.current = true;
        setCulture(culturalTerms);
      }
      setManifest(hskManifest);
      setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [focusWord, level]);

  const headwords = useMemo(() => groupHeadwords(words), [words]);
  const headwordMap = useMemo(() => new Map(headwords.map((item) => [item.word, item])), [headwords]);
  const normalizedQuery = normalizeSearch(query.trim());
  const activeHeadword = selectedWord ? headwordMap.get(selectedWord) : undefined;
  const activeCulture = selectedCulture ? culture.find((term) => term.id === selectedCulture) : undefined;
  const selectedText = level === "culture" ? activeCulture?.word : activeHeadword?.word;
  const activeDetail = selectedWord && wordDetail?.word === selectedWord ? wordDetail.data : undefined;
  const selectedInsight = activeDetail?.insight;

  useEffect(() => {
    if (!focusWord || !headwordMap.has(focusWord)) return;
    setLevel("all");
    setQuery("");
    setSelectedCulture(undefined);
    setSelectedWord(focusWord);
    setDetailOpen(true);
  }, [focusWord, headwordMap]);

  useEffect(() => {
    if (!selectedWord) return;
    let active = true;
    setDetailLoadingWord(selectedWord);
    setDetailErrorWord(undefined);
    void loadWordDetail(selectedWord).then((data) => {
      if (!active) return;
      if (data) setWordDetail({ word: selectedWord, data });
      else setDetailErrorWord(selectedWord);
    }).catch(() => {
      if (active) setDetailErrorWord(selectedWord);
    }).finally(() => {
      if (active) setDetailLoadingWord(undefined);
    });
    return () => { active = false; };
  }, [selectedWord]);

  const results = useMemo(() => {
    if (level === "culture") {
      return culture.filter((term) => !normalizedQuery || culturalSearchText(term).includes(normalizedQuery));
    }
    return headwords.filter((item) => {
      const inLevel = level === "all" || item.entries.some((entry) => entry.level === level);
      const mastery = state.mastery[itemKey("word", item.word)]?.skills.meaning ?? 0;
      const mark = state.wordLists[item.word]?.status;
      const known = mark === "known" || mastery >= .72;
      const learning = mark === "learning" || (!known && mastery > 0);
      const inMastery = masteryFilter === "all" || (masteryFilter === "known" ? known : learning);
      return inLevel && inMastery && (!normalizedQuery || item.searchText.includes(normalizedQuery));
    });
  }, [culture, headwords, level, masteryFilter, normalizedQuery, state.mastery, state.wordLists]);

  useEffect(() => {
    if (!filtersMounted.current) { filtersMounted.current = true; return; }
    setVisibleCount(80);
    setDetailOpen(false);
  }, [level, normalizedQuery]);
  useEffect(() => {
    if (!detailOpen || !active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [active, detailOpen]);
  useEffect(() => {
    if (detailOpen) studyPanelRef.current?.scrollTo({ top: 0 });
  }, [detailOpen, selectedText]);
  useDialogFocus(detailOpen && active, studyPanelRef, () => setDetailOpen(false));

  const examples = activeDetail?.examples ?? [];
  const connection = activeDetail?.connection;
  const relatedWords = useMemo(() => {
    if (!connection) return [];
    return connection.wordKeys
      .filter((key) => key !== selectedText)
      .map((key) => headwordMap.get(key))
      .filter((item): item is Headword => Boolean(item))
      .slice(0, 12);
  }, [connection, headwordMap, selectedText]);
  const semanticWords = useMemo(() => (activeDetail?.semanticRelations ?? [])
    .map((key) => headwordMap.get(key))
    .filter((item): item is Headword => Boolean(item))
    .slice(0, 8), [activeDetail?.semanticRelations, headwordMap]);

  const selectHeadword = (word: string) => {
    const item = headwordMap.get(word);
    trackAnalytics("word_detail_open", { area: "vocabulary", detail: item?.entries[0]?.level ? `hsk-${item.entries[0].level}` : "unknown" });
    setSelectedWord(word);
    setSelectedCulture(undefined);
    setDetailOpen(true);
  };

  const wordResultPool = level !== "culture" ? results as Headword[] : [];
  const cultureResultPool = level === "culture" ? results as CulturalTerm[] : [];
  const resultIndex = level === "culture"
    ? cultureResultPool.findIndex((item) => item.id === selectedCulture)
    : wordResultPool.findIndex((item) => item.word === selectedWord);
  const detailPool = level === "culture" ? cultureResultPool : resultIndex >= 0 ? wordResultPool : headwords;
  const detailIndex = level === "culture"
    ? detailPool.findIndex((item) => "id" in item && item.id === selectedCulture)
    : detailPool.findIndex((item) => "entries" in item && item.word === selectedWord);
  const previousDetail = detailIndex > 0 ? detailPool[detailIndex - 1] : undefined;
  const nextDetail = detailIndex >= 0 && detailIndex < detailPool.length - 1 ? detailPool[detailIndex + 1] : undefined;

  const navigateDetail = (item: Headword | CulturalTerm | undefined) => {
    if (!item) return;
    if ("entries" in item) selectHeadword(item.word);
    else { setSelectedCulture(item.id); setSelectedWord(undefined); setDetailOpen(true); }
  };

  const chooseLevel = (next: LevelFilter) => {
    trackAnalytics("level_select", { area: "vocabulary", detail: next });
    setLevel(next);
    setSelectedCulture(undefined);
    setSelectedWord(undefined);
    if (next !== "all" && next !== "culture") {
      setState((current) => updatePreferences(current, { level: next }));
    }
  };
  const knownHeadwords = useMemo(() => new Set([
    ...Object.values(state.mastery).filter((item) => item.kind === "word" && (item.skills.meaning ?? 0) >= .72).map((item) => item.text),
    ...Object.entries(state.wordLists).filter(([, item]) => item.status === "known").map(([word]) => word),
  ]).size, [state.mastery, state.wordLists]);
  const learningHeadwords = useMemo(() => Object.values(state.wordLists).filter((item) => item.status === "learning").length, [state.wordLists]);

  const openConnection = () => {
    if (!connection) return;
    setState((current) => updatePreferences(current, {
      learningEngine: connection.engine,
      selectedNetworkId: connection.id,
    }));
    onOpenGroup();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <div className="curriculum-page">
    <section className="curriculum-hero">
      <div>
        <span className="eyebrow">WORD LIBRARY</span>
        <h1>Find a word.<br/><em>Understand its world.</em></h1>
        <p>Search Chinese, pinyin, or English. Every word opens into pronunciation, exact meanings, character structure, natural examples, chunks, and a connected learning group.</p>
      </div>
      <div className="syllabus-proof">
        <BookOpenCheck size={22}/>
        <span>Official syllabus</span>
        <strong>{manifest?.coreEntries.toLocaleString() ?? "11,000"}</strong>
        <small>entries · November 2025<br/>effective July 2026</small>
      </div>
    </section>

    <label className="curriculum-search">
      <Search size={22}/>
      <input aria-label="Search all HSK vocabulary" value={query} onChange={(event) => {
        const value = event.target.value;
        setQuery(value);
        if (value.trim() && !searchTracked.current) {
          searchTracked.current = true;
          trackAnalytics("search_used", { area: "vocabulary", detail: "library" });
        } else if (!value.trim()) searchTracked.current = false;
        if (value.trim() && level !== "all") chooseLevel("all");
      }} placeholder="Try 学习, xuexi, or study…" autoComplete="off" enterKeyHint="search"/>
      {query && <button onClick={() => { setQuery(""); searchTracked.current = false; }} aria-label="Clear search">Clear</button>}
    </label>

    <div className="level-strip" aria-label="HSK level filters">
      <LevelButton active={level === "all"} label="All" count={manifest?.uniqueHeadwords ?? headwords.length} onClick={() => chooseLevel("all")}/>
      {levels.map((item) => <LevelButton key={item} active={level === item} label={`HSK ${item}`} count={manifest?.levelCounts[item] ?? 0} onClick={() => chooseLevel(item)}/>)}
      <LevelButton active={level === "culture"} label="Culture" count={manifest?.culturalTerms ?? culture.length} onClick={() => chooseLevel("culture")}/>
    </div>

    <div className="vocabulary-toolbar">
      <div><strong>{knownHeadwords.toLocaleString()}</strong><span>known · {learningHeadwords.toLocaleString()} learning</span></div>
      {level !== "culture" && <div className="mastery-filter" aria-label="Filter by learning status"><button aria-pressed={masteryFilter === "all"} className={masteryFilter === "all" ? "active" : ""} onClick={() => setMasteryFilter("all")}>All</button><button aria-pressed={masteryFilter === "learning"} className={masteryFilter === "learning" ? "active" : ""} onClick={() => setMasteryFilter("learning")}>Learning</button><button aria-pressed={masteryFilter === "known"} className={masteryFilter === "known" ? "active" : ""} onClick={() => setMasteryFilter("known")}>Known</button></div>}
      <button className="toolbar-learn-button" onClick={onOpenGroup}><GitBranch size={16}/><span><strong>Learn a connected group</strong><small>New words plus timely refresh</small></span><ArrowRight size={15}/></button>
    </div>

    {loadError ? <section className="data-error" role="alert">
      <AlertTriangle size={28}/><div><h2>The vocabulary library could not load</h2><p>Check your connection, then try again. Your learning progress is safe on this device.</p></div>
      <button className="primary-button" onClick={() => window.location.reload()}><RotateCcw size={17}/> Try again</button>
    </section> : loading ? <div className="catalog-loading"><div className="skeleton"/><div className="skeleton"/></div> : <div className="curriculum-browser">
      <section className="catalog-panel">
        <div className="catalog-heading">
          <div><span className="eyebrow">{level === "all" ? "ALL LEVELS" : level === "culture" ? "CULTURAL KNOWLEDGE" : `HSK ${level}`}</span><h2>{normalizedQuery ? `Results for “${query.trim()}”` : levelTitle(level)}</h2></div>
          <span>{results.length.toLocaleString()} {level === "culture" ? "terms" : "headwords"}</span>
        </div>

        <div className="catalog-list">
          {level === "culture" ? (results as CulturalTerm[]).slice(0, visibleCount).map((term) => (
            <button key={term.id} className={activeCulture?.id === term.id ? "catalog-row selected" : "catalog-row"} onClick={() => { setSelectedCulture(term.id); setSelectedWord(undefined); setDetailOpen(true); }}>
              <span className="catalog-word">{term.word}</span>
              <span className="catalog-pinyin">{term.pinyin || term.category}</span>
              <span className="catalog-meaning">{term.definitions[0] || categoryName(term.category)}</span>
              <span className="catalog-level">{term.stage}</span>
            </button>
          )) : (results as Headword[]).slice(0, visibleCount).map((item) => {
            const mark = state.wordLists[item.word]?.status;
            const known = mark === "known" || (state.mastery[itemKey("word", item.word)]?.skills.meaning ?? 0) >= .72;
            return <button key={item.word} className={activeHeadword?.word === item.word ? "catalog-row selected" : "catalog-row"} onClick={() => selectHeadword(item.word)}>
              <span className="catalog-word">{item.word}{known ? <Check size={13}/> : mark === "learning" ? <Bookmark size={12}/> : null}</span>
              <span className="catalog-pinyin">{item.pinyin}</span>
              <span className="catalog-meaning">{item.definitions[0] || "Meaning coming soon"}</span>
              <span className="catalog-level">HSK {item.entries[0]?.level}</span>
            </button>;
          })}
          {results.length === 0 && <div className="empty-results"><Search size={28}/><strong>No exact match yet</strong><p>Try Chinese characters, tone-free pinyin, or a simpler English meaning.</p></div>}
        </div>

        {visibleCount < results.length && <button className="catalog-more" onClick={() => setVisibleCount((count) => count + 100)}>
          Load 100 more <ChevronDown size={17}/><small>{(results.length - visibleCount).toLocaleString()} remaining</small>
        </button>}
      </section>

      {detailOpen && <button className="study-backdrop" aria-label="Close word details" onClick={() => setDetailOpen(false)}/>}
      <aside ref={studyPanelRef} className={detailOpen ? "word-study-panel mobile-open" : "word-study-panel"} aria-label="Word learning details" role={detailOpen ? "dialog" : undefined} aria-modal={detailOpen || undefined} tabIndex={-1}>
        <button data-dialog-autofocus className="study-close" onClick={() => setDetailOpen(false)} aria-label="Close word details"><X size={20}/></button>
        {(activeHeadword || activeCulture) && <div className="detail-navigation" aria-label="Browse vocabulary details">
          <button disabled={!previousDetail} onClick={() => navigateDetail(previousDetail)} aria-label={previousDetail ? `Previous: ${previousDetail.word}` : "No previous word"}><ChevronLeft size={18}/><span><small>Previous</small><strong>{previousDetail?.word ?? "—"}</strong></span></button>
          <span>{detailIndex >= 0 ? `${(detailIndex + 1).toLocaleString()} / ${detailPool.length.toLocaleString()}` : "Word details"}</span>
          <button disabled={!nextDetail} onClick={() => navigateDetail(nextDetail)} aria-label={nextDetail ? `Next: ${nextDetail.word}` : "No next word"}><span><small>Next</small><strong>{nextDetail?.word ?? "—"}</strong></span><ChevronRight size={18}/></button>
        </div>}
        {activeHeadword && level !== "culture" ? <WordStudy
          item={activeHeadword}
          state={state}
          characters={activeDetail?.characters ?? {}}
          examples={examples}
          connection={connection}
          relatedWords={relatedWords}
          semanticWords={semanticWords}
          insight={selectedInsight}
          detailLoading={detailLoadingWord === selectedWord}
          detailUnavailable={detailErrorWord === selectedWord}
          record={record}
          onSetStatus={(status) => setState((current) => setWordLearningStatus(current, itemWord(activeHeadword), status))}
          onOpenConnection={openConnection}
          onSelectWord={selectHeadword}
          hasWord={(word) => headwordMap.has(word)}
          onOpenCharacter={onOpenCharacter}
        /> : activeCulture && level === "culture" ? <CultureStudy term={activeCulture} examples={[]}/> : <div className="study-placeholder"><Languages size={42}/><h3>Choose a word</h3><p>Its complete learning page will appear here.</p></div>}
      </aside>
    </div>}
  </div>;
}

function WordStudy({ item, state, characters, examples, connection, relatedWords, semanticWords, insight, detailLoading, detailUnavailable, record, onSetStatus, onOpenConnection, onSelectWord, hasWord, onOpenCharacter }: {
  item: Headword;
  state: AppState;
  characters: Record<string, CharacterEntry>;
  examples: SentenceEntry[];
  connection?: WordDetailConnection;
  relatedWords: Headword[];
  semanticWords: Headword[];
  insight?: WordInsight;
  detailLoading: boolean;
  detailUnavailable: boolean;
  record: RecordAttempt;
  onSetStatus: (status?: "learning" | "known") => void;
  onOpenConnection: () => void;
  onSelectWord: (word: string) => void;
  hasWord: (word: string) => boolean;
  onOpenCharacter: (character: string) => void;
}) {
  const primary = item.entries[0];
  const chars = chineseCharacters(item.word);
  const masteryRecord = state.mastery[itemKey("word", item.word)];
  const listStatus = state.wordLists[item.word]?.status;
  const mastery = masteryRecord?.skills.meaning ?? 0;
  const skillProfile = [
    ["Sound", masteryRecord?.skills.sound ?? 0],
    ["Meaning", masteryRecord?.skills.meaning ?? 0],
    ["In context", masteryRecord?.skills.context ?? 0],
  ] as const;
  const grammar = insight?.grammarPoints.map((entry) => entry.point) ?? Array.from(new Set(examples.flatMap((example) => example.grammarPoints))).slice(0, 8);
  const collocations = insight?.collocations.slice(0, 10) ?? [];

  return <div className="word-study">
    <div className="study-word-hero">
      <div className="study-badges"><span>HSK {primary.level}</span>{primary.partOfSpeech && <span>{formatPos(primary.partOfSpeech)}</span>}</div>
      <div className="study-word-line"><strong>{item.word}</strong><AudioButton text={item.word} speed={state.preferences.audioSpeed} gender={state.preferences.voiceGender} prefetch/></div>
      <PinyinLine pinyin={item.pinyin} mode="always"/>
      {primary.traditional && primary.traditional !== item.word && <small>Traditional · {primary.traditional}</small>}
      {detailLoading && <div className="detail-data-status" aria-live="polite"><span/>Loading examples and connections…</div>}
      {detailUnavailable && <div className="detail-data-status unavailable" role="status">Core word data is ready. Extra examples are temporarily unavailable.</div>}
      <div className="word-list-actions" aria-label="Word learning status"><button aria-pressed={listStatus === "learning"} className={listStatus === "learning" ? "learning active" : "learning"} onClick={() => onSetStatus(listStatus === "learning" ? undefined : "learning")}><Bookmark size={15}/> Learning</button><button aria-pressed={listStatus === "known"} className={listStatus === "known" ? "known active" : "known"} onClick={() => onSetStatus(listStatus === "known" ? undefined : "known")}><Check size={15}/> Known</button></div>
    </div>

    <section className="study-section meaning-section">
      <span className="section-number">01</span><div><h3>Meaning</h3><ol>{item.definitions.slice(0, 7).map((definition) => <li key={definition}>{definition}</li>)}</ol></div>
    </section>

    {item.entries.length > 1 && <section className="study-section">
      <span className="section-number">02</span><div><h3>Official senses</h3><div className="sense-list">{item.entries.map((entry) => <div key={`${entry.level}-${entry.id}`}><span>HSK {entry.level}</span><strong>{entry.sourceWord}</strong><small>{formatPos(entry.partOfSpeech)}</small></div>)}</div></div>
    </section>}

    {chars.length > 0 && <section className="study-section">
      <span className="section-number">{item.entries.length > 1 ? "03" : "02"}</span><div><h3>Character building blocks</h3><div className="character-blocks">{chars.map((char) => <button key={char} onClick={() => onOpenCharacter(char)}><strong>{char}</strong><span>{characters[char]?.pinyin.join(" · ") || "—"}</span><small>{characters[char]?.definition || "Open character details"}</small><ChevronRight size={14}/></button>)}</div></div>
    </section>}

    {examples.length > 0 && <section className="study-section full-study-section">
      <span className="section-number">USE</span><div><h3>Examples in context</h3>{insight?.topics.length ? <div className="topic-tags">{insight.topics.map((topic) => <span key={topic.topic}>{topicName(topic.topic)}</span>)}</div> : null}<div className="study-examples">{examples.map((example) => <article key={`${example.source}-${example.id}`}><div><strong>{highlight(example.chinese, item.word)}</strong><AudioButton text={example.chinese} kind="sentence" speed={state.preferences.audioSpeed} gender={state.preferences.voiceGender} label=""/></div><PinyinLine pinyin={example.pinyin} mode={state.preferences.showPinyin}/><p>{example.english}</p>{example.hskLevel > 0 && <small>{example.source === "tatoeba" ? `Open example · ${String(example.attribution?.chineseAuthor ?? "contributor")}` : `HSK ${example.hskLevel}`}</small>}</article>)}</div>{grammar.length > 0 && <><h4 className="micro-heading">Patterns seen with this word</h4><div className="grammar-tags">{grammar.map((point) => <span key={point}>{point}</span>)}</div></>}</div>
    </section>}

    {connection && <section className="connection-card">
      <div><GitBranch size={19}/><span><small>LEARN IT AS A FAMILY</small><strong>{connection.title}</strong></span></div>
      <p>{connection.subtitle}</p>
      {relatedWords.length > 0 && <div className="related-words">{relatedWords.map((word) => <button key={word.word} onClick={() => onSelectWord(word.word)}><span><strong>{word.word}</strong><small>{word.pinyin}</small></span><em>{word.definitions[0]}</em><ChevronRight size={14}/></button>)}</div>}
      {semanticWords.length > 0 && <div className="meaning-neighbors"><b>Meaning neighbors</b><p>Related by sense—not always interchangeable.</p><div>{semanticWords.map((word) => <button key={word.word} onClick={() => onSelectWord(word.word)}><strong>{word.word}</strong><span>{word.pinyin}</span><small>{word.definitions[0]}</small></button>)}</div></div>}
      {collocations.length > 0 && <div className="natural-chunks"><b>Natural chunks</b>{collocations.map((chunk) => {
        const clickable = hasWord(chunk.phrase);
        const parts = Array.from(new Set(chunk.wordKeys)).filter(hasWord);
        return <div className="natural-chunk-card" key={chunk.phrase}><button className="chunk-main" disabled={!clickable} onClick={() => clickable && onSelectWord(chunk.phrase)}><span><strong>{chunk.phrase}</strong><small>{chunk.pinyin}</small></span><em>{chunk.english}</em>{clickable && <ChevronRight size={14}/>}</button>{parts.length > 0 && <div className="chunk-parts"><small>Open a word</small>{parts.map((word) => <button key={word} onClick={() => onSelectWord(word)}>{word}<ChevronRight size={11}/></button>)}</div>}</div>;
      })}</div>}
      <button className="primary-button wide" onClick={onOpenConnection}>Learn this connected group <ArrowRight size={17}/></button>
    </section>}

    {masteryRecord && <section className="word-memory-map"><div><span>MEMORY MAP</span><strong>What is strong—and what needs another encounter</strong></div><div>{skillProfile.map(([label, value]) => <span key={label}><small>{label}</small><i><b style={{ width: `${Math.round(value * 100)}%` }}/></i><em>{value >= .72 ? "strong" : value > 0 ? "growing" : "not checked"}</em></span>)}</div></section>}

    <section className="mastery-check">
      <div><Target size={19}/><span><strong>Can you retrieve this word?</strong><small>{mastery >= .72 ? "Meaning is currently strong" : "Your answer shapes future learning groups."}</small></span></div>
      <div><button onClick={() => { onSetStatus("learning"); record("word", item.word, "meaning", 1); }}>Still learning</button><button className={mastery >= .72 || listStatus === "known" ? "known" : ""} onClick={() => { onSetStatus("known"); record("word", item.word, "meaning", 3); }}><Check size={15}/> I know this</button></div>
    </section>
  </div>;
}

function itemWord(item: Headword): string {
  return item.word;
}

function CultureStudy({ term, examples }: { term: CulturalTerm; examples: SentenceEntry[] }) {
  return <div className="word-study">
    <div className="study-word-hero culture-hero"><div className="study-badges"><span>{term.stage}</span><span>{categoryName(term.category)}</span></div><div className="study-word-line"><strong>{term.word}</strong>{term.pinyin && <AudioButton text={term.word}/>}</div>{term.pinyin && <PinyinLine pinyin={term.pinyin} mode="always"/>}</div>
    <section className="study-section meaning-section"><span className="section-number">文化</span><div><h3>What to know</h3><p>{term.definitions[0] || `${term.word} is an official HSK cultural knowledge item in the ${categoryName(term.category)} category.`}</p>{term.traditional && term.traditional !== term.word && <small>Traditional · {term.traditional}</small>}</div></section>
    {examples.length > 0 && <section className="study-section full-study-section"><span className="section-number">USE</span><div><h3>Examples</h3><div className="study-examples">{examples.slice(0, 5).map((example) => <article key={`${example.source}-${example.id}`}><div><strong>{example.chinese}</strong><AudioButton text={example.chinese} kind="sentence" label=""/></div><p>{example.pinyin}</p><p>{example.english}</p></article>)}</div></div></section>}
  </div>;
}

function LevelButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button aria-pressed={active} className={active ? "active" : ""} onClick={onClick}><strong>{label}</strong><small>{count.toLocaleString()}</small></button>;
}

function groupHeadwords(words: WordEntry[]): Headword[] {
  const groups = new Map<string, WordEntry[]>();
  for (const word of words) groups.set(word.word, [...(groups.get(word.word) ?? []), word]);
  return [...groups.entries()].map(([word, entries]) => {
    const definitions = Array.from(new Set(entries.flatMap((entry) => entry.definitions).filter(Boolean)));
    const pinyins = Array.from(new Set(entries.map((entry) => entry.pinyin).filter(Boolean)));
    return {
      word,
      entries: [...entries].sort((a, b) => levels.indexOf(a.level) - levels.indexOf(b.level) || (a.syllabusSort ?? a.id) - (b.syllabusSort ?? b.id)),
      pinyin: pinyins.join(" · "),
      definitions,
      searchText: normalizeSearch(`${word} ${entries.map((entry) => entry.traditional ?? "").join(" ")} ${pinyins.join(" ")} ${definitions.join(" ")}`),
    };
  }).sort((a, b) => levels.indexOf(a.entries[0].level) - levels.indexOf(b.entries[0].level) || (a.entries[0].syllabusSort ?? a.entries[0].id) - (b.entries[0].syllabusSort ?? b.entries[0].id));
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/u:/g, "v").replace(/ü/g, "v").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[1-5\s'’-]+/g, "").trim();
}

function culturalSearchText(term: CulturalTerm): string {
  return normalizeSearch(`${term.word} ${term.traditional ?? ""} ${term.pinyin} ${term.category} ${term.stage} ${term.definitions.join(" ")}`);
}

function formatPos(value?: string): string {
  if (!value) return "";
  return value.split(/[、，,（）()]/).filter(Boolean).map((part) => posNames[part] ?? part).join(" · ");
}

function categoryName(category: string): string {
  const names: Record<string, string> = { 神话人物: "Mythology", 书名: "Classic literature", 小说人物: "Literary figure", 艺术作品: "Art", 学派: "School of thought", 四大菜系: "Cuisine", 省级行政区域简称: "Regional abbreviation" };
  return names[category] ?? category;
}

function topicName(value: string): string {
  const names: Record<string, string> = { greetings: "Greetings", identity: "People & identity", family: "Family", food: "Food & drink", time: "Time", school_work: "School & work", daily_actions: "Daily life", feelings: "Feelings", sports_leisure: "Leisure", travel: "Travel", health: "Health", shopping: "Shopping", questions: "Questions", objects_misc: "Everyday things", "real-world examples": "Real-world Chinese" };
  return names[value] ?? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function levelTitle(level: LevelFilter): string {
  if (level === "all") return "The complete HSK vocabulary";
  if (level === "culture") return "Culture that unlocks context";
  const titles: Record<HskLevel, string> = { "1": "Start with the essentials", "2": "Build your foundation", "3": "Handle everyday Chinese", "4": "Become independent", "5": "Express more precisely", "6": "Read with range", "7-9": "Master advanced Chinese" };
  return titles[level];
}

function highlight(sentence: string, word: string): React.ReactNode {
  const index = sentence.indexOf(word);
  if (index < 0) return sentence;
  return <>{sentence.slice(0, index)}<mark>{word}</mark>{sentence.slice(index + word.length)}</>;
}
