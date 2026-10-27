import { evaluateRedFlags, mergeFlags, RED_FLAG_CONFIG, FlagEntry } from '../services/safety/redFlags';

const NOW = new Date('2026-10-27T10:00:00Z');
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60000).toISOString();

const entry = (label: string, over: Partial<FlagEntry> & { values?: unknown[] } = {}): FlagEntry => ({
  occurredAt: at(5),
  answers: [{ optionLabelSnapshot: label, values: (over.values as never) ?? [] }],
  ...(over.occurredAt ? { occurredAt: over.occurredAt } : {}),
});

const ids = (flags: { id: string }[]) => flags.map(f => f.id);

describe('fever', () => {
  const temp = (value: number, extra: object = {}) => entry('Temperature', { values: [{ dataType: 'temperature', value, ...extra }] });

  it('flags a temperature at or above the threshold, in Celsius', () => {
    const [f] = evaluateRedFlags(temp(38.5, { canonicalValue: 38.5 }), [], NOW);
    expect(f).toMatchObject({ id: 'fever', level: 'today' });
    expect(f.message).toContain('38.5 °C');
    expect(f.message).toContain("don't stop or change any medicine");
  });

  it('does not flag a normal temperature', () => {
    expect(evaluateRedFlags(temp(37.2, { canonicalValue: 37.2 }), [], NOW)).toEqual([]);
    expect(evaluateRedFlags(temp(38.2, { canonicalValue: 38.2 }), [], NOW)).toEqual([]);
  });

  it('converts Fahrenheit when no canonical value was stored', () => {
    expect(ids(evaluateRedFlags(temp(101.5, { unit: '°F' }), [], NOW))).toEqual(['fever']); // 38.6 C
    expect(evaluateRedFlags(temp(99.1, { unit: '°F' }), [], NOW)).toEqual([]); // 37.3 C
  });

  it('falls back to the typed value when the canonical value is null', () => {
    expect(ids(evaluateRedFlags(temp(39.1, { canonicalValue: null }), [], NOW))).toEqual(['fever']);
  });

  it('ignores impossible readings', () => {
    expect(evaluateRedFlags(temp(98.6, { canonicalValue: 98.6 }), [], NOW)).toEqual([]);
  });

  it('honours a threshold the owner changed', () => {
    const strict = { ...RED_FLAG_CONFIG, feverCelsius: 38.0 };
    expect(ids(evaluateRedFlags(temp(38.1, { canonicalValue: 38.1 }), [], NOW, strict))).toEqual(['fever']);
  });
});

describe('bleeding, belly pain, chest pain and vision', () => {
  it('flags blood in the stool for today, and heavy bleeding for now', () => {
    expect(evaluateRedFlags(entry('Blood in stool'), [], NOW)[0]).toMatchObject({ id: 'bleeding', level: 'today' });
    expect(evaluateRedFlags(entry('Heavy rectal bleeding'), [], NOW)[0]).toMatchObject({ id: 'bleeding', level: 'now' });
    expect(evaluateRedFlags(entry('Blood in stool', { values: [{ dataType: 'range', value: 9 }] }), [], NOW)[0].level).toBe('now');
  });

  it('flags severe belly pain only when it is scored high', () => {
    const pain = (n: number) => entry('Abdominal pain', { values: [{ dataType: 'range', value: n }] });
    expect(ids(evaluateRedFlags(pain(8), [], NOW))).toEqual(['severe_abdominal_pain']);
    expect(evaluateRedFlags(pain(5), [], NOW)).toEqual([]);
  });

  it('treats chest pain with breathlessness as needing care now, in either order', () => {
    const both: FlagEntry = { occurredAt: at(5), answers: [{ optionLabelSnapshot: 'Chest pain' }, { optionLabelSnapshot: 'Shortness of breath' }] };
    expect(evaluateRedFlags(both, [], NOW)[0]).toMatchObject({ id: 'chest_breathless', level: 'now' });

    const earlier = entry('Chest pain', { occurredAt: at(90) });
    expect(evaluateRedFlags(entry('Breathless'), [earlier], NOW)[0]).toMatchObject({ id: 'chest_breathless', level: 'now' });
    expect(evaluateRedFlags(entry('Chest pain'), [entry('Breathless', { occurredAt: at(60) })], NOW)[0].id).toBe('chest_breathless');
  });

  it('does not join breathlessness from many hours earlier', () => {
    const old = entry('Chest pain', { occurredAt: at(8 * 60) });
    expect(evaluateRedFlags(entry('Breathless'), [old], NOW)).toEqual([]);
  });

  it('flags chest pain alone for today', () => {
    expect(evaluateRedFlags(entry('Chest tightness'), [], NOW)[0]).toMatchObject({ id: 'chest_pain', level: 'today' });
  });

  it('flags sudden loss of sight for now, but not blurred vision', () => {
    expect(evaluateRedFlags(entry('Sudden loss of vision'), [], NOW)[0]).toMatchObject({ id: 'vision_loss', level: 'now' });
    expect(evaluateRedFlags(entry('Blurred vision'), [], NOW)).toEqual([]);
  });
});

describe('what is left alone', () => {
  it('says nothing for ordinary entries', () => {
    expect(evaluateRedFlags(entry('Fatigue'), [], NOW)).toEqual([]);
    expect(evaluateRedFlags(entry('Joint pain', { values: [{ dataType: 'range', value: 9 }] }), [], NOW)).toEqual([]);
  });

  it('does not flag history that was logged long after it happened', () => {
    expect(evaluateRedFlags(entry('Blood in stool', { occurredAt: at(3 * 24 * 60) }), [], NOW)).toEqual([]);
  });

  it('survives entries with no answers or a bad date', () => {
    expect(evaluateRedFlags({ occurredAt: at(1) }, [], NOW)).toEqual([]);
    expect(evaluateRedFlags({ occurredAt: 'not a date', answers: [{ optionLabelSnapshot: 'Blood in stool' }] }, [], NOW)).toEqual([]);
  });
});

describe('wording and merging', () => {
  const all = [
    ...evaluateRedFlags(entry('Blood in stool'), [], NOW),
    ...evaluateRedFlags(entry('Heavy rectal bleeding'), [], NOW),
    ...evaluateRedFlags(entry('Chest pain'), [], NOW),
    ...evaluateRedFlags(entry('Sudden loss of vision'), [], NOW),
    ...evaluateRedFlags(entry('Temperature', { values: [{ dataType: 'temperature', canonicalValue: 39 }] }), [], NOW),
  ];

  it('never tells anyone to start, stop or change a medicine, or names a diagnosis', () => {
    const text = all.map(f => `${f.title} ${f.message}`).join(' ').toLowerCase();
    for (const bad of ['you should take', 'increase your', 'reduce your', 'stop taking', 'you have lupus', 'diagnos', 'caused by']) {
      expect(text).not.toContain(bad);
    }
    // the only thing it says about medicines is not to change them on your own
    expect(text).toContain("don't stop or change any medicine");
  });

  it('urgent flags give an emergency route', () => {
    for (const f of all.filter(x => x.level === 'now')) expect(f.message).toContain('112');
  });

  it('keeps the most urgent copy of the same flag', () => {
    const merged = mergeFlags([
      ...evaluateRedFlags(entry('Blood in stool'), [], NOW),
      ...evaluateRedFlags(entry('Heavy rectal bleeding'), [], NOW),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].level).toBe('now');
  });

  it('puts urgent flags first', () => {
    const merged = mergeFlags(all);
    expect(merged[0].level).toBe('now');
    expect(merged[merged.length - 1].level).toBe('today');
  });
});
