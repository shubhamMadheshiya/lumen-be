/**
 * "Contact your doctor" rules, checked whenever something is logged.
 *
 * These are deliberately plain code with fixed wording: no model writes this text, it is never
 * attached to a pattern card, and it is not limited by the notification budget. It does not
 * diagnose. It only says that what was logged is the kind of thing worth getting checked, and
 * never tells anyone to start, stop or change a medicine.
 *
 * The numbers and word lists below are starting points taken from published patient leaflets.
 * They are the owner's to adjust with their own doctor (see RED_FLAG_CONFIG), and the multiple
 * sclerosis and vision rules have not been signed off by a clinician.
 */

export type RedFlagLevel = 'today' | 'now';

export interface RedFlag {
  id: string;
  level: RedFlagLevel;
  title: string;
  message: string;
}

export interface FlagValue { dataType: string; value?: unknown; unit?: string | null; canonicalValue?: number | null }
export interface FlagAnswer { optionLabelSnapshot?: string | null; values?: FlagValue[] }
export interface FlagEntry { occurredAt: Date | string; answers?: FlagAnswer[] }

export const RED_FLAG_CONFIG = {
  /** A temperature at or above this (in °C) is flagged. Leaflets differ: 38.0 to 38.9 °C. */
  feverCelsius: 38.3,
  /** Pain scored at least this high (0-10) in the abdomen is flagged. */
  severeAbdominalPain: 8,
  /** Related things logged this close together count as one picture (chest pain and breathlessness). */
  relatedWindowMs: 6 * 3600000,
  /** Entries older than this when logged are history, not news, so they are not flagged. */
  freshWindowMs: 24 * 3600000,
};

const EMERGENCY = 'If this is happening now and you feel very unwell, call 112 (India) or your local emergency number, or go to the nearest emergency department.';
const MEDICINE_NOTE = "Please don't stop or change any medicine without asking them.";

const labelsOf = (e: FlagEntry) => (e.answers ?? []).map(a => a.optionLabelSnapshot ?? '').filter(Boolean);
const has = (labels: string[], re: RegExp) => labels.some(l => re.test(l));

const rangeValues = (e: FlagEntry) => (e.answers ?? []).flatMap(a => (a.values ?? []).filter(v => v.dataType === 'range'))
  .map(v => Number(v.canonicalValue ?? v.value)).filter(Number.isFinite);

/** Temperatures in this entry, in °C. */
function celsiusValues(e: FlagEntry): number[] {
  const out: number[] = [];
  for (const a of e.answers ?? []) {
    for (const v of a.values ?? []) {
      if (v.dataType !== 'temperature') continue;
      // Number(null) is 0, so a missing canonical value must be handled before converting
      let c = v.canonicalValue == null ? NaN : Number(v.canonicalValue);
      if (!Number.isFinite(c)) {
        const raw = Number(v.value);
        if (!Number.isFinite(raw)) continue;
        c = /f/i.test(v.unit ?? '') ? ((raw - 32) * 5) / 9 : raw;
      }
      if (c >= 30 && c <= 45) out.push(c);
    }
  }
  return out;
}

const FEVER_LABEL = /\b(fever|temperature)\b/i;
const BLEEDING = /(blood|bleed).*(stool|poo|rectal|bowel|toilet)|(stool|poo|rectal|bowel).*(blood|bleed)|black.*(stool|tarry)|melena/i;
const HEAVY = /\b(heavy|a lot|large amount)\b/i;
const CHEST = /chest (pain|tightness|pressure)/i;
const BREATHLESS = /breathless|short(ness)? of breath|difficulty breathing|can'?t breathe/i;
const ABDOMEN = /(abdominal|stomach|belly|tummy).*pain|pain.*(abdomen|stomach|belly)/i;
const VISION_LOSS = /(loss of|lost|sudden|losing).*(vision|sight)|can'?t see|\bblind/i;

function flagsFor(entry: FlagEntry, related: string[], config: typeof RED_FLAG_CONFIG): RedFlag[] {
  const labels = labelsOf(entry);
  const flags: RedFlag[] = [];

  const hot = celsiusValues(entry).filter(c => c >= config.feverCelsius);
  if (hot.length > 0) {
    const t = Math.max(...hot).toFixed(1);
    flags.push({
      id: 'fever',
      level: 'today',
      title: 'A fever is worth a call',
      message: `You logged a temperature of ${t} °C. A fever can matter, especially if you take medicines that lower your immune system. Please contact your doctor or clinic today. If you feel very unwell, get care now. ${MEDICINE_NOTE}`,
    });
  }

  if (has(labels, BLEEDING)) {
    const heavy = has(labels, HEAVY) || rangeValues(entry).some(v => v >= 8);
    flags.push({
      id: 'bleeding',
      level: heavy ? 'now' : 'today',
      title: heavy ? 'Heavy bleeding needs care now' : 'Blood in your stool is worth a call',
      message: heavy
        ? `You logged heavy bleeding. Please get medical care now. ${EMERGENCY}`
        : `You logged blood in your stool or from your bowel. Please contact your doctor or clinic today. ${MEDICINE_NOTE}`,
    });
  }

  const chestPain = has(labels, CHEST);
  if (chestPain && (has(labels, BREATHLESS) || has(related, BREATHLESS))) {
    flags.push({
      id: 'chest_breathless',
      level: 'now',
      title: 'Chest pain with breathlessness needs care now',
      message: `You logged chest pain together with breathlessness. Please get medical care now. ${EMERGENCY}`,
    });
  } else if (has(labels, BREATHLESS) && has(related, CHEST)) {
    flags.push({
      id: 'chest_breathless',
      level: 'now',
      title: 'Chest pain with breathlessness needs care now',
      message: `You logged breathlessness soon after chest pain. Please get medical care now. ${EMERGENCY}`,
    });
  } else if (chestPain) {
    flags.push({
      id: 'chest_pain',
      level: 'today',
      title: 'Chest pain is worth a call',
      message: `You logged chest pain. Please contact your doctor or clinic today. If it is severe or you are short of breath, get care now. ${EMERGENCY}`,
    });
  }

  if (has(labels, ABDOMEN) && rangeValues(entry).some(v => v >= config.severeAbdominalPain)) {
    flags.push({
      id: 'severe_abdominal_pain',
      level: 'today',
      title: 'Severe belly pain is worth a call',
      message: `You logged severe pain in your belly. Please contact your doctor or clinic today. If it is getting worse or you cannot keep fluids down, get care now. ${MEDICINE_NOTE}`,
    });
  }

  if (has(labels, VISION_LOSS)) {
    flags.push({
      id: 'vision_loss',
      level: 'now',
      title: 'Sudden loss of sight needs care now',
      message: `You logged losing some or all of your sight. Please get medical care now. ${EMERGENCY}`,
    });
  }

  return flags;
}

/**
 * @param entry what was just logged
 * @param recent entries logged shortly before it, so related things (chest pain, then breathlessness) are seen together
 */
export function evaluateRedFlags(
  entry: FlagEntry,
  recent: FlagEntry[] = [],
  now: Date = new Date(),
  config: typeof RED_FLAG_CONFIG = RED_FLAG_CONFIG,
): RedFlag[] {
  const at = new Date(entry.occurredAt).getTime();
  if (!Number.isFinite(at) || now.getTime() - at > config.freshWindowMs) return [];

  const related = recent
    .filter(r => Math.abs(new Date(r.occurredAt).getTime() - at) <= config.relatedWindowMs)
    .flatMap(labelsOf);
  return flagsFor(entry, related, config);
}

/** Merges flags from several entries, keeping the most urgent copy of each. */
export function mergeFlags(all: RedFlag[]): RedFlag[] {
  const rank: Record<RedFlagLevel, number> = { today: 1, now: 2 };
  const byId = new Map<string, RedFlag>();
  for (const f of all) {
    const prev = byId.get(f.id);
    if (!prev || rank[f.level] > rank[prev.level]) byId.set(f.id, f);
  }
  return Array.from(byId.values()).sort((a, b) => rank[b.level] - rank[a.level]);
}
