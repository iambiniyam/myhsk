import { useMemo, useState } from "react";
import { BookOpen, Eye, PenLine, Lightbulb } from "lucide-react";
import type { AppState, CharacterEntry, SentenceEntry, Skill, WordEntry } from "../types";
import { AudioButton } from "./AudioButton";
import { HanziPractice } from "./HanziPractice";
import { PinyinLine } from "./PinyinLine";
import { ScoreButtons } from "./ScoreButtons";

export function WordLearningCard({ word, state, sentences, onRecord }: { word: WordEntry; state: AppState; sentences: SentenceEntry[]; onRecord: (kind: "word", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void }) {
  const [heard, setHeard] = useState(false);
  const [wordRevealed, setWordRevealed] = useState(false);
  const [meaningRevealed, setMeaningRevealed] = useState(false);
  const example = useMemo(() => sentences.find((sentence) => sentence.words.includes(word.word) || sentence.chinese.includes(word.word)), [sentences, word.word]);
  return <article className="learning-card word-card">
    <div className="card-topline"><span className="level-chip">HSK {word.level}</span>{wordRevealed && <AudioButton text={word.word} gender={state.preferences.voiceGender} />}</div>
    {!wordRevealed ? <div className="listen-first">
      <span className="listen-symbol">听</span>
      <h3>Listen before looking</h3>
      <p>Play the word, say what you think you heard, then reveal the characters.</p>
      <AudioButton text={word.word} gender={state.preferences.voiceGender} label={heard ? "Play again" : "Listen"} prefetch onPlayed={() => setHeard(true)} />
      <button className="primary-button wide" disabled={!heard} onClick={() => setWordRevealed(true)}>Reveal the word</button>
    </div> : <>
      <div className="word-hero">{word.word}</div>
      <PinyinLine pinyin={word.pinyin} mode={state.preferences.showPinyin} />
      <p className="self-check">How accurately did you identify the sound?</p>
      <ScoreButtons compact onScore={(score) => onRecord("word", word.word, "sound", score)} />
      {!meaningRevealed ? <button className="secondary-button wide meaning-reveal" onClick={() => setMeaningRevealed(true)}><Eye size={18}/> Reveal meaning</button> : <>
        <div className="definition-list">{word.definitions.slice(0, 3).map((definition) => <p key={definition}>{definition}</p>)}</div>
        {word.partOfSpeech && <p className="meta-line">{word.partOfSpeech} {word.traditional && `· Traditional: ${word.traditional}`}</p>}
        {example && <div className="example-box"><div><strong>{example.chinese}</strong><AudioButton text={example.chinese} kind="sentence" speed={state.preferences.audioSpeed} /></div><PinyinLine pinyin={example.pinyin} mode="tap"/><p>{example.english}</p></div>}
        <p className="self-check">How well did you recall the meaning?</p><ScoreButtons compact onScore={(score) => onRecord("word", word.word, "meaning", score)} />
      </>}
    </>}
  </article>;
}
export function CharacterLearningCard({ character, data, words, state, onRecord }: { character: string; data?: CharacterEntry; words: WordEntry[]; state: AppState; onRecord: (kind: "character", text: string, skill: Skill, score: 0 | 1 | 2 | 3) => void }) {
  const [showWriting, setShowWriting] = useState(false);
  const audioWord = words[0]?.word ?? character;
  return <article className="learning-card character-card">
    <div className="card-topline"><span className="level-chip">Focus character</span><AudioButton text={audioWord} gender={state.preferences.voiceGender} /></div>
    <div className="character-layout">
      <div className="character-glyph">{character}</div>
      <div className="character-facts">
        <p className="pinyin strong">{data?.pinyin.join(" · ") || "—"}</p>
        <p>{data?.definition || "Learn this character through its words."}</p>
        <div className="fact-row"><span>Radical <strong>{data?.radical || "—"}</strong></span><span>Strokes <strong>{data?.strokes || "—"}</strong></span></div>
      </div>
    </div>
    {data?.etymology?.hint && <div className="memory-tip"><Lightbulb size={17}/><p>{data.etymology.hint}</p></div>}
    <div className="word-family"><span>Useful words</span>{words.length ? words.map((word) => <b key={word.word}>{word.word} <small>{word.pinyin}</small></b>) : <b>{audioWord}</b>}</div>
    <div className="two-actions"><button onClick={() => setShowWriting(false)} className={!showWriting ? "selected" : ""}><Eye size={16}/> Recognize</button><button onClick={() => setShowWriting(true)} className={showWriting ? "selected" : ""}><PenLine size={16}/> Write</button></div>
    {showWriting ? <HanziPractice character={character} onComplete={() => onRecord("character", character, "writing", 3)} /> : <><p className="self-check">Could you recognize its sound and role inside the words?</p><ScoreButtons compact onScore={(score) => onRecord("character", character, "recognition", score)} /></>}
  </article>;
}

export function SentenceLearningCard({ sentence, state, onRecord }: { sentence: SentenceEntry; state: AppState; onRecord?: (score: 0 | 1 | 2 | 3) => void }) {
  const [translation, setTranslation] = useState(false);
  return <article className="sentence-card">
    <div className="sentence-main"><p>{sentence.chinese}</p><AudioButton text={sentence.chinese} kind="sentence" speed={state.preferences.audioSpeed} label="Listen" prefetch/></div>
    <PinyinLine pinyin={sentence.pinyin} mode={state.preferences.showPinyin} />
    {translation ? <button className="translation" onClick={() => setTranslation(false)}>{sentence.english}</button> : <button className="reveal-line" onClick={() => setTranslation(true)}>Reveal meaning</button>}
    {sentence.grammarPoints.length > 0 && <div className="grammar-tags">{sentence.grammarPoints.slice(0, 3).map((point) => <span key={point}>{point}</span>)}</div>}
    {onRecord && <ScoreButtons compact onScore={onRecord} />}
  </article>;
}
