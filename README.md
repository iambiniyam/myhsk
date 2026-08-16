# MyHSK

A minimal, content-focused Chinese learning app. No accounts, no analytics, no database —
just the complete HSK curriculum, spaced repetition, and high-quality Mandarin audio.

## What the app does

- **All vocabulary** — search the complete HSK 3.0 syllabus by Chinese, pinyin, or English and browse every HSK level.
- **Adaptive complete groups** — follow each connected family to its natural end through discovery, retrieval, contextual reading, and active use; larger families use focused recall sets without dropping words, and due memories return inside the next relevant group.
- **Complete word pages** — open any headword for pinyin, meanings, character building blocks, examples, grammar patterns, related words, and natural chunks.
- **Character reading path** — learn all 3,088 HSK characters in sets prioritized by usefulness, frequency, and reusable components, moving from noticing to recall to reading real words.
- **Clue families** — reuse 39 meaning-component families, 23 sound-component families, and 27 carefully grouped look-alike contrasts.
- **Complete character pages** — inspect structure, components, high-value words, family connections, contextual examples, and optional stroke practice.
- **Graded reading studio** — short, deliberate stories where every word can be tapped for a verified meaning.
- **Local-first progress** — everything is stored in your browser. Export a backup from Settings anytime; nothing is uploaded.
- **Evidence-weighted selection** — spoken frequency and contextual diversity from SUBTLEX-CH help choose useful words before low-value syllabus entries.

The curriculum includes 11,000 official HSK entries, 10,896 unique headwords, 3,088 HSK characters, 231 cultural knowledge items, 15,373 graded and open examples, and 10,786 HSK headwords connected by sense — synonyms plus OpenHowNet-derived hypernym and hyponym links. Memory timing is handled locally with FSRS.

## Audio quality

Audio is static-first: native Mandarin word recordings, then a high-quality neural voice pack
(generated ahead of time with edge-tts `zh-CN-XiaoxiaoNeural`), then on-demand neural audio
that prefers the most natural model available on Cloudflare Workers AI. Only when a clip is
missing and no device Mandarin voice exists does the app request a single synthesized clip.

## Run locally

```bash
npm install
npm run check
npm run build
npm run dev
```

`npm run check` rebuilds and validates every curriculum artifact. The one Cloudflare
function (neural TTS) can be tested with `wrangler pages dev dist`.

## Deploy to Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name myhsk
```

The deployment needs only the Workers AI binding declared in `wrangler.jsonc` (`AI`).
There are no secrets, databases, or environment variables. Connect the GitHub repository
to Cloudflare Pages with the build command `npm run build` and output directory `dist`
for automatic deploys.

## Refresh source data

```bash
npm run data:sync
npm run data:subtlex
npm run data:hsk
npm run data:hownet
npm run content:build
```

`npm run data:hownet` downloads the MIT-licensed OpenHowNet knowledge base (75 MB, cached once under `scripts/.cache/`) and derives conservative hypernym, hyponym, and meaning-neighbor relations for HSK headwords.

`npm run content:build` also derives the runtime-friendly artifacts: per-level ranking features, id-sharded graded and spoken sentence corpora with word indexes, and hash-sharded open-dictionary shards. `npm run verify:sharding` checks that the sharded corpora select exactly the same candidate sentences as the full files, and `npm run content:validate` verifies every derived artifact.

### Rebuild the full Mandarin audio pack

```bash
python -m pip install edge-tts
python scripts/generate_audio.py --levels 1 2 3 4 5 6 7-9 --word-limit 11000 --sentence-limit 4354 --concurrency 8
```

This generates a complete neural voice pack for every HSK word and graded sentence
(about 3–4 hours). The `.github/workflows/audio-pack.yml` workflow can do it in CI.

## Production behavior

Each learning area loads only when it is opened. Larger word and character details are
divided into on-demand curriculum shards, stroke data loads only when the optional tracing
tool is used, and a learning batch downloads only the sentence shards and ranking features
it needs instead of the full corpora. The reading studio taps the 115,000+ word open
dictionary one shard at a time. The included service worker caches the app shell and
previously opened curriculum data for resilient repeat visits.

There are no accounts, subscriptions, daily caps, or analytics. Learning works fully
offline once the content is loaded.

## Data and licenses

The app combines the official HSK syllabus with CC-CEDICT, Chinese Open Wordnet, Tatoeba
examples, open character/stroke resources, OpenHowNet, and human Mandarin word recordings
from Audio-cmn. Dataset-specific attribution and redistribution terms are recorded in
[`public/content/DATA_LICENSES.txt`](public/content/DATA_LICENSES.txt) and
[`public/audio/HUMAN_AUDIO_LICENSE.txt`](public/audio/HUMAN_AUDIO_LICENSE.txt). Generated
learning relationships are treated as hints and filtered conservatively; uncertain phrases
are omitted rather than presented as facts.
