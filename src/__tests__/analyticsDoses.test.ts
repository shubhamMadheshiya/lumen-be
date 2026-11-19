/** Planned doses, marks, "not marked" and plan history. */
import { doseDay, expectedSlots, latestMarks, slotStates, withScheduleVersion, MedLike, DoseMarkLike } from '../services/meds/doses';

const med = (over: Partial<MedLike> = {}): MedLike => ({
  _id: 'm1', name: 'HCQ',
  scheduleHistory: [{ from: '2026-11-01', doseTimes: [{ slot: '08:00' }, { slot: '20:00' }], daysOfWeek: [], prn: false }],
  ...over,
});
const mark = (dayKey: string, slot: string, status: DoseMarkLike['status'], t = '2026-11-01T00:00:00Z'): DoseMarkLike =>
  ({ medicationId: 'm1', dayKey, slot, status, clientUpdatedAt: t });

describe('expectedSlots', () => {
  it('uses the plan in force that day, the weekdays, and start/stop dates', () => {
    const m = med({
      startedOn: '2026-11-01', stoppedOn: '2026-11-30',
      scheduleHistory: [
        { from: '2026-11-01', doseTimes: [{ slot: '08:00' }], daysOfWeek: [], prn: false },
        { from: '2026-11-10', doseTimes: [{ slot: '09:00' }, { slot: '21:00' }], daysOfWeek: [1, 3, 5], prn: false },
      ],
    });
    expect(expectedSlots(m, '2026-10-31')).toEqual([]);
    expect(expectedSlots(m, '2026-11-05')).toEqual(['08:00']);
    expect(expectedSlots(m, '2026-11-11')).toEqual(['09:00', '21:00']); // Wednesday
    expect(expectedSlots(m, '2026-11-12')).toEqual([]); // Thursday
    expect(expectedSlots(m, '2026-12-01')).toEqual([]);
  });

  it('never plans an as-needed medicine, and nothing before a plan existed', () => {
    expect(expectedSlots(med({ scheduleHistory: [{ from: '2026-11-01', doseTimes: [{ slot: '08:00' }], daysOfWeek: [], prn: true }] }), '2026-11-02')).toEqual([]);
    expect(expectedSlots(med({ scheduleHistory: [] }), '2026-11-02')).toEqual([]);
  });
});

describe('doseDay', () => {
  it('counts taken, skipped and not marked; never assumes a skip', () => {
    expect(doseDay(med(), [mark('2026-11-02', '08:00', 'taken')], '2026-11-02')).toMatchObject({ scheduled: 2, taken: 1, skipped: 0, unmarked: 1 });
    expect(doseDay(med(), [mark('2026-11-02', '08:00', 'skipped'), mark('2026-11-02', '20:00', 'taken')], '2026-11-02')).toMatchObject({ taken: 1, skipped: 1, unmarked: 0 });
  });

  it('keeps the newest mark per slot (a later "taken" replaces an earlier "skipped")', () => {
    const marks = [mark('2026-11-02', '08:00', 'skipped', '2026-11-02T08:00:00Z'), mark('2026-11-02', '08:00', 'taken', '2026-11-02T09:00:00Z')];
    expect(latestMarks(marks)).toHaveLength(1);
    expect(doseDay(med(), marks, '2026-11-02')).toMatchObject({ taken: 1, skipped: 0 });
  });

  it('lets imported "unscheduled" marks fill planned slots, and counts extras separately', () => {
    const d = doseDay(med(), [mark('2026-11-02', 'unscheduled', 'taken'), mark('2026-11-02', 'prn', 'extra')], '2026-11-02');
    expect(d).toMatchObject({ taken: 1, unmarked: 1, extra: 1 });
  });
});

describe('slotStates', () => {
  it('shows later doses today as upcoming, not missed', () => {
    const s = slotStates(med(), [mark('2026-11-02', '08:00', 'taken')], '2026-11-02', '12:30');
    expect(s.map(x => [x.slot, x.state])).toEqual([['08:00', 'taken'], ['20:00', 'upcoming']]);
  });
});

describe('withScheduleVersion', () => {
  it('adds a version only when the plan really changed, replacing one from the same day', () => {
    const h0 = withScheduleVersion([], { doseTimes: [{ slot: '08:00' }], daysOfWeek: [], prn: false }, '2026-11-01');
    expect(h0).toHaveLength(1);
    expect(withScheduleVersion(h0, { doseTimes: [{ slot: '08:00' }], daysOfWeek: [], prn: false }, '2026-11-05')).toHaveLength(1);
    const h1 = withScheduleVersion(h0, { doseTimes: [{ slot: '09:00' }], daysOfWeek: [], prn: false }, '2026-11-05');
    expect(h1.map(v => v.from)).toEqual(['2026-11-01', '2026-11-05']);
    const h2 = withScheduleVersion(h1, { doseTimes: [{ slot: '10:00' }], daysOfWeek: [], prn: false }, '2026-11-05');
    expect(h2.map(v => [v.from, v.doseTimes[0].slot])).toEqual([['2026-11-01', '08:00'], ['2026-11-05', '10:00']]);
  });
});
