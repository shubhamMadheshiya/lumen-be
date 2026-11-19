/**
 * Fills in `canonicalValue` (the value in its base unit: ml, s, g, °C, m …) for every numeric
 * field value that carries a known unit, so day totals can add 1 glass and 250 ml together.
 * Values whose unit is unknown are left alone; analytics treats them as "mixed units".
 */
import { toCanonicalValue } from '../../shared/units/builtIn';

/** Unit spellings the app has used that are not in the built-in table. */
const UNIT_ALIASES: Record<string, string> = {
  minutes: 'min', minute: 'min', mins: 'min', hours: 'h', hour: 'h', hrs: 'h', hr: 'h', seconds: 's', sec: 's',
  litre: 'L', liter: 'L', l: 'L', glasses: 'glass', cups: 'cup', C: '°C', F: '°F', celsius: '°C', fahrenheit: '°F',
};

export function normaliseUnit(unit: string | null | undefined): string | undefined {
  if (!unit) return undefined;
  return UNIT_ALIASES[unit] ?? UNIT_ALIASES[unit.toLowerCase()] ?? unit;
}

interface FieldValueLike { dataType?: string; value?: unknown; unit?: string | null; canonicalValue?: number | null }
interface AnswerLike { values?: FieldValueLike[] | null }

export function canonicalFor(v: FieldValueLike): number | undefined {
  const n = typeof v.value === 'number' ? v.value : typeof v.value === 'string' && v.value.trim() !== '' ? Number(v.value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  // Durations are stored in seconds by the duration picker even when no unit is attached.
  if (v.dataType === 'duration' && !v.unit) return n;
  const unit = normaliseUnit(v.unit);
  if (!unit) return undefined;
  const c = toCanonicalValue(n, unit);
  return c === undefined || !Number.isFinite(c) ? undefined : Math.round(c * 1000) / 1000;
}

/** Returns the same answers with `canonicalValue` set wherever it can be worked out. */
export function withCanonical<T extends AnswerLike>(answers: T[] | undefined | null): T[] {
  if (!Array.isArray(answers)) return [];
  return answers.map(a => {
    if (!Array.isArray(a.values) || a.values.length === 0) return a;
    return {
      ...a,
      values: a.values.map(v => {
        if (typeof v.canonicalValue === 'number' && Number.isFinite(v.canonicalValue)) return v;
        const c = canonicalFor(v);
        return c === undefined ? v : { ...v, canonicalValue: c };
      }),
    };
  });
}
