/**
 * Runs the day-level statistics for one member and keeps their findings up to date.
 *
 * Each finding keeps its own tier history so it only appears after two different days of support
 * and only disappears after two different days without it (see tiering.ts). The Insights screen
 * and the "For you today" notifier still read the older InsightResult shape, so findings the member
 * is allowed to see are copied there until those screens move to the new data (Phase 2).
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { InsightFinding, IInsightFindingDoc } from '../../models/InsightFinding';
import { InsightRun } from '../../models/InsightRun';
import { InsightResult } from '../../models/InsightResult';
import { trackingDayKey } from '../../utils/dayKey';
import { DayRow } from './dayTable';
import { analyseDays, TestResult, Tier } from './dayLevelTests';
import { DEFAULT_CONFIG, ENGINE_VERSION, InsightConfig } from './insightConfig';
import { advance, startState, TierState, TIER_RANK } from './tiering';

const findingKey = (k: { exposureKey: string; outcomeKey: string; lagDays: number }) =>
  `${k.exposureKey}|${k.outcomeKey}|${k.lagDays}`;

export interface BuiltDays { rows: DayRow[]; timeZone: string; boundaryHour: number }

export interface EngineOutcome {
  skipped: boolean;
  eligibleTests: number;
  shown: { possible: number; consistent: number };
}

interface NextFinding {
  result: TestResult | null;
  state: TierState;
  noLongerSeen: boolean;
  lastShownDay?: string;
  existing?: IInsightFindingDoc;
}

export function hashDays(rows: DayRow[]): string {
  return crypto.createHash('sha1').update(JSON.stringify({ v: ENGINE_VERSION, rows })).digest('hex');
}

export async function runInsightEngine(
  userId: string,
  built: BuiltDays,
  now: Date = new Date(),
  config: InsightConfig = DEFAULT_CONFIG,
): Promise<EngineOutcome> {
  const uid = new mongoose.Types.ObjectId(userId);
  const day = trackingDayKey(now, built.timeZone, built.boundaryHour);
  const dataHash = hashDays(built.rows);

  // Same data, same day, same engine: nothing new to say
  const last = await InsightRun.findOne({ userId: uid }).sort({ ranAt: -1 }).lean();
  if (last && last.dataHash === dataHash && last.dayKey === day && last.engineVersion === ENGINE_VERSION) {
    const keep = await InsightFinding.countDocuments({ userId: uid, shownTier: { $ne: 'still_learning' } });
    return { skipped: true, eligibleTests: last.eligibleTests, shown: { possible: keep, consistent: 0 } };
  }

  const { results, eligibleTests } = analyseDays(built.rows, config);
  const existing = await InsightFinding.find({ userId: uid });
  const byKey = new Map(existing.map(f => [findingKey(f), f]));

  const next = new Map<string, NextFinding>();
  for (const r of results) {
    const key = findingKey(r);
    const doc = byKey.get(key);
    // A brand-new finding that is still just learning is not worth storing
    if (!doc && r.tier === 'still_learning') continue;
    const state = doc
      ? advance({ shown: doc.shownTier, previous: doc.previousTier, latest: doc.latestTier, latestDay: doc.latestDay }, day, r.tier)
      : startState(day, r.tier);
    next.set(key, resolve(r, state, doc, day));
  }
  // Findings whose comparison no longer qualifies (data changed): they lose a day of support
  for (const [key, doc] of byKey) {
    if (next.has(key)) continue;
    const state = advance({ shown: doc.shownTier, previous: doc.previousTier, latest: doc.latestTier, latestDay: doc.latestDay }, day, 'still_learning');
    next.set(key, resolve(null, state, doc, day));
  }

  const run = await InsightRun.create({
    userId: uid, ranAt: now, dayKey: day, engineVersion: ENGINE_VERSION, dataHash,
    daysObserved: built.rows.filter(r => r.symptomObserved).length,
    eligibleTests,
    candidates: {
      possible: results.filter(r => r.tier === 'possible').length,
      consistent: results.filter(r => r.tier === 'consistent').length,
    },
    config,
  });

  if (next.size > 0) {
    await InsightFinding.bulkWrite(Array.from(next.values()).map(n => {
      const base = n.result ?? n.existing!;
      return {
        updateOne: {
          filter: { userId: uid, exposureKey: base.exposureKey, outcomeKey: base.outcomeKey, lagDays: base.lagDays },
          update: { $set: toDocument(n, eligibleTests, run._id as mongoose.Types.ObjectId) },
          upsert: true,
        },
      };
    }));
  }

  const shown = Array.from(next.values()).filter(n => TIER_RANK[n.state.shown] > 0);
  await copyToLegacyResults(uid, shown, now);

  return {
    skipped: false,
    eligibleTests,
    shown: {
      possible: shown.filter(n => n.state.shown === 'possible').length,
      consistent: shown.filter(n => n.state.shown === 'consistent').length,
    },
  };
}

function resolve(result: TestResult | null, state: TierState, existing: IInsightFindingDoc | undefined, day: string): NextFinding {
  const shownNow = TIER_RANK[state.shown] > 0;
  const hadBeenShown = shownNow || !!existing?.lastShownDay;
  return {
    result,
    state,
    existing,
    lastShownDay: shownNow ? day : existing?.lastShownDay,
    noLongerSeen: !shownNow && hadBeenShown,
  };
}

function toDocument(n: NextFinding, testCount: number, runId: mongoose.Types.ObjectId) {
  const fields = n.result
    ? {
        exposureLabel: n.result.exposureLabel, outcomeLabel: n.result.outcomeLabel,
        a: n.result.a, b: n.result.b, c: n.result.c, d: n.result.d, pairs: n.result.pairs,
        riskDifference: n.result.riskDifference, shrunkRR: n.result.shrunkRR, pHigher: n.result.pHigher,
        fisherP: n.result.fisherP, q: n.result.q, adjustedRD: n.result.adjustedRD,
        circularP: n.result.circularP, halvesAgree: n.result.halvesAgree, weakShare: n.result.weakShare,
        testCount,
      }
    : {}; // keep the last numbers for a finding that no longer qualifies
  return {
    ...fields,
    latestTier: n.state.latest as Tier,
    previousTier: n.state.previous,
    latestDay: n.state.latestDay,
    shownTier: n.state.shown,
    noLongerSeen: n.noLongerSeen,
    ...(n.lastShownDay ? { lastShownDay: n.lastShownDay } : {}),
    engineVersion: ENGINE_VERSION,
    runId,
  };
}

/** The Insights screen and notifier still read InsightResult; give them only findings that may be shown. */
async function copyToLegacyResults(uid: mongoose.Types.ObjectId, shown: NextFinding[], now: Date): Promise<void> {
  await InsightResult.deleteMany({ userId: uid });
  const docs = shown.flatMap(n => {
    const src = n.result ?? n.existing;
    if (!src) return [];
    const { a, b, c, d } = src;
    return [{
      userId: uid,
      triggerId: src.exposureKey,
      triggerLabel: src.exposureLabel,
      symptomId: src.outcomeKey,
      symptomLabel: src.outcomeLabel,
      lagWindowHours: [src.lagDays * 24, (src.lagDays + 1) * 24],
      lift: Math.round(src.shrunkRR * 100) / 100,
      baselineRate: c + d > 0 ? Math.round((c / (c + d)) * 10000) / 10000 : 0,
      triggerRate: a + b > 0 ? Math.round((a / (a + b)) * 10000) / 10000 : 0,
      occurrences: a,
      confidence: n.state.shown === 'consistent' ? 'high' as const : 'medium' as const,
      computedAt: now,
    }];
  });
  if (docs.length > 0) await InsightResult.insertMany(docs);
}
