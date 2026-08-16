import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Search } from "lucide-react";
import { assetPath } from "../lib/content";

// Lazy-loaded handwriting recognition (hanzilookup-js + Make Me a Hanzi data).
type Recognizer = {
  AnalyzedCharacter: new (rawStrokes: number[][][]) => { analyzedStrokes: unknown[] };
  Matcher: new (dataName: string) => { match: (char: unknown, limit: number, ready: (matches: { character: string; score: number }[]) => void) => void };
  data: Record<string, { substrokes: string }>;
  decodeCompact: (base64: string) => Uint8Array;
};

let recognizerPromise: Promise<Recognizer> | undefined;
async function loadRecognizer(): Promise<Recognizer> {
  recognizerPromise ??= (async () => {
    const module = await import("hanzilookup-js");
    const [dataResponse] = await Promise.all([
      fetch(assetPath("content/handwriting/mmah.json")),
    ]);
    if (!dataResponse.ok) throw new Error("Handwriting data is unavailable.");
    const mmah = await dataResponse.json();
    module.data["mmah"] = mmah;
    module.data["mmah"].substrokes = module.decodeCompact(mmah.substrokes);
    return module as unknown as Recognizer;
  })();
  return recognizerPromise;
}

const BOX = 200;

export function HandwritingSearch({ onPick, onClose }: { onPick: (character: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<number[][][]>([]);
  const drawingRef = useRef<number[][]>([]);
  const [ready, setReady] = useState(false);
  const [matches, setMatches] = useState<{ character: string; score: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadRecognizer()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Handwriting is unavailable."); });
    return () => { cancelled = true; };
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#19221d";
    const scale = canvas.width / BOX;
    for (const stroke of strokesRef.current) {
      if (!stroke.length) continue;
      context.beginPath();
      context.moveTo(stroke[0][0] * scale, stroke[0][1] * scale);
      for (const [x, y] of stroke.slice(1)) context.lineTo(x * scale, y * scale);
      context.stroke();
    }
  }, []);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(BOX, ((event.clientX - rect.left) / rect.width) * BOX));
    const y = Math.max(0, Math.min(BOX, ((event.clientY - rect.top) / rect.height) * BOX));
    return [x, y];
  };

  const recognize = async () => {
    const strokes = strokesRef.current.filter((stroke) => stroke.length >= 2);
    if (!strokes.length) return;
    setBusy(true);
    setMatches([]);
    try {
      const module = await loadRecognizer();
      const matcher = new module.Matcher("mmah");
      const character = new module.AnalyzedCharacter(strokes);
      matcher.match(character, 12, (results) => setMatches(results));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recognition failed.");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    strokesRef.current = [];
    drawingRef.current = [];
    setMatches([]);
    redraw();
  };

  return <div className="handwriting-search">
    <div className="handwriting-toolbar"><span><PenLine size={14}/> Draw a character</span><div><button onClick={clear} aria-label="Clear drawing"><Eraser size={15}/> Clear</button><button className="text-button" onClick={onClose}>Close</button></div></div>
    <div className="handwriting-body">
      <canvas
        ref={canvasRef}
        width={BOX * 2}
        height={BOX * 2}
        aria-label="Handwriting input — draw a Chinese character"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawingRef.current = [canvasPoint(event)];
          strokesRef.current.push(drawingRef.current);
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current.length) return;
          drawingRef.current.push(canvasPoint(event));
          redraw();
        }}
        onPointerUp={() => { drawingRef.current = []; void recognize(); }}
      />
      <div className="handwriting-side">
        {!ready && !error && <p className="handwriting-hint">Loading recognizer…</p>}
        {error && <p className="handwriting-hint">{error}</p>}
        {ready && matches.length === 0 && !busy && <p className="handwriting-hint">Draw a character, then tap a match. Results appear here.</p>}
        {busy && <p className="handwriting-hint">Recognizing…</p>}
        <div className="handwriting-matches">
          {matches.map((match) => <button key={match.character} onClick={() => onPick(match.character)}><strong>{match.character}</strong><small>{Math.round(match.score)}</small></button>)}
        </div>
        <button className="handwriting-find" onClick={() => void recognize()} disabled={busy}><Search size={15}/> Find matches</button>
      </div>
    </div>
  </div>;
}
