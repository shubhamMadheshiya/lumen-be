/**
 * Runs an Explore question for a member: validates it, folds in fresh changes, reads the range,
 * and caches the answer for 10 minutes (keyed by the question and the last build time, so a
 * new log always gives a new answer). A question can travel as a short token (chat attachment).
 */
import mongoose from 'mongoose';
import { z } from 'zod';
import { ensureFresh } from './freshness';
import { readRows } from './metricsService';
import { loadLabels } from './labels';
import { explore, ExploreResult, ExploreSpec, findingDays, FindingDays, LagKey } from './explore';
import { shiftDayKey } from '../../utils/dayKey';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ITEM_KEY = z.string().regex(/^(opt|cat|qa|feel)_[A-Za-z0-9_:.-]{1,60}$/);

export const ExploreTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), key: ITEM_KEY, minSev: z.number().min(0).max(10).optional() }),
  z.object({ kind: z.literal('flare') }),
  z.object({ kind: z.literal('dose'), medicationId: z.string().regex(/^[0-9a-f]{24}$/), status: z.enum(['skipped', 'taken']) }),
  z.object({ kind: z.literal('metric'), id: z.string().min(1).max(80), op: z.enum(['lt', 'gt']), value: z.number().finite() }),
  z.object({ kind: z.literal('rise'), key: z.union([ITEM_KEY, z.literal('symptom_max')]) }),
  z.object({ kind: z.literal('period'), from: DAY, to: DAY }),
]).refine(t => t.kind !== 'period' || t.from <= t.to, 'from must be before to');

export const ExploreSpecSchema = z.object({
  target: ExploreTargetSchema,
  direction: z.enum(['before', 'after']).default('before'),
  range: z.enum(['90d', '180d', '365d', 'all']).default('365d'),
});
export type ExploreQuestion = z.infer<typeof ExploreSpecSchema>;

export const MAX_TOKEN_LENGTH = 300;

export function encodeSpecToken(q: ExploreQuestion): string {
  return Buffer.from(JSON.stringify(q), 'utf8').toString('base64url');
}

export function decodeSpecToken(token: string) {
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    return ExploreSpecSchema.safeParse(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

const cache = new Map<string, { at: number; result: ExploreResult & { range: { from: string; to: string } } }>();
const TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 60;

export async function runExplore(userId: string, q: ExploreQuestion): Promise<ExploreResult & { range: { from: string; to: string } }> {
  const fresh = await ensureFresh(userId);
  const key = `${userId}|${encodeSpecToken(q)}|${fresh.builtAt.getTime()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;

  const uid = new mongoose.Types.ObjectId(userId);
  const to = fresh.today;
  const days = q.range === 'all' ? 3 * 365 : parseInt(q.range, 10);
  let from = shiftDayKey(to, -(days - 1));
  if (fresh.firstDay && from < fresh.firstDay) from = fresh.firstDay;
  // A period question needs the same number of days before it, too.
  if (q.target.kind === 'period') {
    const len = Math.round((Date.parse(q.target.to) - Date.parse(q.target.from)) / 86400000) + 1;
    const need = shiftDayKey(q.target.from, -len);
    if (need < from) from = need;
  }
  const rows = fresh.firstDay ? await readRows(uid, from, to) : [];
  const labels = await loadLabels(uid, rows);
  const spec: ExploreSpec = { target: q.target, direction: q.direction };
  const result = { ...explore(rows, spec, labels), range: { from, to } };

  if (cache.size >= MAX_CACHE) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}

/** Both day rows behind one Explore finding (for its detail screen). */
export async function runFindingDays(userId: string, q: ExploreQuestion, key: string, lag: LagKey): Promise<FindingDays | null> {
  const fresh = await ensureFresh(userId);
  const uid = new mongoose.Types.ObjectId(userId);
  const to = fresh.today;
  const days = q.range === 'all' ? 3 * 365 : parseInt(q.range, 10);
  let from = shiftDayKey(to, -(days - 1));
  if (fresh.firstDay && from < fresh.firstDay) from = fresh.firstDay;
  const rows = fresh.firstDay ? await readRows(uid, from, to) : [];
  const labels = await loadLabels(uid, rows);
  return findingDays(rows, { target: q.target, direction: q.direction }, key, lag, labels);
}
