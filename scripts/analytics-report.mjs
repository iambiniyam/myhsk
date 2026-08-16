import { execFileSync } from "node:child_process";

const wrangler = "./node_modules/.bin/wrangler";
const database = "myhsk-analytics";

function query(sql) {
  const output = execFileSync(wrangler, ["d1", "execute", database, "--remote", "--json", "--command", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const result = JSON.parse(output);
  return result[0]?.results ?? [];
}

function section(title, rows) {
  process.stdout.write(`\n${title}\n`);
  if (!rows.length) process.stdout.write("No data yet.\n");
  else console.table(rows);
}

const overview = query(`
  SELECT
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-1 day') THEN visitor_id END) AS visitors_24h,
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-7 days') THEN visitor_id END) AS visitors_7d,
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-30 days') THEN visitor_id END) AS visitors_30d,
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-1 day') THEN session_id END) AS sessions_24h,
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-7 days') THEN session_id END) AS sessions_7d,
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-30 days') THEN session_id END) AS sessions_30d,
    COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS actions_7d,
    COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END), 0) AS actions_30d
  FROM analytics_events
`);

const returning = query(`
  SELECT COUNT(*) AS returning_visitors_30d
  FROM (
    SELECT visitor_id
    FROM analytics_events
    WHERE visitor_id IS NOT NULL AND created_at >= datetime('now', '-30 days')
    GROUP BY visitor_id
    HAVING COUNT(DISTINCT date(created_at)) >= 2
  )
`);

const learning = query(`
  SELECT
    COALESCE(SUM(event = 'word_detail_open'), 0) AS words_opened,
    COALESCE(SUM(event = 'character_detail_open'), 0) AS characters_opened,
    COALESCE(SUM(event = 'audio_play'), 0) AS pronunciations_played,
    COALESCE(SUM(event = 'search_used'), 0) AS searches_started,
    COALESCE(SUM(event = 'group_start'), 0) AS groups_started,
    COALESCE(SUM(event = 'group_complete'), 0) AS groups_completed
  FROM analytics_events
  WHERE created_at >= datetime('now', '-30 days')
`);

const daily = query(`
  SELECT
    date(created_at) AS day,
    COUNT(DISTINCT visitor_id) AS visitors,
    COUNT(DISTINCT session_id) AS sessions,
    SUM(event = 'word_detail_open') AS words,
    SUM(event = 'character_detail_open') AS characters,
    SUM(event = 'group_complete') AS groups_completed
  FROM analytics_events
  WHERE created_at >= datetime('now', '-30 days')
  GROUP BY day
  ORDER BY day DESC
`);

const popular = query(`
  SELECT
    event,
    COALESCE(area, '-') AS area,
    COALESCE(detail, '-') AS detail,
    COUNT(*) AS actions,
    COUNT(DISTINCT session_id) AS sessions
  FROM analytics_events
  WHERE created_at >= datetime('now', '-30 days')
  GROUP BY event, area, detail
  ORDER BY actions DESC
  LIMIT 20
`);

const countries = query(`
  SELECT
    COALESCE(country, 'unknown') AS country,
    COUNT(DISTINCT visitor_id) AS visitors,
    COUNT(DISTINCT session_id) AS sessions
  FROM analytics_events
  WHERE created_at >= datetime('now', '-30 days')
  GROUP BY country
  ORDER BY sessions DESC
  LIMIT 15
`);

const devices = query(`
  SELECT area AS device, detail AS browser, COUNT(DISTINCT visitor_id) AS visitors
  FROM analytics_events
  WHERE event = 'client_context' AND created_at >= datetime('now', '-30 days')
  GROUP BY area, detail
  ORDER BY visitors DESC
`);

const acquisition = query(`
  SELECT detail AS source, COUNT(DISTINCT visitor_id) AS visitors
  FROM analytics_events
  WHERE event = 'acquisition_source' AND created_at >= datetime('now', '-30 days')
  GROUP BY detail
  ORDER BY visitors DESC
`);

const performance = query(`
  SELECT detail AS rating, COUNT(*) AS loads, ROUND(AVG(value)) AS average_ms, MAX(value) AS slowest_ms
  FROM analytics_events
  WHERE event = 'performance_load' AND created_at >= datetime('now', '-30 days')
  GROUP BY detail
  ORDER BY average_ms
`);

process.stdout.write("MyHSK anonymous product analytics (UTC)\n");
section("Overview", overview);
section("Returning use", returning);
section("Learning activity · last 30 days", learning);
section("Daily activity", daily);
section("Most-used features", popular);
section("Devices and browsers", devices);
section("Acquisition", acquisition);
section("Page-load performance", performance);
section("Countries", countries);
