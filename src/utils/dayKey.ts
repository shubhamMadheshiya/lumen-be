/**
 * One "Lumen day" for the whole server: it runs from the member's Day Reset Boundary
 * (preferences.dayBoundaryHour, default 4 AM) in their time zone to the next boundary.
 * A log at 01:30 with a 4 AM boundary belongs to the day before.
 *
 * Every day-level number (insights, stats, flare detection) must use these helpers so days
 * never split at UTC midnight (05:30 in India) or at local midnight.
 */

export const DEFAULT_BOUNDARY_HOUR = 4;
const HOUR_MS = 3600000;

/** A usable IANA zone: the entry's own, else the member's, else UTC. */
export function resolveTimeZone(...candidates: Array<string | undefined | null>): string {
  for (const tz of candidates) {
    if (!tz) continue;
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: tz });
      return tz;
    } catch {
      // not a zone this runtime knows; try the next one
    }
  }
  return 'UTC';
}

function clampBoundary(hour: number | undefined | null): number {
  return typeof hour === 'number' && Number.isFinite(hour) && hour >= 0 && hour <= 12 ? Math.floor(hour) : DEFAULT_BOUNDARY_HOUR;
}

/** YYYY-MM-DD of the Lumen day `date` falls in. */
export function trackingDayKey(date: Date, timeZone: string, boundaryHour: number = DEFAULT_BOUNDARY_HOUR): string {
  // Moving the instant back by the boundary makes "04:00 local" land on local midnight, so the
  // calendar date in the member's zone is the tracking day. India has no daylight saving; in zones
  // that do, a boundary within the skipped/repeated hour can shift by an hour on those two nights.
  const shifted = new Date(date.getTime() - clampBoundary(boundaryHour) * HOUR_MS);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: resolveTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(shifted);
  } catch {
    return shifted.toISOString().slice(0, 10);
  }
}

/** The day key `deltaDays` before or after `key`. */
export function shiftDayKey(key: string, deltaDays: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (24 * HOUR_MS));
}

/** 0 = Sunday … 6 = Saturday, for the calendar date a day key names. */
export function weekdayOfKey(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

/** Every day key from `from` to `to`, inclusive. */
export function dayKeysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = shiftDayKey(k, 1)) out.push(k);
  return out;
}
