import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Volume2 } from "lucide-react";
import { prefetchChinese, speakChinese, type AudioKind } from "../lib/audio";
import { trackAnalytics } from "../lib/analytics";

interface AudioButtonProps {
  text: string;
  kind?: AudioKind;
  speed?: "normal" | "slow";
  gender?: "female" | "male";
  label?: string;
  audioUrl?: string;
  prefetch?: boolean;
  onPlayed?: () => void;
}

export function AudioButton({ text, kind = "word", speed = "normal", gender = "female", label, audioUrl, prefetch = false, onPlayed }: AudioButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const operationRef = useRef(0);

  useEffect(() => {
    if (prefetch) void prefetchChinese(text, kind, audioUrl, speed);
  }, [audioUrl, kind, prefetch, speed, text]);

  const warm = () => { if (status === "idle") void prefetchChinese(text, kind, audioUrl, speed); };
  const play = async () => {
    const operation = ++operationRef.current;
    let reported = false;
    setStatus("loading");
    try {
      await speakChinese(text, { kind, speed, gender, mediaUrl: audioUrl, onStart: (source) => {
        if (operation !== operationRef.current || reported) return;
        reported = true;
        setStatus("idle");
        trackAnalytics("audio_play", { area: kind, detail: source });
        onPlayed?.();
      } });
      if (operation === operationRef.current) setStatus("idle");
    } catch (error) {
      if (operation !== operationRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setStatus("error");
      window.setTimeout(() => { if (operation === operationRef.current) setStatus("idle"); }, 2_000);
    }
  };

  const title = status === "error" ? "Audio is temporarily unavailable" : status === "loading" ? "Loading pronunciation" : "Play pronunciation";
  return <button
    className={status === "error" ? "audio-button error" : "audio-button"}
    onClick={() => void play()}
    onPointerEnter={warm}
    onPointerDown={warm}
    onFocus={warm}
    disabled={status === "loading"}
    aria-busy={status === "loading"}
    aria-label={`${title}: ${text}`}
    title={title}
  >{status === "loading" ? <LoaderCircle className="spin" size={17}/> : <Volume2 size={17}/>} {label && <span>{label}</span>}</button>;
}
