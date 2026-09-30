/**
 * Lag-aware pattern analytics engine.
 *
 * For each (trigger, symptom) pair, we compare how often or how severely
 * the symptom occurs within lag windows AFTER the trigger, versus the user's
 * baseline (periods without the trigger).
 *
 * IMPORTANT: This is descriptive only. We never use causal language.
 *
 * Lag windows: 0–6h, 6–24h, 24–48h, 48–72h (autoimmune reactions can be delayed).
 */

import mongoose from 'mongoose';
import { LogEntry } from '../models/LogEntry';
import { Category } from '../models/Category';
import { QuickAction } from '../models/QuickAction';
import { InsightResult } from '../models/InsightResult';

const LAG_WINDOWS: Array<[number, number]> = [
  [0, 6],
  [6, 24],
  [24, 48],
  [48, 72],
];

const MIN_OCCURRENCES = 5; // minimum trigger+symptom co-occurrences to show
const MIN_DAYS = 14;        // minimum days of data

function hoursAgo(ms: number): number {
  return ms / (1000 * 60 * 60);
}

function confidenceLevel(occurrences: number): 'low' | 'medium' | 'high' {
  if (occurrences < 8)  return 'low';
  if (occurrences < 20) return 'medium';
  return 'high';
}

export async function computeInsights(userId: string): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);

  // ── Get all non-deleted entries for this user ─────────────────────────────
  const entries = await LogEntry.find({ userId: uid, deletedAt: { $exists: false } })
    .sort({ occurredAt: 1 })
    .lean();

  if (entries.length === 0) return;

  const firstDate = entries[0].occurredAt;
  const lastDate  = entries[entries.length - 1].occurredAt;
  const daysCovered = hoursAgo(lastDate.getTime() - firstDate.getTime()) / 24;

  if (daysCovered < MIN_DAYS) return;

  // ── Separate trigger and symptom entries ─────────────────────────────────
  const categories = await Category.find({ userId: uid }).lean();
  const quickActions = await QuickAction.find({ userId: uid }).lean();

  const triggerCatIds = new Set(
    categories.filter(c => c.role === 'trigger_candidate').map(c => c._id.toString()),
  );
  const symptomCatIds = new Set(
    categories.filter(c => c.role === 'symptom').map(c => c._id.toString()),
  );

  const triggerEntries = entries.filter(e =>
    (e.categoryId && triggerCatIds.has(e.categoryId.toString())) ||
    e.quickActionId,
  );

  const symptomEntries = entries.filter(e =>
    e.categoryId && symptomCatIds.has(e.categoryId.toString()),
  );

  if (triggerEntries.length === 0 || symptomEntries.length === 0) return;

  // ── Build trigger → symptom occurrence map ────────────────────────────────

  interface TriggerKey { id: string; label: string }
  interface SymptomKey { id: string; label: string }

  // Unique triggers
  const triggers = new Map<string, TriggerKey>();
  for (const e of triggerEntries) {
    if (e.quickActionId) {
      const qa = quickActions.find(q => q._id.toString() === e.quickActionId?.toString());
      if (qa) triggers.set(`qa_${qa._id}`, { id: `qa_${qa._id}`, label: qa.label });
    }
    if (e.categoryId) {
      const cat = categories.find(c => c._id.toString() === e.categoryId?.toString());
      if (cat) triggers.set(`cat_${cat._id}`, { id: `cat_${cat._id}`, label: cat.name });
    }
    // Fine-grained: per option
    for (const ans of e.answers) {
      triggers.set(`opt_${ans.optionId}`, { id: `opt_${ans.optionId}`, label: ans.optionLabelSnapshot });
    }
  }

  // Unique symptoms (per category and per option)
  const symptoms = new Map<string, SymptomKey>();
  for (const e of symptomEntries) {
    if (e.categoryId) {
      const cat = categories.find(c => c._id.toString() === e.categoryId?.toString());
      if (cat) symptoms.set(`cat_${cat._id}`, { id: `cat_${cat._id}`, label: cat.name });
    }
    for (const ans of e.answers) {
      symptoms.set(`opt_${ans.optionId}`, { id: `opt_${ans.optionId}`, label: ans.optionLabelSnapshot });
    }
  }

  // ── For each (trigger, symptom, lagWindow) compute co-occurrence ──────────

  const newInsights: Array<Omit<IInsightResultDoc, '_id'>> = [];

  for (const [, trigger] of triggers) {
    // Dates when this trigger was observed
    const triggerDates = triggerEntries
      .filter(e => {
        if (e.quickActionId && trigger.id === `qa_${e.quickActionId}`) return true;
        if (e.categoryId   && trigger.id === `cat_${e.categoryId}`)   return true;
        return e.answers.some(a => `opt_${a.optionId}` === trigger.id);
      })
      .map(e => e.occurredAt);

    if (triggerDates.length < 3) continue;

    for (const [, symptom] of symptoms) {
      for (const [lagMin, lagMax] of LAG_WINDOWS) {
        const lagMinMs = lagMin * 60 * 60 * 1000;
        const lagMaxMs = lagMax * 60 * 60 * 1000;

        // For each trigger event, was there a symptom in the lag window?
        let coOccurrences = 0;
        for (const td of triggerDates) {
          const windowStart = new Date(td.getTime() + lagMinMs);
          const windowEnd   = new Date(td.getTime() + lagMaxMs);

          const found = symptomEntries.some(e => {
            const inWindow = e.occurredAt >= windowStart && e.occurredAt <= windowEnd;
            if (!inWindow) return false;
            if (symptom.id.startsWith('cat_') && e.categoryId) {
              return `cat_${e.categoryId}` === symptom.id;
            }
            return e.answers.some(a => `opt_${a.optionId}` === symptom.id);
          });

          if (found) coOccurrences++;
        }

        if (coOccurrences < MIN_OCCURRENCES) continue;

        // Baseline: how often does the symptom appear in random lag-window-sized blocks?
        const windowDurationMs = lagMaxMs - lagMinMs;
        const totalWindowsInData = Math.floor(
          (lastDate.getTime() - firstDate.getTime()) / windowDurationMs,
        );

        const baselineCount = symptomEntries.filter(e =>
          symptom.id.startsWith('cat_')
            ? e.categoryId && `cat_${e.categoryId}` === symptom.id
            : e.answers.some(a => `opt_${a.optionId}` === symptom.id),
        ).length;

        const baselineRate = totalWindowsInData > 0 ? baselineCount / totalWindowsInData : 0;
        const triggerRate  = coOccurrences / triggerDates.length;
        const lift = baselineRate > 0 ? triggerRate / baselineRate : triggerRate;

        // Only report if there is a positive association
        if (lift < 1.2) continue;

        newInsights.push({
          userId: uid,
          triggerId: trigger.id,
          triggerLabel: trigger.label,
          symptomId: symptom.id,
          symptomLabel: symptom.label,
          lagWindowHours: [lagMin, lagMax],
          lift: parseFloat(lift.toFixed(2)),
          baselineRate: parseFloat(baselineRate.toFixed(4)),
          triggerRate: parseFloat(triggerRate.toFixed(4)),
          occurrences: coOccurrences,
          confidence: confidenceLevel(coOccurrences),
          computedAt: new Date(),
        } as Omit<IInsightResultDoc, '_id'>);
      }
    }
  }

  if (newInsights.length === 0) return;

  // Replace previous cached results for this user
  await InsightResult.deleteMany({ userId: uid });
  await InsightResult.insertMany(newInsights);

  console.log(`[insights] ${newInsights.length} insights computed for user ${userId}`);
}

// Required interface for the type cast above
interface IInsightResultDoc {
  _id: unknown;
  userId: mongoose.Types.ObjectId;
  triggerId: string;
  triggerLabel: string;
  symptomId: string;
  symptomLabel: string;
  lagWindowHours: [number, number];
  lift: number;
  baselineRate: number;
  triggerRate: number;
  occurrences: number;
  confidence: 'low' | 'medium' | 'high';
  computedAt: Date;
}
