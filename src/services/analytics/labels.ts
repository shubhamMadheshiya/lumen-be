/**
 * Live names for item keys (opt_/cat_/qa_/feel_), medicines and metrics, so a renamed option
 * shows its new name everywhere. Falls back to the name stored with the day row.
 */
import mongoose from 'mongoose';
import { Option } from '../../models/Option';
import { Question } from '../../models/Question';
import { Category } from '../../models/Category';
import { QuickAction } from '../../models/QuickAction';
import { Medication } from '../../models/Medication';
import { DayMetricRow } from './dayMetrics';
import { MetricDef, resolveMetric } from './metricCatalog';
import type { LabelLookup } from './explore';

export interface ItemMeta {
  key: string;
  label: string;
  icon?: string;
  /** Category name for options (so two "Other" options can be told apart). */
  groupLabel?: string;
  kind: 'option' | 'category' | 'quick' | 'feeling';
  archived: boolean;
}

export interface Labels extends LabelLookup {
  itemMeta(key: string): ItemMeta;
  itemUnit(key: string): string | null;
  meds: Array<{ id: string; name: string; dose: string | null; prn: boolean; active: boolean }>;
  waterGoal: number | null;
}

export async function loadLabels(uid: mongoose.Types.ObjectId, rows: DayMetricRow[]): Promise<Labels> {
  const [opts, qs, cats, qas, meds] = await Promise.all([
    Option.find({ userId: uid }).select('label icon questionId isActive archivedAt').lean(),
    Question.find({ userId: uid }).select('categoryId').lean(),
    Category.find({ userId: uid }).select('name icon isActive archivedAt').lean(),
    QuickAction.find({ userId: uid }).select('label icon isVisible archivedAt dailyGoal metricRole templateKey').lean(),
    Medication.find({ userId: uid }).select('name dose prn active').sort({ name: 1 }).lean(),
  ]);
  const id = (v: unknown) => String(v);
  const qCat = new Map(qs.map(q => [id(q._id), id(q.categoryId)]));
  const catById = new Map(cats.map(c => [id(c._id), c]));
  const optById = new Map(opts.map(o => [id(o._id), o]));
  const qaById = new Map(qas.map(q => [id(q._id), q]));
  const medById = new Map(meds.map(m => [id(m._id), m]));

  const snapshot = new Map<string, string>();
  const units = new Map<string, string | null>();
  for (const r of rows) for (const it of r.items ?? []) {
    snapshot.set(it.key, it.label);
    if (it.qty !== null && !it.mixedUnits && !units.has(it.key)) units.set(it.key, it.unit);
  }

  const itemMeta = (key: string): ItemMeta => {
    const [prefix, ...rest] = key.split('_');
    const raw = rest.join('_');
    if (prefix === 'opt') {
      const o = optById.get(raw) as (typeof opts)[number] & { isActive?: boolean; archivedAt?: Date } | undefined;
      const cat = o ? catById.get(qCat.get(id(o.questionId)) ?? '') : undefined;
      return {
        key, label: o?.label ?? snapshot.get(key) ?? 'Removed item', icon: o?.icon ?? cat?.icon,
        groupLabel: cat?.name, kind: 'option', archived: !o || o.isActive === false || !!o.archivedAt,
      };
    }
    if (prefix === 'cat') {
      const c = catById.get(raw) as (typeof cats)[number] & { isActive?: boolean; archivedAt?: Date } | undefined;
      return { key, label: c ? `${c.name} (any)` : snapshot.get(key) ?? 'Removed category', icon: c?.icon, kind: 'category', archived: !c || c.isActive === false || !!c.archivedAt };
    }
    if (prefix === 'qa') {
      const q = qaById.get(raw) as (typeof qas)[number] & { archivedAt?: Date } | undefined;
      return { key, label: q?.label ?? snapshot.get(key) ?? 'Removed quick tap', icon: q?.icon, kind: 'quick', archived: !q || !!q.archivedAt };
    }
    if (prefix === 'feel') {
      const face = raw.charAt(0).toUpperCase() + raw.slice(1);
      return { key, label: `Feeling ${face.toLowerCase()}`, kind: 'feeling', archived: false };
    }
    return { key, label: snapshot.get(key) ?? key, kind: 'option', archived: true };
  };

  const water = qas.find(q => q.metricRole === 'water' || q.templateKey === 'qa_water');
  const labels: Labels = {
    item: key => {
      const m = itemMeta(key);
      return m.archived && !m.label.startsWith('Removed') ? `${m.label} (archived)` : m.label;
    },
    itemMeta,
    itemUnit: key => units.get(key) ?? null,
    med: mid => medById.get(mid)?.name ?? null,
    metric: (mid: string): MetricDef | null => resolveMetric(mid, labels),
    meds: meds.map(m => ({ id: id(m._id), name: m.name, dose: m.dose ?? null, prn: !!m.prn, active: m.active !== false })),
    waterGoal: typeof water?.dailyGoal === 'number' && water.dailyGoal > 0 ? water.dailyGoal : null,
  };
  return labels;
}
