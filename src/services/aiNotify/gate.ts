/**
 * Whether a Lumen AI notification may be pushed now. Pure (no I/O, no clock), mirroring the app's
 * budget engine (mobile/src/services/intelligence/budgetEngine.ts): master switch, per-kind toggle,
 * mute, flare mode, quiet hours, then the shared daily budget. AI notifications count against the
 * same budget as the app's own intelligent notifications.
 *
 * `compose` says whether it is still worth writing the note for the app ("For you today") when it
 * can't be pushed: a morning briefing is, a skipped nudge or check-in isn't (it saves AI requests).
 * The reply to a serious log is safety-adjacent: it ignores the budget and quiet hours (the member
 * has just logged, so they are awake) and flare mode, but still needs the master switch and its toggle.
 */
import { resolveTimeZone } from '../../utils/dayKey';

export type AiKind = 'briefing' | 'nudge' | 'check_in' | 'log_reply';

export const CAPABILITY_FOR_KIND = {
  briefing: 'aiBriefing',
  nudge: 'aiNudge',
  check_in: 'aiCheckIn',
  log_reply: 'aiLogReply',
} as const;

export interface GatePolicy {
  masterEnabled: boolean;
  dailyBudget: number;
  quietHours: { enabled: boolean; start: string; end: string };
  flareModeActive: boolean;
  capabilities: Partial<Record<(typeof CAPABILITY_FOR_KIND)[AiKind], boolean>>;
  mutedUntil?: Date | null;
}

export type GateReason = 'master_off' | 'capability_off' | 'muted' | 'flare_mode' | 'quiet_hours' | 'budget';
export type GateResult = { push: true } | { push: false; reason: GateReason; compose: boolean };

export function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutes since local midnight at `date` in `timeZone`. */
export function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: resolveTimeZone(timeZone), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** Calendar date (YYYY-MM-DD) at `date` in `timeZone`. */
export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: resolveTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Start of the local calendar day containing `date`, as an instant. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const mins = localMinutes(date, timeZone);
  return new Date(date.getTime() - mins * 60_000 - date.getUTCSeconds() * 1000 - date.getUTCMilliseconds());
}

export function isQuietAt(minutes: number, q: GatePolicy['quietHours']): boolean {
  if (!q.enabled) return false;
  const start = parseHHMM(q.start);
  const end = parseHHMM(q.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function gate(
  kind: AiKind,
  policy: GatePolicy,
  ctx: { now: Date; timeZone: string; sentToday: number },
): GateResult {
  if (!policy.masterEnabled) return { push: false, reason: 'master_off', compose: false };
  if (policy.capabilities[CAPABILITY_FOR_KIND[kind]] === false) return { push: false, reason: 'capability_off', compose: false };
  if (kind === 'log_reply') return { push: true };

  const inApp = kind === 'briefing';
  if (policy.mutedUntil && policy.mutedUntil.getTime() > ctx.now.getTime()) return { push: false, reason: 'muted', compose: inApp };
  if (policy.flareModeActive) return { push: false, reason: 'flare_mode', compose: inApp };
  if (isQuietAt(localMinutes(ctx.now, ctx.timeZone), policy.quietHours)) return { push: false, reason: 'quiet_hours', compose: inApp };
  if (ctx.sentToday >= policy.dailyBudget) return { push: false, reason: 'budget', compose: true };
  return { push: true };
}

/** True when `slot` (HH:mm) has started at `now` but less than `windowMinutes` ago (member's local time). */
export function isSlotDue(slot: string, now: Date, timeZone: string, windowMinutes = 15): boolean {
  const diff = localMinutes(now, timeZone) - parseHHMM(slot);
  return diff >= 0 && diff < windowMinutes;
}
