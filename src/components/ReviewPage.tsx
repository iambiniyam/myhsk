import { useEffect, useMemo, useState } from "react";
import { Brain, CheckCircle2, RotateCw } from "lucide-react";
import type { AppState, CharacterEntry, MasteryRecord, Skill, WordEntry } from "../types";
import { loadAllWords, loadCharacters } from "../lib/content";
import { AudioButton } from "./AudioButton";
import { ScoreButtons } from "./ScoreButtons";

const skills: Skill[] = ["recognition", "meaning", "sound", "writing", "context", "production"];
function weakestSkill(item: MasteryRecord): Skill {
  const now = Date.now();
  const due = skills.filter((skill) => {
    const schedule = item.schedules?.[skill];
    return schedule && new Date(schedule.dueAt).getTime() <= now;
  });
  const pool = due.length ? due : skills;
  return [...pool].sort((a, b) => {
    const aDue = item.schedules?.[a] ? new Date(item.schedules[a]!.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = item.schedules?.[b] ? new Date(item.schedules[b]!.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue || (item.skills[a] ?? 0) - (item.skills[b] ?? 0);
  })[0];
}

function overallStrength(item: MasteryRecord): number {
  const values = Object.values(item.skills).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function ReviewPage({ state, record }: { state: AppState; record: (kind: "word" | "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void }) {
  const [words, setWords] = useState<WordEntry[]>([]);
  const [characters, setCharacters] = useState<Record<string, CharacterEntry>>({});
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = useState<"due" | "extra">("due");
  const [reviewed, setReviewed] = useState<string[]>([]);
  useEffect(() => { void Promise.all([loadAllWords(), loadCharacters()]).then(([allWords, allCharacters]) => { setWords(allWords); setCharacters(allCharacters); }); }, []);

  const dueItems = useMemo(() => Object.values(state.mastery)
    .filter((item) => new Date(item.dueAt).getTime() <= Date.now())
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()), [state.mastery]);
  const extraItems = useMemo(() => Object.values(state.mastery)
    .filter((item) => !reviewed.includes(item.key))
    .sort((a, b) => overallStrength(a) - overallStrength(b) || (a.lastSeenAt ?? "").localeCompare(b.lastSeenAt ?? "")), [state.mastery, reviewed]);
  const queue = mode === "due" ? dueItems.filter((item) => !reviewed.includes(item.key)) : extraItems;
  const item = queue[0];
  const word = item?.kind === "word" ? words.find((entry) => entry.word === item.text) : undefined;
  const character = item?.kind === "character" ? characters[item.text] : undefined;
  const skill = item ? weakestSkill(item) : "recognition";

  const score = (value: 0 | 1 | 2 | 3) => {
    if (!item) return;
    record(item.kind, item.text, skill, value);
    setReviewed((current) => [...current, item.key]);
    setRevealed(false);
  };

  const startMode = (nextMode: "due" | "extra") => {
    setMode(nextMode);
    setReviewed([]);
    setRevealed(false);
  };

  if (!Object.keys(state.mastery).length) return <div className="page"><section className="page-heading"><span className="eyebrow">UNLIMITED REVIEW</span><h1>Learn something first,<br/>then strengthen it here.</h1></section><div className="empty-state"><Brain size={54}/><h2>No review material yet</h2><p>Anything you score in Learn or Library becomes available for multi-direction review.</p></div></div>;

  if (!item) return <div className="page"><section className="page-heading"><span className="eyebrow">UNLIMITED REVIEW</span><h1>{mode === "due" ? "All due reviews complete." : "You practiced everything."}</h1><p>{reviewed.length} items reviewed in this session. Continue with extra practice or restart the weakest-first queue.</p></section><div className="empty-state"><CheckCircle2 size={54}/><h2>Memory repaired</h2><p>Due reviews stop when complete, but optional practice is always available.</p><div className="review-empty-actions"><button className="primary-button" onClick={() => startMode("extra")}>Practice weak items</button><button className="secondary-button" onClick={() => startMode(mode)}><RotateCw size={17}/> Restart queue</button></div></div></div>;

  return <div className="page review-page"><section className="page-heading"><span className="eyebrow">UNLIMITED REVIEW</span><h1>Repair the weakest link.</h1><p>{mode === "due" ? `${queue.length} due items remain` : `${queue.length} optional items remain`} · testing <strong>{skill}</strong></p></section>
    <div className="segmented review-mode"><button className={mode === "due" ? "active" : ""} onClick={() => startMode("due")}>Due now <b>{dueItems.length}</b></button><button className={mode === "extra" ? "active" : ""} onClick={() => startMode("extra")}>Extra practice</button></div>
    <div className="review-session-count"><strong>{reviewed.length}</strong><span>reviewed this session</span></div>
    <article className="review-card"><span className="skill-chip"><Brain size={15}/>{skill}</span><ReviewPrompt item={item} skill={skill}/>
      {skill === "sound" && <AudioButton text={word?.word ?? item.text} label="Play audio"/>}
      {!revealed ? <button className="primary-button wide" onClick={() => setRevealed(true)}>Reveal answer</button> : <div className="review-answer">{word && <><p className="answer-pinyin">{word.pinyin}</p><div className="definition-list">{word.definitions.slice(0, 3).map((definition) => <p key={definition}>{definition}</p>)}</div></>}{character && <><p className="answer-pinyin">{character.pinyin.join(" · ")}</p><p>{character.definition}</p></>}<ScoreButtons onScore={score}/></div>}
    </article>
  </div>;
}

function ReviewPrompt({ item, skill }: { item: MasteryRecord; skill: Skill }) {
  if (skill === "sound") return <><p className="review-instruction">Listen without looking. What word do you hear?</p><div className="review-hidden">?</div></>;
  if (skill === "meaning") return <><p className="review-instruction">Recall the meaning and one natural use.</p><div className="review-target">{item.text}</div></>;
  if (skill === "writing") return <><p className="review-instruction">Write this from memory before revealing.</p><div className="review-target">{item.kind === "word" ? item.text : "Recall the character"}</div></>;
  if (skill === "production") return <><p className="review-instruction">Say one original sentence using:</p><div className="review-target">{item.text}</div></>;
  return <><p className="review-instruction">Recognize this instantly, without translating character by character.</p><div className="review-target">{item.text}</div></>;
}
