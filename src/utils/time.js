/**
 * PHILIPPINE TIME for the whole interface
 * ───────────────────────────────────────────────────────────────────────
 * Every date and time OSAA-TRACK shows is Philippine Standard Time (UTC+8,
 * no daylight saving) — whatever the viewer's laptop/phone is set to.
 *
 * The server sends timestamps as plain "YYYY-MM-DD HH:mm:ss" text that is
 * already Philippine wall-clock time. The old code did
 * `new Date(text.replace(" ", "T"))`, which the browser reads in the
 * VIEWER's own zone — so the same post showed a different time on a laptop
 * set to another zone, and plain dates ("2026-10-02") could slip a day.
 *
 * Use these helpers for everything time-related instead of `new Date(...)`,
 * `toLocaleString()` or `Intl.DateTimeFormat` with no `timeZone`:
 *   parseDbDate(v)         → a real Date (or null)
 *   formatDateTime(v)      → "Oct 2, 2026, 2:30 PM"
 *   formatDate(v)          → "Oct 2, 2026"       (formatLongDate: "October 2, 2026")
 *   formatTime(v)          → "2:30 PM"
 *   timeAgo(v)             → "Just now" / "5m ago" / "3h ago" / "Oct 2"
 *   daysUntil(v)           → whole days left until a deadline (never below 0)
 *   phNow()                → { weekday, longDate, year } for "today" in the Philippines
 */
export const PH_TIME_ZONE = "Asia/Manila";
const PH_UTC_OFFSET = "+08:00";
const LOCALE = "en-PH";

const DB_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
const DB_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDbDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  let m = DB_DATETIME.exec(text);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}${PH_UTC_OFFSET}`);
  m = DB_DATE_ONLY.exec(text);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00${PH_UTC_OFFSET}`);
  const d = new Date(text); // already carries its own zone (e.g. ends in "Z")
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(value, options, fallback) {
  const d = parseDbDate(value);
  if (!d) return fallback;
  return new Intl.DateTimeFormat(LOCALE, { timeZone: PH_TIME_ZONE, ...options }).format(d);
}

export function formatDateTime(value, fallback = "—") {
  return fmt(value, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }, fallback);
}

export function formatDate(value, fallback = "—") {
  return fmt(value, { month: "short", day: "numeric", year: "numeric" }, fallback);
}

export function formatLongDate(value, fallback = "—") {
  return fmt(value, { month: "long", day: "numeric", year: "numeric" }, fallback);
}

export function formatShortDate(value, fallback = "") {
  return fmt(value, { month: "short", day: "numeric" }, fallback);
}

export function formatTime(value, fallback = "") {
  return fmt(value, { hour: "numeric", minute: "2-digit" }, fallback);
}

export function timeAgo(value) {
  const d = parseDbDate(value);
  if (!d) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now"; // also covers a few seconds of clock drift
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(d);
}

export function daysUntil(value) {
  const d = parseDbDate(value);
  if (!d) return null;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}

/** "Today" as the Philippines sees it — for greetings and date banners. */
export function phNow() {
  const now = new Date();
  return {
    weekday: new Intl.DateTimeFormat(LOCALE, { timeZone: PH_TIME_ZONE, weekday: "long" }).format(now),
    shortWeekday: new Intl.DateTimeFormat(LOCALE, { timeZone: PH_TIME_ZONE, weekday: "short" }).format(now),
    longDate: new Intl.DateTimeFormat(LOCALE, { timeZone: PH_TIME_ZONE, month: "long", day: "numeric", year: "numeric" }).format(now),
    year: Number(new Intl.DateTimeFormat("en-US", { timeZone: PH_TIME_ZONE, year: "numeric" }).format(now)),
  };
}

/** The calendar year (in the Philippines) of a stored timestamp, e.g. for year filters. */
export function phYear(value) {
  const d = parseDbDate(value);
  if (!d) return null;
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: PH_TIME_ZONE, year: "numeric" }).format(d));
}

/** Chat timestamp: "Oct 2, 2:30 PM" (no year — a thread is always recent). */
export function formatMessageTime(value, fallback = "") {
  return fmt(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, fallback);
}
