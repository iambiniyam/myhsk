# MyHSK analytics

MyHSK uses two complementary, cookie-free analytics layers:

- Cloudflare Web Analytics measures visitors, page views, countries, referrers, devices, browsers, and Core Web Vitals.
- The `/api/analytics/events` endpoint records anonymous product events in Cloudflare D1 so learning behavior can be improved.

Product events contain random visitor and tab-session IDs, an event name, a broad app area, a generic category, an optional count, and a two-letter country code. The app also groups devices, browsers, acquisition sources, and page-load speed into broad categories. Events never contain search text, words, characters, study progress, IP addresses, exact referrer URLs, or personal information. Users can disable these events in Settings; doing so deletes the visitor ID. Product events are automatically removed after 180 days.

## Read the product report

From the project directory, run:

```sh
npm run analytics:report
```

This reports anonymous visitors, sessions, returning use, word and character detail usage, audio usage, search starts, group starts and completions, feature popularity, devices, browsers, acquisition categories, page-load performance, and countries for the latest 30 days.

Cloudflare traffic and performance data is available in **Cloudflare Dashboard → Workers & Pages → myhsk → Metrics → Web Analytics**.
