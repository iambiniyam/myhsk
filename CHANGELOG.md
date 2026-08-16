# Changelog

## 2.0.0

- Removed accounts, sign-in, and cross-device sync (Better Auth) entirely.
- Removed the marketing landing page; the app opens directly into learning.
- Removed analytics, the D1 databases, and all non-content Cloudflare functions.
- Removed the AI reading assistant (cloud LLM); the reading studio is fully local.
- Single Cloudflare function remains: on-demand Mandarin neural TTS, now preferring the
  most natural model with automatic fallback.
- Progress is purely local (browser storage) with export/import backup in Settings.
- Privacy page rewritten: no accounts, no analytics, no tracking.
- Simplified `wrangler.jsonc` to just the Workers AI binding; no secrets or databases.

## 1.4.0

- Reduced primary navigation from four destinations to three: Learn, Library, Review.
- Moved progress, preferences, and backup controls into one compact menu.
- Replaced the large learning-mode dashboard with one simple selector.
- Replaced the sticky five-button stage bar with a quiet progress line and guided next/back flow.
- Added single-anchor deep study while keeping the full vocabulary pack visible.
- Added richer word detail pages with matching graded and Tatoeba example sentences.
- Added a graded sentence stream to Reading.
- Expanded productive word webs from 260 to 500.
- Expanded practical scenarios from 19 to 62.
- Expanded contrast labs from 12 to 31.
- Preserved 23 filtered sound families and 39 meaning families.
- Removed the unused standalone Progress page from the product surface.
- Preserved local-only progress and v1.3 state compatibility.
