import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  GitBranch,
  Lightbulb,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { AppState, LearningBatch, LearningGoal, SentenceEntry, Skill, WordEntry } from "../types";
import { AudioButton } from "./AudioButton";
import { PinyinLine } from "./PinyinLine";

type RecordAttempt = (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void;
type SessionTotals = { groups: number; words: number };

const stepNames = ["Orient", "Learn", "Recall", "Listen", "Real use", "Speak"] as const;

export function LearnPage({ state, setState, batch, loading, record, onShuffle, onCompleteGroup, onNextGroup, sessionTotals }: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  batch?: LearningBatch;
  loading: boolean;
  record: RecordAttempt;
  onShuffle: () => void;
  onCompleteGroup: (batch: LearningBatch) => void;
  onNextGroup: () => void;
  sessionTotals: SessionTotals;
}) {
  const [step, setStep] = useState(0);
  const [wordIndex, setWordIndex] = useState(0);
  const [discoverScores, setDiscoverScores] = useState<Record<string, number>>({});
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    setStep(0);
    setWordIndex(0);
    setDiscoverScores({});
    setCompleted(false);
  }, [batch?.id]);

  const restart = () => {
    setStep(0);
    setWordIndex(0);
    setDiscoverScores({});
    setCompleted(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading || !batch) {
    return <div className="vocab-page"><div className="skeleton vocab-heading-skeleton"/><div className="skeleton vocab-card-skeleton"/></div>;
  }

  const title = friendlyTitle(batch);
  const learningGoal = state.preferences.learningGoal;
  const changeLearningGoal = (goal: LearningGoal) => {
    if (goal === learningGoal) return;
    setState((current) => ({ ...current, preferences: { ...current.preferences, learningGoal: goal, selectedNetworkId: undefined } }));
  };
  const markLearned = (word: WordEntry, score: 1 | 3) => {
    if (discoverScores[word.word] === undefined) {
      setDiscoverScores((current) => ({ ...current, [word.word]: score }));
    }
    if (wordIndex < batch.words.length - 1) setWordIndex((value) => value + 1);
    else setStep(2);
  };

  const finish = () => {
    if (completed) return;
    onCompleteGroup(batch);
    setCompleted(true);
  };

  return (
    <div className="vocab-page lesson-page">
      <div className="learning-goal-picker" role="group" aria-label="Learning goal">
        <button className={learningGoal === "fluency" ? "active" : ""} aria-pressed={learningGoal === "fluency"} onClick={() => changeLearningGoal("fluency")}><strong>Fluency Path</strong><small>Useful spoken Chinese, fast</small></button>
        <button className={learningGoal === "hsk" ? "active" : ""} aria-pressed={learningGoal === "hsk"} onClick={() => changeLearningGoal("hsk")}><strong>HSK Track</strong><small>Follow your syllabus level</small></button>
      </div>
      <section className="lesson-focus">
        <div className="lesson-focus-copy">
          <span className="eyebrow">{learningGoal === "fluency" ? "FAST-TRACK EVERYDAY CHINESE" : "HSK-ALIGNED STUDY"}</span>
          <h1>{title}</h1>
          <p>{learningGoal === "fluency" ? fluencySubtitle(batch) : lessonSubtitle(batch)}</p>
        </div>
        <div className="lesson-focus-stats" aria-label="Current learning session">
          <span><strong>{batch.words.length}</strong><small>words now</small></span>
          <span><strong>{batch.reviewWordKeys.length}</strong><small>due again</small></span>
          <span><strong>{sessionTotals.words}</strong><small>this session</small></span>
        </div>
      </section>

      <section className="lesson-shell">
        <header className="lesson-topline">
          <div className="lesson-context">
            <span className="lesson-kind">{groupKind(batch.engine)}</span>
            <span className="adaptive-signal" role="status"><Sparkles size={14}/><span><strong>{learningGoal === "fluency" ? "High-value for fluency" : "Aligned to your HSK level"}</strong><small>{learningGoal === "fluency" ? "Spoken often, useful across contexts, and easier to transfer" : "Syllabus-relevant, connected, and timed to your memory"}</small></span></span>
          </div>
          <button className="quiet-button" onClick={onShuffle}><RefreshCw size={16}/> Switch group</button>
        </header>

        {!completed && (
          <div className="lesson-progress" aria-label={`Step ${step + 1} of ${stepNames.length}`}>
            <div className="lesson-progress-copy"><span>Step {step + 1} of {stepNames.length}</span><strong>{stepNames[step]}</strong></div>
            <div className="lesson-progress-rail" aria-hidden="true">
              {stepNames.map((name, index) => <span key={name} className={index < step ? "done" : index === step ? "current" : ""}>{index < step ? <Check size={12}/> : index + 1}</span>)}
            </div>
            <small>{stepHint(step)}</small>
          </div>
        )}

        {!completed && <div hidden={step !== 0}>
          <GroupMap key={batch.id} batch={batch} title={title} onStart={() => setStep(1)}/>
        </div>}

        {!completed && <div hidden={step !== 1}>
          <DiscoverStep
            key={batch.id}
            batch={batch}
            state={state}
            index={wordIndex}
            scores={discoverScores}
            onBack={() => wordIndex === 0 ? setStep(0) : setWordIndex((value) => value - 1)}
            onSelectIndex={setWordIndex}
            onLearned={markLearned}
          />
        </div>}

        {!completed && <div hidden={step !== 2}>
          <MatchGame key={batch.id} words={batch.words} record={record} onBack={() => { setWordIndex(Math.max(0, batch.words.length - 1)); setStep(1); }} onComplete={() => setStep(3)}/>
        </div>}

        {!completed && <div hidden={step !== 3}>
          <SoundPractice key={batch.id} batch={batch} state={state} record={record} onBack={() => setStep(2)} onComplete={() => setStep(4)}/>
        </div>}

        {!completed && <div hidden={step !== 4}>
          <ContextPractice key={batch.id} batch={batch} state={state} record={record} onBack={() => setStep(3)} onComplete={() => setStep(5)}/>
        </div>}

        {!completed && <div hidden={step !== 5}>
          <ProductionPractice key={batch.id} batch={batch} state={state} record={record} onBack={() => setStep(4)} onComplete={finish}/>
        </div>}

        {completed && (
          <Completion batch={batch} title={title} scores={discoverScores} sessionTotals={sessionTotals} onRestart={restart} onNext={onNextGroup}/>
        )}
      </section>
    </div>
  );
}

function GroupMap({ batch, title, onStart }: { batch: LearningBatch; title: string; onStart: () => void }) {
  const center = batch.anchor ?? (batch.engine === "scenario" ? "场景" : batch.engine === "contrast" ? "区别" : "词");
  const returning = new Set(batch.reviewWordKeys);
  return (
    <div className="group-map-step">
      <div className="group-orientation">
        <div className="group-anchor">
          <span>{batch.anchor ? "REUSABLE CORE" : groupKind(batch.engine)}</span>
          <strong>{center}</strong>
          <small>{batch.anchor ? "One character unlocks the group" : title}</small>
        </div>
        <div className="group-principle"><Lightbulb size={17}/><p>{groupPrinciple(batch)}</p></div>
      </div>

      <div className="group-preview">
        <div className="group-preview-heading"><div><span className="eyebrow">THE SIX-WORD SET</span><h2>See the pattern first.</h2></div><p>Do not memorize yet. Notice what stays the same and what changes.</p></div>
        <div className="group-word-grid">
          {batch.words.map((word, index) => <article key={word.word} className={returning.has(word.word) ? "returning" : ""}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{word.word}</strong><small>{word.pinyin}</small></div>
            <p>{word.definitions[0]}</p>
            {returning.has(word.word) && <em>refresh</em>}
          </article>)}
        </div>
      </div>

      {batch.collocations.length > 0 && (
        <div className="group-chunks"><small>Already useful together</small><div>{batch.collocations.slice(0, 3).map((item) => <span key={item.phrase}><strong>{item.phrase}</strong><em>{item.pinyin}</em><small>{item.english}</small></span>)}</div></div>
      )}

      <div className="group-start"><span><strong>{batch.words.length - returning.size} new</strong><small>{returning.size ? `${returning.size} timely refresh` : "A clean first pass"}</small></span><button className="primary-button lesson-cta" onClick={onStart}>Start with word 1 <ArrowRight size={18}/></button></div>
    </div>
  );
}

function DiscoverStep({ batch, state, index, scores, onBack, onSelectIndex, onLearned }: {
  batch: LearningBatch;
  state: AppState;
  index: number;
  scores: Record<string, number>;
  onBack: () => void;
  onSelectIndex: (index: number) => void;
  onLearned: (word: WordEntry, score: 1 | 3) => void;
}) {
  const word = batch.words[Math.min(index, batch.words.length - 1)];
  const [revealed, setRevealed] = useState(false);
  const [heard, setHeard] = useState(false);
  const example = useMemo(() => findExample(word, batch.sentences), [word, batch.sentences]);

  useEffect(() => { setRevealed(false); setHeard(false); }, [word.word]);

  return (
    <div className="discover-step">
      <StepHeading onBack={onBack} eyebrow={`${batch.reviewWordKeys.includes(word.word) ? "TIMELY REFRESH" : "NEW WORD"} · ${index + 1} OF ${batch.words.length}`} title={batch.reviewWordKeys.includes(word.word) ? "Bring it back" : "Meet the word"} subtitle="Look and listen first. Retrieve or predict before revealing the meaning."/>
      <div className="word-dots" aria-label="Words in this group">
        {batch.words.map((item, itemIndex) => <button key={item.word} className={itemIndex === index ? "current" : scores[item.word] !== undefined ? "learned" : ""} onClick={() => onSelectIndex(itemIndex)} aria-label={`Open ${item.word}`}>{scores[item.word] !== undefined ? <Check size={12}/> : itemIndex + 1}</button>)}
      </div>

      <article className="discovery-card">
        <div className="discovery-audio"><AudioButton text={word.word} gender={state.preferences.voiceGender} label={heard ? "Listen again" : "Listen"} prefetch onPlayed={() => setHeard(true)}/></div>
        <strong className="discovery-word">{word.word}</strong>
        {!revealed ? (
          <div className="meaning-gate">
            <p>Pause for a moment: what could this word mean?</p>
            <button className="primary-button" onClick={() => setRevealed(true)}>Reveal meaning</button>
          </div>
        ) : (
          <div className="word-reveal">
            <PinyinLine pinyin={word.pinyin} mode={state.preferences.showPinyin}/>
            <h3>{word.definitions[0]}</h3>
            {word.definitions.length > 1 && <p className="extra-definitions">{word.definitions.slice(1, 3).join(" · ")}</p>}
            <p className="connection-note"><GitBranch size={16}/>{connectionNote(batch, word)}</p>
            {example && (
              <div className="context-example">
                <div><span>IN CONTEXT</span><AudioButton text={example.chinese} kind="sentence" speed={state.preferences.audioSpeed} prefetch/></div>
                <strong>{highlightWord(example.chinese, word.word)}</strong>
                <p>{example.english}</p>
              </div>
            )}
            <div className="learning-choice">
              <button onClick={() => onLearned(word, 1)}>Still learning</button>
              <button className="clear" onClick={() => onLearned(word, 3)}>Clear <ArrowRight size={17}/></button>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}

function MatchGame({ words, record, onBack, onComplete }: { words: WordEntry[]; record: RecordAttempt; onBack: () => void; onComplete: () => void }) {
  const roundSize = 6;
  const [round, setRound] = useState(0);
  const roundWords = words.slice(round * roundSize, (round + 1) * roundSize);
  const meanings = useMemo(() => stableShuffle(roundWords, `meanings-${round}`), [roundWords, round]);
  const [selectedWord, setSelectedWord] = useState<string>();
  const [selectedMeaning, setSelectedMeaning] = useState<string>();
  const [matched, setMatched] = useState<Set<string>>(() => new Set());
  const [mistakes, setMistakes] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<"correct" | "wrong" | undefined>();
  const roundComplete = roundWords.every((word) => matched.has(word.word));
  const finalRound = (round + 1) * roundSize >= words.length;

  const checkPair = (wordKey: string, meaningKey: string) => {
    if (wordKey === meaningKey) {
      if (!matched.has(wordKey)) record("word", wordKey, "meaning", mistakes[wordKey] ? 2 : 3);
      setMatched((current) => new Set([...current, wordKey]));
      setNotice("correct");
    } else {
      setMistakes((current) => ({ ...current, [wordKey]: (current[wordKey] ?? 0) + 1 }));
      setNotice("wrong");
    }
    window.setTimeout(() => {
      setSelectedWord(undefined);
      setSelectedMeaning(undefined);
      setNotice(undefined);
    }, 520);
  };

  const chooseWord = (key: string) => {
    if (matched.has(key)) return;
    setNotice(undefined);
    setSelectedWord(key);
    if (selectedMeaning) checkPair(key, selectedMeaning);
  };

  const chooseMeaning = (key: string) => {
    if (matched.has(key)) return;
    setNotice(undefined);
    setSelectedMeaning(key);
    if (selectedWord) checkPair(selectedWord, key);
  };

  const continueRound = () => {
    if (finalRound) onComplete();
    else {
      setRound((value) => value + 1);
      setSelectedWord(undefined);
      setSelectedMeaning(undefined);
      setNotice(undefined);
    }
  };
  return (
    <div className="match-step">
      <StepHeading onBack={onBack} eyebrow={`ACTIVE RECALL · SET ${round + 1} OF ${Math.ceil(words.length / roundSize)}`} title="Connect word and meaning" subtitle="Larger families stay complete, while recall remains focused in sets of six."/>
      <div className="match-status"><span style={{ width: `${(matched.size / words.length) * 100}%` }}/></div>
      <div className={`match-board ${notice ?? ""}`}>
        <div>{roundWords.map((word) => <button key={word.word} disabled={matched.has(word.word)} className={selectedWord === word.word ? "selected" : ""} onClick={() => chooseWord(word.word)}><strong>{word.word}</strong><small>{word.pinyin}</small></button>)}</div>
        <div>{meanings.map((word) => <button key={word.word} disabled={matched.has(word.word)} className={selectedMeaning === word.word ? "selected" : ""} onClick={() => chooseMeaning(word.word)}>{word.definitions[0]}</button>)}</div>
      </div>
      <p className={`match-feedback ${notice ?? ""}`}>{notice === "correct" ? "Connected." : notice === "wrong" ? "These do not match—look again." : roundComplete ? (finalRound ? "Every meaning is connected." : "This recall set is complete.") : `${matched.size} of ${words.length} connected`}</p>
      {roundComplete && <button className="primary-button lesson-cta" onClick={continueRound}>{finalRound ? "Use the words in context" : "Continue the family"} <ArrowRight size={18}/></button>}
    </div>
  );
}

function SoundPractice({ batch, state, record, onBack, onComplete }: { batch: LearningBatch; state: AppState; record: RecordAttempt; onBack: () => void; onComplete: () => void }) {
  const options = useMemo(() => batch.words.map((target) => ({
    target,
    choices: stableShuffle([target, ...stableShuffle(batch.words.filter((word) => word.word !== target.word), `sound-${target.word}`).slice(0, 3)], `sound-choice-${target.word}`),
  })), [batch.words]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string>();
  const question = options[index];

  if (!question) return null;

  const answer = (word: WordEntry) => {
    if (selected) return;
    const correct = word.word === question.target.word;
    record("word", question.target.word, "sound", correct ? 3 : 1);
    setSelected(word.word);
  };

  const next = () => {
    if (index === options.length - 1) onComplete();
    else {
      setIndex((value) => value + 1);
      setSelected(undefined);
    }
  };

  return (
    <div className="sound-step">
      <StepHeading onBack={onBack} eyebrow={`LISTENING RETRIEVAL · ${index + 1} OF ${options.length}`} title="Which word did you hear?" subtitle="Listen once, identify the word, then listen again only if you need to check."/>
      <article className="sound-card">
        <AudioButton text={question.target.word} gender={state.preferences.voiceGender} label="Play the word" prefetch/>
        <p className="sound-prompt">The answer is hidden until you choose.</p>
        <div className="sound-options">{question.choices.map((word) => <button key={word.word} className={selected === word.word ? word.word === question.target.word ? "correct" : "wrong" : ""} onClick={() => answer(word)} disabled={Boolean(selected)}><strong>{word.word}</strong><small>{word.definitions[0]}</small></button>)}</div>
        {selected && <div className="sound-feedback">{selected === question.target.word ? "Clear listening." : `The word was ${question.target.word}.`}</div>}
      </article>
      {selected && <button className="primary-button lesson-cta" onClick={next}>{index === options.length - 1 ? "Use the words in context" : "Next listening check"} <ArrowRight size={18}/></button>}
    </div>
  );
}

interface ContextQuestion { sentence: SentenceEntry; target: WordEntry; options: WordEntry[] }

function ContextPractice({ batch, state, record, onBack, onComplete }: { batch: LearningBatch; state: AppState; record: RecordAttempt; onBack: () => void; onComplete: () => void }) {
  const questions = useMemo(() => buildContextQuestions(batch), [batch]);
  const [index, setIndex] = useState(0);
  const [solved, setSolved] = useState(false);
  const [wrong, setWrong] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const [lineVisible, setLineVisible] = useState(false);
  const question = questions[index];

  if (!question) {
      return <div className="context-step"><StepHeading onBack={onBack} eyebrow="USE THE GROUP" title="Say the group once" subtitle="Read each word aloud and recall its meaning without English."/><div className="speak-grid">{batch.words.map((word) => <div key={word.word}><strong>{word.word}</strong><AudioButton text={word.word}/></div>)}</div><button className="primary-button lesson-cta" onClick={onComplete}>Continue to speaking check <ArrowRight size={18}/></button></div>;
  }

  const answer = (word: WordEntry) => {
    if (solved) return;
    const correct = word.word === question.target.word;
    if (!attempted) {
      record("word", question.target.word, "context", correct ? 3 : 1);
      setAttempted(true);
    }
    if (correct) {
      setSolved(true);
      setWrong(undefined);
    } else setWrong(word.word);
  };

  const next = () => {
    if (index < questions.length - 1) {
      setIndex((value) => value + 1);
      setSolved(false);
      setWrong(undefined);
      setAttempted(false);
      setLineVisible(false);
    } else onComplete();
  };

  return (
    <div className="context-step">
      <StepHeading onBack={onBack} eyebrow={`REAL CHINESE SPRINT · ${index + 1} OF ${questions.length}`} title="Catch it in real Chinese" subtitle="Listen before reading, then recover the missing word from a current online sentence corpus."/>
      <article className={`cloze-card sprint-card ${lineVisible ? "line-visible" : "listen-first"}`}>
        <div className="cloze-top"><span>{question.sentence.source === "tatoeba-live" ? question.sentence.audioNormal ? "HUMAN RECORDING" : "WEEKLY ONLINE CORPUS" : `HSK ${question.sentence.hskLevel}`}</span><AudioButton text={question.sentence.chinese} kind="sentence" speed={state.preferences.audioSpeed} audioUrl={state.preferences.audioSpeed === "slow" ? question.sentence.audioSlow ?? question.sentence.audioNormal : question.sentence.audioNormal} label={lineVisible ? "Replay" : "Listen first"} prefetch/></div>
        {!lineVisible ? <div className="sprint-listen-gate"><strong>Listen for the group word.</strong><p>The sentence stays hidden until you are ready to check what you heard.</p><button className="secondary-button" onClick={() => setLineVisible(true)}>Show the sentence</button></div> : <>
          <p className="cloze-sentence">{question.sentence.chinese.replace(question.target.word, "＿＿")}</p>
          <div className="cloze-options">{question.options.map((word) => <button key={word.word} className={solved && word.word === question.target.word ? "correct" : wrong === word.word ? "wrong" : ""} onClick={() => answer(word)} disabled={solved && word.word !== question.target.word}>{word.word}</button>)}</div>
          {wrong && !solved && <p className="cloze-feedback wrong">That changes the meaning. Try another word.</p>}
          {solved && <div className="cloze-answer"><strong><CheckCircle2 size={18}/> {question.sentence.chinese}</strong><PinyinLine pinyin={question.sentence.pinyin} mode={state.preferences.showPinyin}/><p>{question.sentence.english}</p></div>}
        </>}
      </article>
      {solved && <button className="primary-button lesson-cta" onClick={next}>{index < questions.length - 1 ? <>Next real sentence <ArrowRight size={18}/></> : <>Continue to speaking <ArrowRight size={18}/></>}</button>}
    </div>
  );
}

function ProductionPractice({ batch, state, record, onBack, onComplete }: { batch: LearningBatch; state: AppState; record: RecordAttempt; onBack: () => void; onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const word = batch.words[index];

  if (!word) return null;

  const rate = (score: 1 | 3) => {
    record("word", word.word, "production", score);
    if (index === batch.words.length - 1) onComplete();
    else {
      setIndex((value) => value + 1);
      setRevealed(false);
    }
  };

  return (
    <div className="production-step">
      <StepHeading onBack={onBack} eyebrow={`SPOKEN PRODUCTION · ${index + 1} OF ${batch.words.length}`} title="Say it before you reveal it" subtitle="Read the meaning, say the Chinese word aloud, then rate the result honestly."/>
      <article className="production-card">
        <span className="production-definition">{word.definitions[0]}</span>
        {!revealed ? <button className="primary-button" onClick={() => setRevealed(true)}>Reveal the word</button> : <div className="production-answer"><strong>{word.word}</strong><PinyinLine pinyin={word.pinyin} mode={state.preferences.showPinyin}/><AudioButton text={word.word} gender={state.preferences.voiceGender} label="Check pronunciation"/></div>}
      </article>
      {revealed && <div className="production-rating"><button onClick={() => rate(1)}>I need another pass</button><button className="clear" onClick={() => rate(3)}>I said it clearly <ArrowRight size={17}/></button></div>}
    </div>
  );
}

function Completion({ batch, title, scores, sessionTotals, onRestart, onNext }: { batch: LearningBatch; title: string; scores: Record<string, number>; sessionTotals: SessionTotals; onRestart: () => void; onNext: () => void }) {
  const clearCount = Object.values(scores).filter((score) => score >= 3).length;
  return (
    <div className="completion-step">
      <span className="completion-mark"><CheckCircle2/></span>
      <span className="eyebrow">GROUP CONNECTED</span>
      <h2>{title}</h2>
      <p>You retrieved every word and used it in context. Words that need another encounter will return naturally in a future group.</p>
      <div className="completion-words">{batch.words.map((word) => <span key={word.word} className={(scores[word.word] ?? 0) >= 3 ? "clear" : "growing"}><strong>{word.word}</strong><small>{word.definitions[0]}</small></span>)}</div>
      <div className="completion-summary"><span><strong>{clearCount}/{batch.words.length}</strong>felt clear on first learning</span><span><strong>{sessionTotals.groups}</strong>groups this session</span><span><strong>{sessionTotals.words}</strong>words explored</span></div>
      <button className="primary-button lesson-cta" onClick={onNext}>Learn another group <ArrowRight size={18}/></button>
      <button className="text-button restart-button" onClick={onRestart}><RefreshCw size={15}/> Learn this group again</button>
    </div>
  );
}

function StepHeading({ onBack, eyebrow, title, subtitle }: { onBack: () => void; eyebrow: string; title: string; subtitle: string }) {
  return <div className="step-heading"><button className="back-button" onClick={onBack} aria-label="Go back"><ArrowLeft size={18}/></button><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function stepHint(step: number): string {
  return ["Notice the shared idea", "Build a first memory", "Retrieve the meanings", "Separate similar sounds", "Choose by real usage", "Produce without a prompt"][step] ?? "Keep moving";
}

function friendlyTitle(batch: LearningBatch): string {
  return batch.title
    .replace(/ word web$/i, " family")
    .replace(/ contrast practice$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groupKind(engine: LearningBatch["engine"]): string {
  if (engine === "word-web") return "WORD FAMILY";
  if (engine === "scenario") return "REAL-LIFE GROUP";
  if (engine === "contrast") return "MEANING CONTRAST";
  return "CONNECTED GROUP";
}

function groupPrinciple(batch: LearningBatch): string {
  if (batch.engine === "word-web" && batch.anchor) return `The character ${batch.anchor} is the reusable core. Notice what changes around it.`;
  if (batch.engine === "contrast") return "These words are close, but not interchangeable. Context reveals the exact difference.";
  return "These words appear in the same real situation, so one mental scene holds the whole group.";
}

function lessonSubtitle(batch: LearningBatch): string {
  const familySize = batch.subtitle.match(/Build (\d+) useful compounds/i)?.[1];
  if (familySize) return `${batch.words.length} useful words from a ${familySize}-word family, chosen for this round.`;
  return batch.subtitle;
}

function fluencySubtitle(batch: LearningBatch): string {
  return `${batch.words.length} high-utility words selected for spoken use, broad context, and fast recall.`;
}

function connectionNote(batch: LearningBatch, word: WordEntry): string {
  if (batch.engine === "word-web" && batch.anchor && word.word.includes(batch.anchor)) return `${batch.anchor} connects this word to the rest of the family.`;
  if (batch.engine === "contrast") return `Compare this exact meaning with the other words in ${friendlyTitle(batch)}.`;
  return `This word belongs naturally in the ${friendlyTitle(batch)} situation.`;
}

function findExample(word: WordEntry, sentences: SentenceEntry[]): SentenceEntry | undefined {
  return sentences.filter((sentence) => sentence.chinese.includes(word.word)).sort((a, b) => a.chinese.length - b.chinese.length)[0];
}

function highlightWord(sentence: string, target: string): React.ReactNode {
  const index = sentence.indexOf(target);
  if (index < 0) return sentence;
  return <>{sentence.slice(0, index)}<mark>{target}</mark>{sentence.slice(index + target.length)}</>;
}

function stableHash(value: string): number {
  let hash = 0;
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return hash;
}

function stableShuffle<T extends { word: string }>(items: T[], salt: string): T[] {
  return [...items].sort((a, b) => stableHash(`${salt}:${a.word}`) - stableHash(`${salt}:${b.word}`));
}

function buildContextQuestions(batch: LearningBatch): ContextQuestion[] {
  const targets = [...batch.words].sort((a, b) => b.word.length - a.word.length);
  const used = new Set<string>();
  const questions: ContextQuestion[] = [];
  for (const sentence of [...batch.sprintSentences, ...batch.sentences]) {
    const target = targets.find((word) => !used.has(word.word) && sentence.chinese.includes(word.word));
    if (!target) continue;
    used.add(target.word);
    const distractors = stableShuffle(batch.words.filter((word) => word.word !== target.word), sentence.chinese).slice(0, 3);
    questions.push({ sentence, target, options: stableShuffle([target, ...distractors], target.word) });
    if (questions.length >= Math.min(4, batch.words.length)) break;
  }
  return questions;
}
