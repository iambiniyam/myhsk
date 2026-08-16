import { useState } from "react";

export function PinyinLine({ pinyin, mode }: { pinyin: string; mode: "always" | "tap" | "never" }) {
  const [revealed, setRevealed] = useState(false);
  if (mode === "always") return <p className="pinyin">{pinyin}</p>;
  if (mode === "never" && !revealed) return <button className="reveal-line" onClick={() => setRevealed(true)}>Show pinyin</button>;
  return revealed ? <button className="pinyin reveal-line" onClick={() => setRevealed(false)}>{pinyin}</button> : <button className="reveal-line" onClick={() => setRevealed(true)}>Tap for pinyin</button>;
}
