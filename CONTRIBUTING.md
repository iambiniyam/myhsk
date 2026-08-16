# Contributing to MyHSK

Thanks for helping make MyHSK a better Chinese learning app. The project is deliberately
small: a focused React app, a set of data-sync scripts, and one Cloudflare Pages
deployment. Contributions that keep it minimal and learner-first are welcome.

## Project layout

- `src/` — the app (React 19 + TypeScript + Vite). Local-first; no account needed.
- `functions/` — the single Cloudflare Pages Function: on-demand Mandarin neural TTS.
- `scripts/` — data pipeline: sync open datasets, build curriculum artifacts, validate.
- `public/content/` — the derived curriculum data the app ships (HSK syllabus, CC-CEDICT,
  graded sentences, character curriculum, learning networks, and the sharded artifacts).
- `public/audio/` — generated Mandarin audio (gitignored; rebuild via the workflow below).

## Local development

```bash
npm install
npm run dev        # http://localhost:5173
```

## Data integrity

Every change to the curriculum or its pipeline must keep the checks green:

```bash
npm run check            # rebuild content artifacts + validate every dataset + type-check
npm run verify:sharding  # proves sharded corpora select the same content as the full files
npm run build            # production build + prune
```

## Data licenses

Respect the attributions in `public/content/DATA_LICENSES.txt` and
`public/audio/HUMAN_AUDIO_LICENSE.txt`. New datasets must be compatible with the app's
conservative, verifiable-data approach and must not ship unverifiable generated content.

## Style

- Keep the UI minimal: one clear action per screen, no decorative clutter.
- Everything must stay local-first and content-focused: no accounts, analytics, or databases.
- Generated data must remain deterministic and reproducible from `scripts/`.
