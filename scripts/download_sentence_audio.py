#!/usr/bin/env python3
"""Download the optional 4,354-sentence normal/slow audio pack.

The source dataset is no7z/hsk-sentences-audio (CC BY-SA 4.0). The repository
contains 8,708 MP3 files synthesized with CosyVoice2. Files are copied to
public/audio so the static app can serve them without a backend.
"""
from __future__ import annotations
import argparse, json, shutil
from pathlib import Path

try:
    from huggingface_hub import snapshot_download
except ImportError as exc:
    raise SystemExit("Install the downloader first: python -m pip install huggingface_hub") from exc

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "public" / "audio"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--level", type=int, choices=range(1, 7), help="Copy only one HSK level after downloading the snapshot")
    parser.add_argument("--cache-dir")
    args = parser.parse_args()
    snapshot = Path(snapshot_download(
        repo_id="no7z/hsk-sentences-audio",
        repo_type="dataset",
        cache_dir=args.cache_dir,
        allow_patterns=["audio/*.mp3", "ATTRIBUTION.md", "README.md"],
    ))
    source = snapshot / "audio"
    if not source.exists():
        raise SystemExit("The downloaded dataset snapshot did not contain an audio directory. Check the current dataset layout.")
    TARGET.mkdir(parents=True, exist_ok=True)
    files = list(source.glob("*.mp3"))
    if args.level:
        files = [file for file in files if file.name.startswith(f"hsk{args.level}-")]
    for file in files:
        shutil.copy2(file, TARGET / file.name)
    for name in ("ATTRIBUTION.md",):
        if (snapshot / name).exists(): shutil.copy2(snapshot / name, TARGET / name)

    # Register installed files in the same static manifest used by Edge TTS clips.
    manifest_path = TARGET / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    except Exception:
        manifest = {"version": 1, "voice": "CosyVoice2 zh-female-studio", "clips": {}}
    sentence_rows = json.loads((ROOT / "public" / "content" / "sentences" / "hsk.json").read_text(encoding="utf8"))
    installed = {file.name for file in files}
    for row in sentence_rows:
        normal = Path(row.get("audioNormal", "")).name
        slow = Path(row.get("audioSlow", "")).name
        clip = manifest["clips"].setdefault(f"sentence:{row['chinese']}", {})
        if normal in installed: clip["normal"] = f"audio/{normal}"
        if slow in installed: clip["slow"] = f"audio/{slow}"
    from datetime import datetime, timezone
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8")
    print(f"Installed {len(files):,} Mandarin MP3 files in {TARGET}")

if __name__ == "__main__":
    main()
