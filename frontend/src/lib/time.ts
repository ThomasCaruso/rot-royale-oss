/**
 * Window-time formatting.
 *
 * Contest windows are stored as UTC instants. We display them in the VIEWER'S local timezone — the
 * browser's system zone, which follows their location — so each player sees the window time as it
 * falls on their own clock (no "ET" label). `Intl.DateTimeFormat` with no `timeZone` uses the local
 * zone; `formatToParts` keeps the string clean (Intl otherwise inserts a narrow no-break space
 * before AM/PM).
 *
 * The ZONE stays the viewer's; the LANGUAGE comes from the app locale (`activeTag()`), so switching
 * to French renders "9 juil. 2026" rather than the browser's "Jul 9, 2026". These two were
 * previously conflated by passing `undefined`, which follows the browser for both.
 */

import { activeTag } from "@/i18n/format";

/** Format a UTC ISO timestamp as a local wall-clock time, e.g. "05:00 PM" (en) / "17:00" (fr). */
export function formatLocalTime(iso: string): string {
  // hour12 is left to the locale: en is 12-hour, fr/tr are 24-hour. Forcing am/pm on a French clock
  // reads as broken, so the dayPeriod part is simply empty there and the join trims it.
  const parts = new Intl.DateTimeFormat(activeTag(), {
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("dayPeriod")}`.trim();
}

/**
 * Format a contest date (a plain calendar date string, e.g. "2026-06-09") as a short, readable
 * label like "Jun 9, 2026". A `contest_date` is a wall-clock CALENDAR date (no time/zone), so it's
 * parsed as a local date at noon — never `new Date("2026-06-09")`, which Intl reads as UTC midnight
 * and can roll back a day in western zones. The label uses the APP's language; no "ET" anywhere.
 */
export function formatLocalDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
    : new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(activeTag(), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
