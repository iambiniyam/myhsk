# MyHSK

A mobile-first Chinese learning app built around two ideas: vocabulary is easier to remember in connected families, and characters are easier to read when their visual, sound, and meaning clues are made explicit.

## What the app does

- **All vocabulary** — search the complete HSK 3.0 syllabus by Chinese, pinyin, or English and browse every HSK level.
- **Adaptive complete groups** — follow each connected family to its natural end through discovery, retrieval, contextual reading, and active use; larger families use focused recall sets without dropping words, and due memories return inside the next relevant group.
- **Complete word pages** — open any headword for pinyin, meanings, character building blocks, examples, grammar patterns, related words, and natural chunks.
- **Character reading path** — learn all 3,088 HSK characters in sets prioritized by usefulness, frequency, and reusable components, moving from noticing to recall to reading real words.
- **Clue families** — reuse 39 meaning-component families, 23 sound-component families, and 27 carefully grouped look-alike contrasts.
- **Complete character pages** — inspect structure, components, high-value words, family connections, contextual examples, and optional stroke practice.
- **Local-first progress** — learning works without an account. Optional Better Auth accounts add secure sessions and synchronized words, characters, preferences, and study history across devices.
- **Personal word lists** — mark any vocabulary item as Learning or Known and filter the complete library by those states.
- **Evidence-weighted selection** — spoken frequency and contextual diversity from SUBTLEX-CH help choose useful words before low-value syllabus entries.

The production curriculum includes 11,000 official HSK entries, 10,896 unique headwords, 3,088 HSK characters, 231 cultural knowledge items, 15,373 graded and open examples, and 10,786 HSK headwords connected by sense — synonyms plus OpenHowNet-derived hypernym and hyponym links. Memory timing is handled locally with FSRS. Natural Mandarin audio is static-first: pre-generated CosyVoice recordings are preferred, while missing clips use the highest-quality Mandarin voice available on the learner's device.

## Run locally

```bash
npm install
npm run check
npm run build
npm run dev
```

`npm run check` rebuilds and validates every curriculum artifact, including all on-demand word-detail shards. Cloudflare Pages Functions and the optional account service can be tested with `wrangler pages dev dist` after applying the local D1 migration described in [`AUTH.md`](AUTH.md).

## Deploy to Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name myhsk
```

The deployment needs the D1 databases and Workers AI binding declared in `wrangler.jsonc`
(`ANALYTICS_DB`, `AUTH_DB`, `AI`), plus the Pages secrets listed in
[`AUTH.md`](AUTH.md) (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DEEPSEEK_API_KEY`). Apply schema changes
with `npx wrangler d1 migrations apply AUTH_DB --remote`. Alternatively, connect the
GitHub repository to Cloudflare Pages with the build command `npm run build` and output
directory `dist` — the Pages Functions in `functions/` are deployed automatically.


## Refresh source data

```bash
npm run data:sync
npm run data:subtlex
npm run data:hsk
npm run data:hownet
npm run content:build
```

`npm run data:hownet` downloads the MIT-licensed OpenHowNet knowledge base (75 MB, cached once under `scripts/.cache/`) and derives conservative hypernym, hyponym, and meaning-neighbor relations for HSK headwords, merging them into `semantic-relations.json`.

`npm run content:build` also derives the runtime-friendly artifacts: per-level ranking features (used to build learning batches without downloading the full frequency corpora), id-sharded graded and spoken sentence corpora with word indexes, and hash-sharded open-dictionary shards. `npm run verify:sharding` checks that the sharded corpora select exactly the same candidate sentences as the full files, and `npm run content:validate` verifies every derived artifact.

If the Make Me a Hanzi download is unavailable, the content build can still generate local stroke data from the installed `hanzi-writer-data` package.

## Production behavior

Each learning area loads only when it is opened. Larger word and character details are divided into on-demand curriculum shards, stroke data loads only when the optional tracing tool is used, and a learning batch downloads only the sentence shards and ranking features it needs instead of the full corpora. The reading studio taps the 115,000+ word open dictionary one shard at a time, only for tokens HSK does not cover. The included service worker caches the app shell and previously opened curriculum data for resilient repeat visits.

No account, subscription, daily cap, or AI service is required for learning. Accounts are an optional save-and-sync enhancement.

## Data and licenses

The app combines the official HSK syllabus with CC-CEDICT, Chinese Open Wordnet, Tatoeba examples, open character/stroke resources, and human Mandarin word recordings from Audio-cmn. Dataset-specific attribution and redistribution terms are recorded in [`public/content/DATA_LICENSES.txt`](public/content/DATA_LICENSES.txt) and [`public/audio/HUMAN_AUDIO_LICENSE.txt`](public/audio/HUMAN_AUDIO_LICENSE.txt). Generated learning relationships are treated as hints and filtered conservatively; uncertain phrases are omitted rather than presented as facts.
