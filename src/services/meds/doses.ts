/**
 * Planned doses and their marks, per medicine per Lumen day. Pure functions.
 *
 * Rules:
 * - A planned dose comes from the dose plan that applied on that day (`scheduleHistory`), between
 *   `startedOn` and `stoppedOn`, on the plan's weekdays.
 * - "As needed" (PRN) medicines are never planned, so they can never be "skipped".
 * - A planned dose without a mark is "not marked" — never assumed skipped.
 * - A Skip the member marked always counts as skipped, planned or not.
 */
import { weekdayOfKey } from '../../utils/dayKey';

export interface DoseTimeLike { slot: string; amount?: string | null }
export interface ScheduleVersionLike { from: string; doseTimes: DoseTimeLike[]; daysOfWeek: number[]; prn: boolean }
export interface MedLike {
  _id: unknown;
  name: string;
  dose?: string | null;
  prn?: boolean;
  doseTimes?: DoseTimeLike[];
  daysOfWeek?: number[];
  scheduleHistory?: ScheduleVersionLike[];
  startedOn?: string | null;
  stoppedOn?: string | null;
}
export interface DoseMarkLike { medicationId: unknown; dayKey: string; slot: string; status: 'taken' | 'skipped' | 'extra'; clientUpdatedAt?: Date | string; at?: Date | string }

export interface DoseDay {
  medicationId: string;
  scheduled: number;
  taken: number;
  skipped: number;
  extra: number;
  unmarked: number;
  prn: boolean;
}

/** The dose plan in force on `dayKey`, or null before any plan existed. */
export function scheduleOn(med: MedLike, dayKey: string): ScheduleVersionLike | null {
  const history = [...(med.scheduleHistory ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  let current: ScheduleVersionLike | null = null;
  for (const v of history) if (v.from <= dayKey) current = v;
  return current;
}

/** Planned dose times ("08:00", …) on `dayKey`, sorted. */
export function expectedSlots(med: MedLike, dayKey: string): string[] {
  if (med.startedOn && dayKey < med.startedOn) return [];
  if (med.stoppedOn && dayKey > med.stoppedOn) return [];
  const plan = scheduleOn(med, dayKey);
  if (!plan || plan.prn) return [];
  if (plan.daysOfWeek.length > 0 && !plan.daysOfWeek.includes(weekdayOfKey(dayKey))) return [];
  return Array.from(new Set(plan.doseTimes.map(t => t.slot))).sort();
}

/** Keeps only the newest mark per (medicine, day, slot) — except "prn"/"extra" marks, which can repeat. */
export function latestMarks<T extends DoseMarkLike>(marks: T[]): T[] {
  const byKey = new Map<string, T>();
  const repeatable: T[] = [];
  for (const m of marks) {
    if (m.slot === 'prn' || m.status === 'extra') { repeatable.push(m); continue; }
    const key = `${String(m.medicationId)}|${m.dayKey}|${m.slot}`;
    const prev = byKey.get(key);
    if (!prev || new Date(m.clientUpdatedAt ?? 0).getTime() >= new Date(prev.clientUpdatedAt ?? 0).getTime()) byKey.set(key, m);
  }
  return [...byKey.values(), ...repeatable];
}

/**
 * Totals for one medicine on one day. Marks without a planned slot ("unscheduled", from older
 * logs) fill planned slots that have no mark yet, in time order.
 */
export function doseDay(med: MedLike, marks: DoseMarkLike[], dayKey: string): DoseDay {
  const slots = expectedSlots(med, dayKey);
  const mine = latestMarks(marks.filter(m => String(m.medicationId) === String(med._id) && m.dayKey === dayKey));
  const bySlot = new Map<string, DoseMarkLike>();
  const loose: DoseMarkLike[] = [];
  for (const m of mine) {
    if (slots.includes(m.slot) && m.status !== 'extra') bySlot.set(m.slot, m);
    else loose.push(m);
  }
  for (const m of loose.filter(x => x.slot === 'unscheduled' && x.status !== 'extra')) {
    const free = slots.find(s => !bySlot.has(s));
    if (free) { bySlot.set(free, m); loose.splice(loose.indexOf(m), 1); }
  }
  const planned = [...bySlot.values()];
  return {
    medicationId: String(med._id),
    scheduled: slots.length,
    taken: planned.filter(m => m.status === 'taken').length + loose.filter(m => m.status === 'taken').length,
    skipped: planned.filter(m => m.status === 'skipped').length + loose.filter(m => m.status === 'skipped').length,
    extra: loose.filter(m => m.status === 'extra').length,
    unmarked: slots.filter(s => !bySlot.has(s)).length,
    prn: !!scheduleOn(med, dayKey)?.prn || (!!med.prn && !scheduleOn(med, dayKey)),
  };
}

export type SlotState = 'taken' | 'skipped' | 'unmarked' | 'upcoming';

/** Each planned slot of the day with its state, for the Today checklist. `nowHHmm` marks later slots as upcoming. */
export function slotStates(med: MedLike, marks: DoseMarkLike[], dayKey: string, nowHHmm?: string): Array<{ slot: string; amount?: string; state: SlotState; mark?: DoseMarkLike }> {
  const plan = scheduleOn(med, dayKey);
  const slots = expectedSlots(med, dayKey);
  const mine = latestMarks(marks.filter(m => String(m.medicationId) === String(med._id) && m.dayKey === dayKey && m.status !== 'extra'));
  return slots.map(slot => {
    const mark = mine.find(m => m.slot === slot);
    const amount = plan?.doseTimes.find(t => t.slot === slot)?.amount ?? undefined;
    const state: SlotState = mark ? (mark.status === 'skipped' ? 'skipped' : 'taken') : nowHHmm && slot > nowHHmm ? 'upcoming' : 'unmarked';
    return { slot, amount: amount || undefined, state, mark };
  });
}

/** Adds (or replaces) the plan version starting `fromDay` when the plan itself changed. */
export function withScheduleVersion(
  history: ScheduleVersionLike[],
  next: { doseTimes: DoseTimeLike[]; daysOfWeek: number[]; prn: boolean },
  fromDay: string,
): ScheduleVersionLike[] {
  const sorted = [...history].sort((a, b) => a.from.localeCompare(b.from));
  const last = sorted[sorted.length - 1];
  const norm = (v: { doseTimes: DoseTimeLike[]; daysOfWeek: number[]; prn: boolean }) =>
    JSON.stringify({ t: [...v.doseTimes].map(d => `${d.slot}|${d.amount ?? ''}`).sort(), d: [...v.daysOfWeek].sort(), p: !!v.prn });
  if (last && norm(last) === norm(next)) return sorted;
  const version = { from: fromDay, doseTimes: next.doseTimes.map(d => ({ slot: d.slot, ...(d.amount ? { amount: d.amount } : {}) })), daysOfWeek: [...next.daysOfWeek].sort(), prn: !!next.prn };
  return [...sorted.filter(v => v.from < fromDay), version];
}
