export function ScoreButtons({ onScore, compact = false }: { onScore: (score: 0 | 1 | 2 | 3) => void; compact?: boolean }) {
  return <div className={compact ? "score-buttons compact" : "score-buttons"}>
    <button onClick={() => onScore(0)}>Again</button><button onClick={() => onScore(1)}>Hard</button><button onClick={() => onScore(2)}>Good</button><button onClick={() => onScore(3)}>Easy</button>
  </div>;
}
