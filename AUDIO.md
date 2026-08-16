# Mandarin audio architecture

MyHSK uses audio for retrieval, discrimination, shadowing, and pronunciation—not as decoration.

## Playback order

1. Matching studio sentence audio from the open CosyVoice2 sentence pack.
2. Same-origin neural Mandarin generated on demand with Cloudflare Workers AI MeloTTS.
3. The best Mandarin neural or premium voice exposed by the learner's device.
4. A clear unavailable state if neither media playback nor device speech is available.

No provider credential is shipped to the browser. The Pages Function validates and limits requests, while both the Cloudflare edge and the browser cache successful audio. In-flight requests for the same text are de-duplicated and active learning items are warmed before the learner taps Listen.

## Cross-browser behavior

The neural layer returns ordinary audio bytes, so Chrome, Safari, Firefox, and Edge use the same HTML media path. Browser speech synthesis is only the offline/resilience fallback; its installed voice list differs by operating system.

Slow playback uses the dedicated slow studio recording when one exists. For on-demand audio, the browser uses pitch-preserving playback-rate control.

## Optional completely offline sentence pack

```bash
python -m pip install huggingface_hub
python scripts/download_sentence_audio.py
```

A single level can be installed with `python scripts/download_sentence_audio.py --level 1`.

## Production configuration

The Cloudflare Pages project requires a Workers AI binding named `AI`. It is declared in `wrangler.jsonc`; `functions/api/tts.js` is deployed with the static build. The endpoint exposes a no-cost health check at `GET /api/tts` and synthesis at same-origin `POST /api/tts`.

## Reliability and privacy

- Audio never autoplays.
- One media element is reused to avoid mobile media-session churn.
- A new playback interrupts the previous one cleanly.
- Requests time out and fall back instead of leaving the learner waiting.
- Only Chinese text is accepted, with a strict length limit.
- No learning progress or personal data is sent to the speech model.
- Successful neural audio is cached for fast replay.
