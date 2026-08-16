import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, Search, Shapes, WholeWord } from "lucide-react";
import type { AppState, BaseNetwork, CharacterEntry, LearningEngine, NetworkData, ReadingEntry, SentenceEntry, Skill, WordEntry } from "../types";
import { chineseCharacters, loadAllWords, loadCharacters, loadNetworks, loadOpenDictionary, loadReadings, loadSentences, loadTatoebaSentences } from "../lib/content";
import { AudioButton } from "./AudioButton";
import { HanziPractice } from "./HanziPractice";
import { PinyinLine } from "./PinyinLine";
import { ScoreButtons } from "./ScoreButtons";

const packOptions: Array<{ value: Exclude<LearningEngine, "smart">; label: string }> = [
  { value: "word-web", label: "Word webs" },
  { value: "sound-family", label: "Sound families" },
  { value: "meaning-family", label: "Meaning families" },
  { value: "scenario", label: "Situations" },
  { value: "contrast", label: "Contrast practice" },
];

export function ExplorePage({ state, record, onStudyNetwork }: {
  state: AppState;
  record: (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void;
  onStudyNetwork: (engine: LearningEngine, networkId: string) => void;
}) {
  const [mode, setMode] = useState<"packs" | "words" | "characters" | "reading">("packs");
  const [networkMode, setNetworkMode] = useState<Exclude<LearningEngine, "smart">>("word-web");
  const [query, setQuery] = useState("");
  const [words, setWords] = useState<WordEntry[]>([]);
  const [characters, setCharacters] = useState<Record<string, CharacterEntry>>({});
  const [readings, setReadings] = useState<ReadingEntry[]>([]);
  const [networks, setNetworks] = useState<NetworkData>();
  const [sentences, setSentences] = useState<SentenceEntry[]>([]);
  const [selectedWord, setSelectedWord] = useState<WordEntry>();
  const [selectedChar, setSelectedChar] = useState<string>();
  const [selectedNetwork, setSelectedNetwork] = useState<BaseNetwork>();
  const [showAllLevels, setShowAllLevels] = useState(false);
  const [visibleCount, setVisibleCount] = useState(80);
  const [visibleReadingCount, setVisibleReadingCount] = useState(30);

  useEffect(() => {
    void Promise.all([loadAllWords(), loadOpenDictionary(), loadCharacters(), loadReadings(), loadNetworks(), loadSentences(), loadTatoebaSentences()]).then(([hskWords, openWords, allCharacters, allReadings, allNetworks, hskSentences, tatoebaSentences]) => {
      const mergedWords = [...new Map([...hskWords, ...openWords].map((word) => [word.word, word])).values()];
      setWords(mergedWords);
      setCharacters(allCharacters);
      setReadings(allReadings);
      setNetworks(allNetworks);
      setSentences([...hskSentences, ...tatoebaSentences]);
    });
  }, []);
  useEffect(() => { setVisibleCount(80); }, [query, mode, showAllLevels, state.preferences.level, networkMode]);
  useEffect(() => { setSelectedNetwork(undefined); }, [networkMode]);

  const matchingWords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized) return words.filter((word) => word.word.includes(normalized) || word.pinyin.toLowerCase().includes(normalized) || word.definitions.some((definition) => definition.toLowerCase().includes(normalized)));
    return showAllLevels ? words : words.filter((word) => word.level === state.preferences.level);
  }, [query, words, state.preferences.level, showAllLevels]);
  const wordResults = matchingWords.slice(0, visibleCount);

  const allMatchingCharacters = useMemo(() => {
    const direct = chineseCharacters(query);
    if (direct.length) return direct.filter((char) => characters[char]);
    const sourceWords = query.trim() ? matchingWords : showAllLevels ? words : words.filter((word) => word.level === state.preferences.level);
    return Array.from(new Set(sourceWords.flatMap((word) => chineseCharacters(word.word)))).filter((char) => characters[char]);
  }, [characters, query, matchingWords, words, state.preferences.level, showAllLevels]);
  const charResults = allMatchingCharacters.slice(0, visibleCount);

  const currentNetworks = useMemo(() => {
    if (!networks) return [];
    const source = networkMode === "word-web" ? networks.wordWebs
      : networkMode === "sound-family" ? networks.soundFamilies
      : networkMode === "meaning-family" ? networks.meaningFamilies
      : networkMode === "scenario" ? networks.scenarios
      : networks.contrastSets;
    const normalized = query.trim().toLowerCase();
    const maxLevel = state.preferences.level === "7-9" ? 7 : Number(state.preferences.level) + 1;
    return source.filter((network) => {
      const levelOk = showAllLevels || network.minLevel <= maxLevel;
      const text = `${network.title} ${network.subtitle} ${network.wordKeys.join(" ")}`.toLowerCase();
      return levelOk && (!normalized || text.includes(normalized));
    });
  }, [networks, networkMode, query, showAllLevels, state.preferences.level]);

  const totalPacks = networks ? networks.wordWebs.length + networks.soundFamilies.length + networks.meaningFamilies.length + networks.scenarios.length + networks.contrastSets.length : 0;

  const gradedSentenceStream = useMemo(() => {
    const maxLevel = state.preferences.level === "7-9" ? 9 : Number(state.preferences.level);
    return sentences
      .filter((sentence) => sentence.source !== "tatoeba" && sentence.hskLevel <= maxLevel)
      .sort((a, b) => a.hskLevel - b.hskLevel || a.chinese.length - b.chinese.length);
  }, [sentences, state.preferences.level]);

  return <div className="page simple-library-page">
    <section className="compact-page-heading"><span className="eyebrow">LIBRARY</span><h1>Find a system.<br/>Start learning.</h1><p>{totalPacks.toLocaleString()} connected packs · {words.length.toLocaleString()} searchable words · {Object.keys(characters).length.toLocaleString()} characters</p></section>

    <div className="simple-library-tabs">
      <button className={mode === "packs" ? "active" : ""} onClick={() => setMode("packs")}>Packs</button>
      <button className={mode === "words" ? "active" : ""} onClick={() => setMode("words")}>Words</button>
      <button className={mode === "characters" ? "active" : ""} onClick={() => setMode("characters")}>Characters</button>
      <button className={mode === "reading" ? "active" : ""} onClick={() => setMode("reading")}>Reading</button>
    </div>

    {mode !== "reading" && <div className="simple-filter-row">
      {mode === "packs" && <select value={networkMode} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setNetworkMode(event.target.value as Exclude<LearningEngine, "smart">)}>{packOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
      <label className="search-box simple-search"><Search size={18}/><input value={query} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder={mode === "packs" ? "Search a topic, character, or word…" : "Search Chinese, pinyin, or English…"}/></label>
      <button className={showAllLevels ? "scope-button active" : "scope-button"} onClick={() => setShowAllLevels((value) => !value)}>{showAllLevels ? "All levels" : `HSK ${state.preferences.level}`}</button>
    </div>}

    {mode === "packs" && <div className="network-browser-layout simple-browser-layout">
      <div className="network-card-list simple-pack-list">{currentNetworks.map((network) => <button key={network.id} className={selectedNetwork?.id === network.id ? "network-library-card selected" : "network-library-card"} onClick={() => setSelectedNetwork(network)}><span>{networkSymbol(network)}</span><div><strong>{network.title}</strong><small>{network.subtitle}</small><em>{network.wordKeys.length} connected words · HSK {network.minLevel}+</em></div></button>)}</div>
      <aside className="detail-panel network-detail">{selectedNetwork ? <NetworkDetail network={selectedNetwork} words={words} onStudy={() => onStudyNetwork(networkMode, selectedNetwork.id)}/> : <EmptyDetail text="Choose a pack to preview its vocabulary and natural chunks."/>}</aside>
    </div>}

    {mode === "words" && <div className="browser-layout simple-browser-layout"><div><div className="result-list">{wordResults.map((word) => <button key={`${word.level}-${word.id}`} className={selectedWord?.id === word.id && selectedWord.level === word.level ? "result-row selected" : "result-row"} onClick={() => setSelectedWord(word)}><strong>{word.word}</strong><span>{word.pinyin}</span><small>{word.definitions[0]}</small><em>{word.sourceWord ? "Dictionary" : `HSK ${word.level}`}</em></button>)}</div>{visibleCount < matchingWords.length && <LoadMore remaining={matchingWords.length - visibleCount} onClick={() => setVisibleCount((count) => count + 100)}/>}</div><aside className="detail-panel">{selectedWord ? <WordDetail word={selectedWord} examples={sentences.filter((sentence) => sentence.chinese.includes(selectedWord.word)).sort((a, b) => Number(a.source === "tatoeba") - Number(b.source === "tatoeba") || a.chinese.length - b.chinese.length).slice(0, 8)} onRecord={(skill, score) => record("word", selectedWord.word, skill, score)}/> : <EmptyDetail text="Choose a word to study its sound, meaning, and character chunks."/>}</aside></div>}

    {mode === "characters" && <div className="browser-layout simple-browser-layout"><div><div className="character-result-grid">{charResults.map((char) => <button key={char} className={selectedChar === char ? "char-result selected" : "char-result"} onClick={() => setSelectedChar(char)}><strong>{char}</strong><span>{characters[char]?.pinyin[0]}</span></button>)}</div>{visibleCount < allMatchingCharacters.length && <LoadMore remaining={allMatchingCharacters.length - visibleCount} onClick={() => setVisibleCount((count) => count + 100)}/>}</div><aside className="detail-panel">{selectedChar ? <CharacterDetail char={selectedChar} data={characters[selectedChar]} words={words.filter((word) => word.word.includes(selectedChar)).slice(0, 35)} onRecord={(skill, score) => record("character", selectedChar, skill, score)}/> : <EmptyDetail text="Choose a character to study its sound, structure, writing, and word family."/>}</aside></div>}

    {mode === "reading" && <div className="rich-reading-library"><div className="reading-grid simple-reading-grid">{readings.map((reading) => <article key={reading.id} className="reading-card"><span className="level-chip">HSK {reading.hskLevel}</span><h2>{reading.title}</h2><p className="reading-chinese">{reading.chinese}</p><AudioButton text={reading.chinese} kind="sentence" label="Listen"/><details><summary>Study support</summary><p className="pinyin">{reading.pinyin}</p><p>{reading.english}</p>{reading.context && <p className="meta-line">{reading.context}</p>}</details></article>)}</div><section className="sentence-stream"><div><span className="eyebrow">GRADED SENTENCE STREAM</span><h2>Read broadly, one clear sentence at a time.</h2><p>Thousands of graded examples build speed and flexible word recognition after focused network study.</p></div><div className="stream-list">{gradedSentenceStream.slice(0, visibleReadingCount).map((sentence) => <article key={sentence.id}><span>HSK {sentence.hskLevel}</span><div><strong>{sentence.chinese}</strong><p>{sentence.pinyin}</p><small>{sentence.english}</small></div><AudioButton text={sentence.chinese} kind="sentence" label=""/></article>)}</div>{visibleReadingCount < gradedSentenceStream.length && <button className="load-more" onClick={() => setVisibleReadingCount((count) => count + 30)}>Load 30 more <ChevronDown size={17}/><small>{gradedSentenceStream.length - visibleReadingCount} remaining</small></button>}</section></div>}
  </div>;
}

function networkSymbol(network: BaseNetwork): string {
  const specialized = network as BaseNetwork & { anchor?: string; component?: string };
  return String(specialized.anchor ?? specialized.component ?? network.wordKeys[0]?.slice(0, 2) ?? "词");
}

function NetworkDetail({ network, words, onStudy }: { network: BaseNetwork; words: WordEntry[]; onStudy: () => void }) {
  const index = new Map(words.map((word) => [word.word, word]));
  const resolved = network.wordKeys.map((key) => index.get(key)).filter((word): word is WordEntry => Boolean(word));
  return <div><div className="detail-hero network-detail-hero"><span className="level-chip">Connected pack</span><strong>{network.title}</strong><p>{network.subtitle}</p></div><h3>Vocabulary</h3><div className="detail-words network-word-list">{resolved.slice(0, 40).map((word) => <div key={`${word.level}-${word.id}`}><strong>{word.word}</strong><span>{word.pinyin}</span><small>{word.definitions[0]}</small></div>)}</div>{network.collocations && network.collocations.length > 0 && <><h3>Natural chunks</h3><div className="network-chunks">{network.collocations.slice(0, 12).map((item) => <span key={item.phrase}><strong>{item.phrase}</strong><em>{item.pinyin}</em><small>{item.english}</small></span>)}</div></>}<button className="primary-button wide study-network-button" onClick={onStudy}>Study this pack</button></div>;
}

function WordDetail({ word, examples, onRecord }: { word: WordEntry; examples: SentenceEntry[]; onRecord: (skill: Skill, score: 0 | 1 | 2 | 3) => void }) {
  const chars = chineseCharacters(word.word);
  return <div><div className="detail-hero"><span className="level-chip">{word.sourceWord ? "Open dictionary" : `HSK ${word.level}`}</span><div><strong>{word.word}</strong><AudioButton text={word.word}/></div><PinyinLine pinyin={word.pinyin} mode="always"/></div><div className="definition-list">{word.definitions.slice(0, 6).map((definition) => <p key={definition}>{definition}</p>)}</div><h3>Character chunks</h3><div className="chunk-row">{chars.map((char) => <span key={char}>{char}</span>)}</div>{examples.length > 0 && <><h3>Examples</h3><div className="word-example-list">{examples.map((sentence) => <article key={sentence.id}><div><strong>{sentence.chinese}</strong><AudioButton text={sentence.chinese} kind="sentence" label=""/></div><p>{sentence.pinyin}</p><small>{sentence.english}</small></article>)}</div></>}<p className="self-check">Can you recall this word without English?</p><ScoreButtons onScore={(score) => onRecord("meaning", score)}/></div>;
}

function CharacterDetail({ char, data, words, onRecord }: { char: string; data: CharacterEntry; words: WordEntry[]; onRecord: (skill: Skill, score: 0 | 1 | 2 | 3) => void }) {
  const [writing, setWriting] = useState(false);
  return <div><div className="detail-hero character"><span className="level-chip">Character</span><div><strong>{char}</strong><AudioButton text={words[0]?.word ?? char}/></div><PinyinLine pinyin={data?.pinyin.join(" · ") ?? ""} mode="always"/></div><p>{data?.definition}</p><div className="fact-row"><span>Radical <strong>{data?.radical || "—"}</strong></span><span>Strokes <strong>{data?.strokes || "—"}</strong></span></div>{data?.etymology?.hint && <div className="memory-tip"><p>{data.etymology.hint}</p></div>}<div className="two-actions library-actions"><button className={!writing ? "selected" : ""} onClick={() => setWriting(false)}>Words</button><button className={writing ? "selected" : ""} onClick={() => setWriting(true)}>Write</button></div>{writing ? <HanziPractice character={char} onComplete={() => onRecord("writing", 3)}/> : <><h3>High-value words</h3><div className="detail-words">{words.map((word) => <div key={`${word.level}-${word.id}`}><strong>{word.word}</strong><span>{word.pinyin}</span><small>{word.definitions[0]}</small></div>)}</div><p className="self-check">Can you recognize this character inside a word?</p><ScoreButtons onScore={(score) => onRecord("recognition", score)}/></>}</div>;
}

function LoadMore({ remaining, onClick }: { remaining: number; onClick: () => void }) { return <button className="load-more" onClick={onClick}>Load 100 more <ChevronDown size={17}/><small>{remaining.toLocaleString()} remaining</small></button>; }
function EmptyDetail({ text }: { text: string }) { return <div className="empty-detail"><Shapes size={42}/><p>{text}</p></div>; }
