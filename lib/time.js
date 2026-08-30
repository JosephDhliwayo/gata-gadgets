// GATA GADGETS operates on Africa/Harare time (UTC+2, no daylight saving, so
// this fixed offset is always correct — no seasonal adjustment needed).
const HARARE_OFFSET_MS = 2 * 60 * 60 * 1000;

// A Date instance whose UTC-getter methods (toISOString, getUTCFullYear,
// getUTCDate, getUTCDay, ...) report Harare wall-clock time. Use this instead
// of `new Date()` anywhere "today"/"this week"/"this month" boundaries are
// computed, so they agree with timestamps stored via SQL_NOW below.
function nowHarare() {
  return new Date(Date.now() + HARARE_OFFSET_MS);
}

// SQL fragment to use anywhere a query previously used datetime('now'), so
// stored timestamps are Harare wall-clock time rather than UTC.
const SQL_NOW = "datetime('now', '+2 hours')";

module.exports = { nowHarare, SQL_NOW };
