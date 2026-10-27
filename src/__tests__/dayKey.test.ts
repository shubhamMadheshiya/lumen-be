import {
  daysBetween, dayKeysBetween, resolveTimeZone, shiftDayKey, trackingDayKey, weekdayOfKey,
} from '../utils/dayKey';

const IST = 'Asia/Kolkata';
// 22:30 UTC on 26 Oct is 04:00 IST on 27 Oct
const at = (iso: string) => new Date(iso);

describe('trackingDayKey', () => {
  it('starts the day at the boundary hour, not at midnight', () => {
    expect(trackingDayKey(at('2026-10-26T22:29:00Z'), IST, 4)).toBe('2026-10-26'); // 03:59 IST
    expect(trackingDayKey(at('2026-10-26T22:30:00Z'), IST, 4)).toBe('2026-10-27'); // 04:00 IST
  });

  it('keeps a 1:30 AM log on the day before', () => {
    expect(trackingDayKey(at('2026-10-27T20:00:00Z'), IST, 4)).toBe('2026-10-27'); // 01:30 IST on the 28th
  });

  it('does not split at UTC midnight (05:30 in India)', () => {
    // 00:10 UTC = 05:40 IST; with a 4 AM boundary this is still the same day as 04:30 IST
    expect(trackingDayKey(at('2026-10-27T00:10:00Z'), IST, 4)).toBe('2026-10-27');
    expect(trackingDayKey(at('2026-10-26T23:30:00Z'), IST, 4)).toBe('2026-10-27');
  });

  it('with a boundary of 0 it is plain local midnight', () => {
    expect(trackingDayKey(at('2026-10-26T18:29:00Z'), IST, 0)).toBe('2026-10-26');
    expect(trackingDayKey(at('2026-10-26T18:30:00Z'), IST, 0)).toBe('2026-10-27');
  });

  it('falls back to UTC for an unknown zone and to 4 AM for a bad boundary', () => {
    expect(trackingDayKey(at('2026-10-27T03:00:00Z'), 'Not/AZone', 4)).toBe('2026-10-26');
    expect(trackingDayKey(at('2026-10-27T03:00:00Z'), 'UTC', Number.NaN)).toBe('2026-10-26');
    expect(trackingDayKey(at('2026-10-27T03:00:00Z'), 'UTC', 99)).toBe('2026-10-26');
  });
});

describe('day key helpers', () => {
  it('picks the first usable zone', () => {
    expect(resolveTimeZone(undefined, 'Nope/Zone', IST)).toBe(IST);
    expect(resolveTimeZone('', null)).toBe('UTC');
  });

  it('shifts and counts days across month and year ends', () => {
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7);
    expect(dayKeysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(weekdayOfKey('2026-10-27')).toBe(2); // Tuesday
  });
});
