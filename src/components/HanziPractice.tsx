import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { assetPath } from "../lib/content";

export function HanziPractice({ character, onComplete }: { character: string; onComplete?: () => void }) {
  const target = useRef<HTMLDivElement | null>(null);
  const writerRef = useRef<{ quiz: (options?: Record<string, unknown>) => void; animateCharacter: () => void } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    target.current!.innerHTML = "";
    import("hanzi-writer").then(({ default: HanziWriter }) => {
      if (cancelled || !target.current) return;
      const writer = HanziWriter.create(target.current, character, {
        width: 220,
        height: 220,
        padding: 8,
        showOutline: true,
        showCharacter: false,
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 120,
        highlightOnComplete: true,
        charDataLoader: (requestedChar, onLoad, onError) => {
          fetch(assetPath(`content/strokes/${encodeURIComponent(requestedChar)}.json`))
            .then((response) => { if (!response.ok) throw new Error(`No stroke data for ${requestedChar}`); return response.json(); })
            .then(onLoad)
            .catch(onError);
        },
      });
      writerRef.current = writer;
      writer.quiz({ onComplete: () => onComplete?.() });
      setReady(true);
    }).catch(() => setReady(false));
    return () => { cancelled = true; };
  }, [character, onComplete]);

  return <div className="hanzi-practice">
    <div ref={target} className="hanzi-canvas" aria-label={`Write ${character}`} />
    <div className="hanzi-actions"><button onClick={() => writerRef.current?.animateCharacter()} disabled={!ready}>Show order</button><button onClick={() => writerRef.current?.quiz()} disabled={!ready}><RotateCcw size={15}/> Try again</button></div>
  </div>;
}
