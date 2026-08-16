import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpenText, Bot, Check, ChevronRight, Clock3, Languages, LoaderCircle, Sparkles, X } from "lucide-react";
import type { AppState, ReadingStory, ReadingStorySentence, Skill, WordEntry } from "../types";
import { levelNumber, loadAllWords, loadOpenDictionaryWord, loadReadingStories } from "../lib/content";
import { itemKey } from "../lib/storage";
import { readUiState, writeUiState } from "../lib/persistentUi";
import { requestReadingHelp, type ReadingHelpMode, type ReadingHelpResponse } from "../lib/readingAssistant";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AudioButton } from "./AudioButton";

type LevelFilter = "for-me" | "all" | number;

export function ReadingStudio({ active, state, record }: {
  active: boolean;
  state: AppState;
  record: (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void;
}) {
  const [stories, setStories] = useState<ReadingStory[]>([]);
  const [dictionary, setDictionary] = useState<Map<string, WordEntry>>(new Map());
  const [resolvedWord, setResolvedWord] = useState<WordEntry>();
  const [resolvingWord, setResolvingWord] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<LevelFilter>("for-me");
  const [progress, setProgress] = useState<Record<string, number>>(() => readUiState("reading-progress", {}));
  const [story, setStory] = useState<ReadingStory>();
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [selectedToken, setSelectedToken] = useState("");
  const [pinyinVisible, setPinyinVisible] = useState(state.preferences.showPinyin === "always");
  const [meaningVisible, setMeaningVisible] = useState(false);
  const [help, setHelp] = useState<ReadingHelpResponse>();
  const [helpMode, setHelpMode] = useState<ReadingHelpMode>();
  const [helpError, setHelpError] = useState("");
  const readerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadReadingStories(), loadAllWords()]).then(([loadedStories, hskWords]) => {
      if (cancelled) return;
      setStories(loadedStories);
      // HSK entries load eagerly; the 23MB open dictionary is fetched per-word from shards
      // only when the learner taps a token that HSK does not cover.
      setDictionary(new Map(hskWords.map((word) => [word.word, word])));
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError("The reading library could not be loaded.");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedToken) {
      setResolvedWord(undefined);
      setResolvingWord(false);
      return;
    }
    const known = dictionary.get(selectedToken);
    if (known) {
      setResolvedWord(known);
      setResolvingWord(false);
      return;
    }
    let cancelled = false;
    setResolvingWord(true);
    void loadOpenDictionaryWord(selectedToken).then((entry) => {
      if (!cancelled) setResolvedWord(entry);
    }).finally(() => {
      if (!cancelled) setResolvingWord(false);
    });
    return () => { cancelled = true; };
  }, [dictionary, selectedToken]);

  useEffect(() => {
    if (!story) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [story]);

  const closeReader = () => setStory(undefined);
  useDialogFocus(Boolean(story), readerRef, closeReader);

  const learnerLevel = levelNumber(state.preferences.level);
  const visibleStories = stories.filter((item) => filter === "all"
    || (filter === "for-me" ? item.hskLevel <= Math.min(6, learnerLevel + 1) : item.hskLevel === filter));
  const completedCount = stories.filter((item) => (progress[item.id] ?? 0) >= item.sentences.length).length;
  const selectedWord = resolvedWord;
  const activeSentence = story?.sentences[sentenceIndex];
  const selectedMastery = selectedWord ? state.mastery[itemKey("word", selectedWord.word)]?.skills.context ?? 0 : 0;

  const openStory = (next: ReadingStory) => {
    const saved = progress[next.id] ?? 0;
    setStory(next);
    setSentenceIndex(Math.min(saved, next.sentences.length - 1));
    setSelectedToken("");
    setPinyinVisible(state.preferences.showPinyin === "always");
    setMeaningVisible(false);
    setHelp(undefined);
    setHelpError("");
  };

  const moveTo = (index: number) => {
    if (!story) return;
    const nextIndex = Math.max(0, Math.min(story.sentences.length - 1, index));
    const nextProgress = { ...progress, [story.id]: Math.max(progress[story.id] ?? 0, nextIndex) };
    setProgress(nextProgress);
    writeUiState("reading-progress", nextProgress);
    setSentenceIndex(nextIndex);
    setSelectedToken("");
    setMeaningVisible(false);
    setHelp(undefined);
    setHelpError("");
  };

  const finishStory = () => {
    if (!story) return;
    const nextProgress = { ...progress, [story.id]: story.sentences.length };
    setProgress(nextProgress);
    writeUiState("reading-progress", nextProgress);
    closeReader();
  };

  const askForHelp = async (mode: ReadingHelpMode) => {
    if (!story || !activeSentence) return;
    setHelpMode(mode);
    setHelp(undefined);
    setHelpError("");
    try {
      setHelp(await requestReadingHelp({ mode, story, sentence: activeSentence, word: selectedWord, mastery: selectedMastery }));
    } catch (error) {
      setHelpError(error instanceof Error ? error.message : "Reading help is temporarily unavailable.");
    } finally {
      setHelpMode(undefined);
    }
  };

  if (!active && !stories.length) return null;

  return <div className="reading-studio-page">
    <section className="reading-studio-hero">
      <div><span className="eyebrow">GRADED READING STUDIO</span><h1>Read the story.<br/>Understand the moment.</h1><p>Modern Chinese in short, deliberate scenes. Tap any word, hear every line, and ask for help without leaving the passage.</p></div>
      <div className="reading-studio-proof"><BookOpenText size={20}/><span>YOUR SHELF</span><strong>{completedCount}/{stories.length || 8}</strong><small>stories finished</small></div>
    </section>

    <section className="reading-filter-bar" aria-label="Reading level filters">
      <button className={filter === "for-me" ? "active" : ""} onClick={() => setFilter("for-me")}>For me</button>
      {[1, 2, 3, 4, 5, 6].map((level) => <button key={level} className={filter === level ? "active" : ""} onClick={() => setFilter(level)}>HSK {level}</button>)}
      <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
    </section>

    {loading && <div className="reading-story-grid" aria-label="Loading stories"><span className="skeleton"/><span className="skeleton"/><span className="skeleton"/></div>}
    {loadError && <section className="reading-load-error"><BookOpenText size={30}/><strong>{loadError}</strong><p>Check the content files and try again.</p></section>}
    {!loading && !loadError && <section className="reading-story-grid">
      {visibleStories.map((item, index) => {
        const read = progress[item.id] ?? 0;
        const complete = read >= item.sentences.length;
        const percent = complete ? 100 : Math.round((read / item.sentences.length) * 100);
        return <button key={item.id} className={`reading-story-card tone-${index % 4}${complete ? " complete" : ""}`} onClick={() => openStory(item)}>
          <span className="reading-story-level">HSK {item.hskLevel}</span>
          <div className="reading-story-number">{String(stories.indexOf(item) + 1).padStart(2, "0")}</div>
          <div><small>{item.theme} · {item.minutes} min</small><strong>{item.chineseTitle}</strong><h2>{item.title}</h2><p>{item.description}</p></div>
          <footer><span>{complete ? <><Check size={13}/> Finished</> : read > 0 ? `${percent}% read` : "Start reading"}</span><ChevronRight size={18}/></footer>
        </button>;
      })}
    </section>}

    {story && activeSentence && <div className="studio-reader-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReader(); }}>
      <section ref={readerRef} className="studio-reader" role="dialog" aria-modal="true" aria-labelledby="studio-reader-title" tabIndex={-1}>
        <header className="studio-reader-header">
          <button data-dialog-autofocus className="studio-reader-close" onClick={closeReader} aria-label="Close reader"><X size={19}/></button>
          <div><span>HSK {story.hskLevel} · {story.theme}</span><strong id="studio-reader-title">{story.chineseTitle}</strong></div>
          <div className="studio-reader-tools">
            <button className={pinyinVisible ? "active" : ""} onClick={() => setPinyinVisible((value) => !value)}><Languages size={15}/> Pinyin</button>
            <AudioButton text={story.sentences.map((sentence) => sentence.chinese).join(" ")} kind="sentence" audioUrl={story.audioUrl} label={story.audioUrl ? "Story audio" : "Listen"} prefetch/>
          </div>
        </header>
        <div className="studio-reader-progress"><span style={{ width: `${((sentenceIndex + 1) / story.sentences.length) * 100}%` }}/></div>

        <div className="studio-reader-layout">
          <main className="studio-reader-copy">
            <div className="studio-reader-position"><span>{String(sentenceIndex + 1).padStart(2, "0")}</span><small>of {story.sentences.length}<br/>{story.title}</small></div>
            <article className="studio-reader-sentence">
              <div className="studio-reader-hanzi">
                {tokenize(activeSentence).map((token, index) => token.word ? <button
                  key={`${token.text}-${index}`}
                  className={`${selectedToken === token.text ? "selected " : ""}${wordStrength(state, token.text) >= .72 ? "known" : ""}`}
                  onClick={() => { setSelectedToken(token.text); setHelp(undefined); setHelpError(""); }}
                >{token.text}</button> : <span key={`${token.text}-${index}`}>{token.text}</span>)}
              </div>
              {pinyinVisible && <p className="studio-reader-pinyin">{activeSentence.pinyin}</p>}
              <div className="studio-sentence-actions"><AudioButton text={activeSentence.chinese} kind="sentence" label="This section"/><button className="studio-meaning-toggle" onClick={() => setMeaningVisible((value) => !value)}>{meaningVisible ? "Hide meaning" : "Reveal meaning"}</button></div>
              {meaningVisible && <p className="studio-reader-translation">{activeSentence.english}</p>}
            </article>
            <p className="studio-reader-instruction">Tap a word for its verified meaning. Underlined words are already strong in your memory.</p>
          </main>

          <aside className="studio-guide">
            <div className="studio-guide-heading"><Sparkles size={18}/><div><span>PASSAGE GUIDE</span><strong>{selectedToken ? "Word in this sentence" : "Stay inside the context"}</strong></div></div>
            {selectedToken ? <WordLens word={selectedWord} token={selectedToken} mastery={selectedMastery} resolving={resolvingWord} onRecord={(score) => selectedWord && record("word", selectedWord.word, "context", score)}/> : <div className="studio-guide-empty"><BookOpenText size={25}/><p>Choose a word in the sentence, or use a focused prompt below.</p></div>}
            {activeSentence.grammar && <div className="studio-grammar-note"><span>BUILT-IN GRAMMAR NOTE</span><p>{activeSentence.grammar}</p></div>}
            <div className="studio-ai-actions">
              <span><Bot size={15}/> ASK ABOUT THIS EXACT LINE</span>
              <div>
                <button disabled={Boolean(helpMode)} onClick={() => void askForHelp("explain")}>Explain</button>
                <button disabled={Boolean(helpMode)} onClick={() => void askForHelp("grammar")}>Grammar</button>
                <button disabled={Boolean(helpMode)} onClick={() => void askForHelp("simplify")}>Simplify</button>
                <button disabled={Boolean(helpMode)} onClick={() => void askForHelp("quiz")}>Quiz me</button>
              </div>
            </div>
            {helpMode && <div className="studio-ai-loading"><LoaderCircle className="spin" size={18}/> Reading the line with your context…</div>}
            {helpError && <div className="studio-ai-error"><strong>AI guide unavailable</strong><p>{helpError} Dictionary, audio, pinyin, and translations still work offline.</p></div>}
            {help && <ReadingHelpCard help={help}/>} 
          </aside>
        </div>

        <footer className="studio-reader-footer">
          <button onClick={() => moveTo(sentenceIndex - 1)} disabled={sentenceIndex === 0}><ArrowLeft size={17}/> Previous</button>
          <span><Clock3 size={14}/>{sentenceIndex + 1} of {story.sentences.length}</span>
          {sentenceIndex === story.sentences.length - 1
            ? <button className="finish" onClick={finishStory}><Check size={17}/> Finish story</button>
            : <button onClick={() => moveTo(sentenceIndex + 1)}>Next line <ArrowRight size={17}/></button>}
        </footer>
      </section>
    </div>}
  </div>;
}

function tokenize(sentence: ReadingStorySentence): Array<{ text: string; word: boolean }> {
  const candidates = [...new Set(sentence.words)].sort((a, b) => b.length - a.length);
  const tokens: Array<{ text: string; word: boolean }> = [];
  for (let index = 0; index < sentence.chinese.length;) {
    const match = candidates.find((word) => sentence.chinese.startsWith(word, index));
    if (match) {
      tokens.push({ text: match, word: true });
      index += match.length;
      continue;
    }
    const character = sentence.chinese[index];
    tokens.push({ text: character, word: /[\u3400-\u9fff]/u.test(character) });
    index += 1;
  }
  return tokens;
}

function wordStrength(state: AppState, word: string): number {
  const record = state.mastery[itemKey("word", word)];
  return Math.max(record?.skills.meaning ?? 0, record?.skills.context ?? 0, record?.skills.recognition ?? 0);
}

function WordLens({ word, token, mastery, resolving, onRecord }: { word?: WordEntry; token: string; mastery: number; resolving: boolean; onRecord: (score: 1 | 3) => void }) {
  if (resolving) return <div className="studio-word-lens"><div><strong>{token}</strong><AudioButton text={token}/></div><p className="studio-reference-missing">Looking up this word in the full dictionary…</p></div>;
  if (!word) return <div className="studio-word-lens"><div><strong>{token}</strong><AudioButton text={token}/></div><p className="studio-reference-missing">This name or phrase has no verified local dictionary entry. Use the sentence explanation rather than guessing from an isolated definition.</p></div>;
  return <div className="studio-word-lens">
    <div><strong>{word.word}</strong><AudioButton text={word.word}/></div>
    <span>{word.pinyin}</span>
    <ul>{word.definitions.slice(0, 3).map((definition) => <li key={definition}>{definition}</li>)}</ul>
    <small>{mastery >= .72 ? "Strong in context" : mastery > 0 ? "Growing in context" : "New in context"}</small>
    <div className="studio-word-check"><button onClick={() => onRecord(1)}>Still learning</button><button className={mastery >= .72 ? "known" : ""} onClick={() => onRecord(3)}><Check size={13}/> I knew it</button></div>
  </div>;
}

function ReadingHelpCard({ help }: { help: ReadingHelpResponse }) {
  return <div className="studio-ai-card">
    <span>AI PASSAGE NOTE</span><strong>{help.title}</strong><p>{help.summary}</p>
    {help.breakdown.length > 0 && <div>{help.breakdown.map((item, index) => <article key={`${item.chinese}-${index}`}><b>{item.chinese}</b>{item.pinyin && <small>{item.pinyin}</small>}<p>{item.meaning}</p></article>)}</div>}
    {help.tip && <em>{help.tip}</em>}
    {help.question && <blockquote>{help.question}</blockquote>}
  </div>;
}
