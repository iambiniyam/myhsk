#!/usr/bin/env python3
"""Generate cross-browser Mandarin MP3 assets using edge-tts.

This is a maintainer tool. The shipped web app never needs Python or a server.
Examples:
  python scripts/generate_audio.py --levels 1 --word-limit 300 --sentence-limit 300
  python scripts/generate_audio.py --levels 1 2 3 --word-limit 1000 --sentence-limit 1000
"""
from __future__ import annotations
import argparse, asyncio, hashlib, json, re
from pathlib import Path

try:
    import edge_tts
except ImportError as exc:
    raise SystemExit("Install audio tooling first: python -m pip install edge-tts") from exc

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "public" / "content"
AUDIO = ROOT / "public" / "audio"
MANIFEST = AUDIO / "manifest.json"
LEVEL_FILE = {"1":"level-1.json","2":"level-2.json","3":"level-3.json","4":"level-4.json","5":"level-5.json","6":"level-6.json","7-9":"level-7-9.json"}


def clip_name(kind: str, text: str, speed: str) -> str:
    digest = hashlib.sha1(f"{kind}:{text}:{speed}".encode()).hexdigest()[:18]
    return f"clips/{digest}-{speed}.mp3"


def clean_text(text: str) -> str:
    return re.sub(r"\s+", "", text).strip()

async def generate(text: str, voice: str, rate: str, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and output.stat().st_size > 1000:
        return
    communicator = edge_tts.Communicate(text=text, voice=voice, rate=rate, volume="+0%", pitch="+0Hz")
    await communicator.save(str(output))

async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--levels", nargs="+", default=["1"])
    parser.add_argument("--word-limit", type=int, default=300)
    parser.add_argument("--sentence-limit", type=int, default=300)
    parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--stories", action="store_true", help="also render every graded-reading section")
    args = parser.parse_args()

    tasks = []
    if args.word_limit > 0 or not args.stories:
        words = []
        for level in args.levels:
            words.extend(json.loads((CONTENT / "hsk" / LEVEL_FILE[level]).read_text(encoding="utf8")))
        sentences = json.loads((CONTENT / "sentences" / "hsk.json").read_text(encoding="utf8"))
        max_level = max(7 if level == "7-9" else int(level) for level in args.levels)
        sentences = [row for row in sentences if row["hskLevel"] <= max_level]
        tasks += [("word", clean_text(row["word"])) for row in words[:args.word_limit]]
        tasks += [("sentence", clean_text(row["chinese"])) for row in sentences[:args.sentence_limit]]

    if args.stories:
        for name in ("reading-stories.json", "storyweaver-stories.json", "everflow-stories.json"):
            source = CONTENT / name
            if not source.exists():
                continue
            for story in json.loads(source.read_text(encoding="utf8")):
                for section in story.get("sentences", []):
                    # Keys must match the client lookup verbatim: trim ends only,
                    # never collapse internal spaces, or static clips will be missed.
                    text = section.get("chinese", "").strip()
                    if text:
                        tasks.append(("sentence", text))
    seen = set(); tasks = [task for task in tasks if not (task in seen or seen.add(task))]

    manifest = {"version": 1, "voice": args.voice, "generatedAt": None, "clips": {}}
    if MANIFEST.exists():
        try: manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
        except Exception: pass
    manifest["voice"] = args.voice
    semaphore = asyncio.Semaphore(args.concurrency)

    async def process(kind: str, text: str) -> None:
        key = f"{kind}:{text}"
        manifest["clips"].setdefault(key, {})
        async with semaphore:
            for speed, rate in (("normal", "-3%"), ("slow", "-25%")):
                relative = clip_name(kind, text, speed)
                await generate(text, args.voice, rate, AUDIO / relative)
                manifest["clips"][key][speed] = f"audio/{relative}"
            print(f"✓ {kind}: {text}")

    await asyncio.gather(*(process(kind, text) for kind, text in tasks))
    from datetime import datetime, timezone
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8")
    print(f"Generated {len(tasks)} natural Mandarin items in {AUDIO}.")

if __name__ == "__main__":
    asyncio.run(main())
