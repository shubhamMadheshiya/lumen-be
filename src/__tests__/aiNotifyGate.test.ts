import { gate, isQuietAt, isSlotDue, localDateKey, localMinutes, startOfLocalDay, type GatePolicy } from '../services/aiNotify/gate';
import { fit, parseNotification, promptFor } from '../services/aiNotify/compose';
import { dueKinds, describeEntry, maxSeverity } from '../services/aiNotify/run';

const TZ = 'Asia/Kolkata';
/** 2026-11-16 at hh:mm in India. */
const ist = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00+05:30`);

const policy = (over: Partial<GatePolicy> = {}): GatePolicy => ({
  masterEnabled: true,
  dailyBudget: 2,
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
  flareModeActive: false,
  capabilities: { aiBriefing: true, aiNudge: true, aiCheckIn: true, aiLogReply: true },
  mutedUntil: null,
  ...over,
});

describe('local time helpers', () => {
  it('reads the member\'s own clock', () => {
    expect(localMinutes(ist('08:15'), TZ)).toBe(8 * 60 + 15);
    expect(localDateKey(ist('00:30'), TZ)).toBe('2026-11-16');
    expect(startOfLocalDay(ist('13:45'), TZ).toISOString()).toBe(new Date('2026-11-16T00:00:00+05:30').toISOString());
  });

  it('quiet hours wrap past midnight', () => {
    const q = { enabled: true, start: '22:00', end: '07:00' };
    expect(isQuietAt(23 * 60, q)).toBe(true);
    expect(isQuietAt(6 * 60 + 59, q)).toBe(true);
    expect(isQuietAt(7 * 60, q)).toBe(false);
    expect(isQuietAt(23 * 60, { ...q, enabled: false })).toBe(false);
  });

  it('a slot is due only in its own 15 minutes', () => {
    expect(isSlotDue('08:00', ist('08:00'), TZ)).toBe(true);
    expect(isSlotDue('08:00', ist('08:14'), TZ)).toBe(true);
    expect(isSlotDue('08:00', ist('08:15'), TZ)).toBe(false);
    expect(isSlotDue('08:00', ist('07:59'), TZ)).toBe(false);
  });
});

describe('gate', () => {
  const ctx = (hhmm: string, sentToday = 0) => ({ now: ist(hhmm), timeZone: TZ, sentToday });

  it('pushes inside the budget outside quiet hours', () => {
    expect(gate('nudge', policy(), ctx('13:30'))).toEqual({ push: true });
  });

  it('keeps the shared daily budget, but still writes the note for the app', () => {
    expect(gate('nudge', policy(), ctx('13:30', 2))).toEqual({ push: false, reason: 'budget', compose: true });
  });

  it('quiet hours: briefing goes in-app, nudge and check-in are not written at all', () => {
    expect(gate('briefing', policy(), ctx('06:30'))).toEqual({ push: false, reason: 'quiet_hours', compose: true });
    expect(gate('check_in', policy(), ctx('23:00'))).toEqual({ push: false, reason: 'quiet_hours', compose: false });
  });

  it('flare mode and mute hold back everything except the reply to a serious log', () => {
    expect(gate('nudge', policy({ flareModeActive: true }), ctx('13:30'))).toMatchObject({ push: false, reason: 'flare_mode' });
    expect(gate('briefing', policy({ mutedUntil: ist('18:00') }), ctx('08:00'))).toMatchObject({ push: false, reason: 'muted', compose: true });
    expect(gate('log_reply', policy({ flareModeActive: true }), ctx('23:30', 9))).toEqual({ push: true });
  });

  it('the master switch and each kind\'s toggle stop it entirely, log replies included', () => {
    expect(gate('log_reply', policy({ masterEnabled: false }), ctx('13:00'))).toEqual({ push: false, reason: 'master_off', compose: false });
    expect(gate('log_reply', policy({ capabilities: { aiLogReply: false } }), ctx('13:00'))).toEqual({ push: false, reason: 'capability_off', compose: false });
    expect(gate('briefing', policy({ capabilities: { aiBriefing: false } }), ctx('08:00'))).toMatchObject({ push: false, reason: 'capability_off' });
  });
});

describe('dueKinds', () => {
  const p = { aiTimes: { briefing: '08:00', nudge: '13:30', checkIn: '20:30' }, capabilities: { aiBriefing: true, aiNudge: true, aiCheckIn: false } } as never;
  it('picks the slots due now, skipping turned-off kinds', () => {
    expect(dueKinds(p, ist('08:05'), TZ)).toEqual(['briefing']);
    expect(dueKinds(p, ist('13:30'), TZ)).toEqual(['nudge']);
    expect(dueKinds(p, ist('20:30'), TZ)).toEqual([]);
    expect(dueKinds(p, ist('10:00'), TZ)).toEqual([]);
  });
});

describe('parseNotification', () => {
  it('reads the agreed format and strips markdown and quotes', () => {
    expect(parseNotification('TITLE: **Good morning, Shubham**\nBODY: "You slept 5 h. Keep today light."\nOPEN: chat'))
      .toEqual({ title: 'Good morning, Shubham', body: 'You slept 5 h. Keep today light.', open: 'chat' });
  });

  it('understands SKIP, a log route and a missing OPEN', () => {
    expect(parseNotification('SKIP')).toBe('skip');
    expect(parseNotification('skip — nothing today')).toBe('skip');
    expect(parseNotification('TITLE: Aaj kaisa raha?\nBODY: Subah ka sir dard ab kaisa hai?\nOPEN: log')).toMatchObject({ open: 'log' });
    expect(parseNotification('TITLE: Hi\nBODY: There.')).toMatchObject({ open: 'chat' });
  });

  it('rejects anything that is not the format', () => {
    expect(parseNotification('Here is your briefing: you slept well.')).toBeNull();
    expect(parseNotification('TITLE: Only a title')).toBeNull();
  });

  it('keeps title and body short, cutting at a sentence or word', () => {
    const long = 'You slept about five hours last night. '.repeat(10);
    const parsed = parseNotification(`TITLE: ${'Very long title '.repeat(10)}\nBODY: ${long}`);
    expect(parsed && parsed !== 'skip' && parsed.title.length).toBeLessThanOrEqual(60);
    expect(parsed && parsed !== 'skip' && parsed.body.length).toBeLessThanOrEqual(180);
    expect(fit('One sentence here. Two three four five six.', 25)).toBe('One sentence here.');
    expect(fit('alpha beta gamma delta', 12)).toBe('alpha beta…');
  });
});

describe('prompts', () => {
  it('each kind asks for its own thing, all with the wording rules and format', () => {
    const ctx = { today: '2026-11-16', time: '08:00' };
    for (const kind of ['briefing', 'nudge', 'check_in'] as const) {
      const p = promptFor(kind, ctx);
      expect(p).toContain('never tell them to stop or change a prescribed medicine');
      expect(p).toContain('TITLE:');
    }
    expect(promptFor('briefing', ctx)).toContain('MORNING BRIEFING');
    expect(promptFor('nudge', ctx)).toContain('SKIP');
    expect(promptFor('check_in', ctx)).toContain('OPEN: log');
    const reply = promptFor('log_reply', { ...ctx, logged: { when: 'now', summary: 'Temperature: 38.9 C', flags: [{ level: 'today', title: 'Fever', message: 'Call your doctor today.' }] } });
    expect(reply).toContain('Temperature: 38.9 C');
    expect(reply).toContain('Fever: Call your doctor today.');
    expect(reply).toContain('do not reply SKIP');
    expect(promptFor('briefing', ctx)).toContain('do not reply SKIP');
  });
});

describe('serious log detection', () => {
  const entry = (values: { dataType: string; value?: unknown; unit?: string; canonicalValue?: number }[], label = 'Joint pain') =>
    ({ _id: 'e1', occurredAt: new Date(), answers: [{ optionLabelSnapshot: label, values }] });

  it('finds the highest 0-10 severity', () => {
    expect(maxSeverity(entry([{ dataType: 'range', value: 8 }]))).toBe(8);
    expect(maxSeverity(entry([{ dataType: 'range', canonicalValue: 3 }, { dataType: 'range', value: 9 }]))).toBe(9);
    expect(maxSeverity(entry([{ dataType: 'temperature', value: 39 }]))).toBe(0);
  });

  it('describes what was logged for the prompt', () => {
    expect(describeEntry(entry([{ dataType: 'temperature', value: 38.9, unit: 'C' }], 'Fever'))).toBe('Fever: 38.9 C');
  });
});
