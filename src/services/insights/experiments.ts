/**
 * "Test it for 6 weeks": a guided self-experiment with six 7-day blocks, three "with" the exposure
 * and three "without", in a randomly shuffled order the member doesn't get to pick. Analysed with
 * an exact randomisation test, which needs no distribution assumptions: the only randomness is
 * which 3 of the 6 blocks were labelled "with", so the p-value is exactly how many of the 20
 * possible labellings would have looked at least this striking, out of 20.
 */
import { DayRow } from './dayTable';
import { dailyComposite } from './progress';
import { daysBetween, shiftDayKey } from '../../utils/dayKey';

export type Block = 'with' | 'without';

export const BLOCKS = 6;
export const BLOCKS_WITH = 3;
export const BLOCK_DAYS = 7;
export const DEFAULT_WASHOUT_DAYS = 2;
/** 1 / C(6,3): the smallest p-value this design can ever report. */
export const MIN_P_VALUE = 1 / 20;

/** A uniformly random arrangement of 3 "with" and 3 "without" blocks. */
export function randomBlockOrder(rand: () => number = Math.random): Block[] {
  const blocks: Block[] = [...Array(BLOCKS_WITH).fill('with'), ...Array(BLOCKS - BLOCKS_WITH).fill('without')];
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks;
}

/** Every distinct way to choose which 3 of the 6 block positions are "with" (20 of them). */
export function allBlockOrders(): Block[][] {
  const orders: Block[][] = [];
  const positions = [0, 1, 2, 3, 4, 5];
  const choose = (start: number, picked: number[]) => {
    if (picked.length === BLOCKS_WITH) {
      const order: Block[] = Array(BLOCKS).fill('without');
      picked.forEach(i => { order[i] = 'with'; });
      orders.push(order);
      return;
    }
    for (let i = start; i < positions.length; i++) choose(i + 1, [...picked, positions[i]]);
  };
  choose(0, []);
  return orders;
}

export interface BlockWindow {
  block: Block;
  /** Lumen days scored for this block, after dropping the washout at its start. */
  analysisDays: string[];
}

/** The 6 blocks' calendar day ranges and their (post-washout) analysis windows, from `startDay`. */
export function blockWindows(startDay: string, order: Block[], washoutDays = DEFAULT_WASHOUT_DAYS): BlockWindow[] {
  return order.map((block, i) => {
    const blockStart = shiftDayKey(startDay, i * BLOCK_DAYS);
    const analysisStart = shiftDayKey(blockStart, washoutDays);
    const blockEnd = shiftDayKey(blockStart, BLOCK_DAYS - 1);
    const analysisDays: string[] = [];
    for (let d = analysisStart; d <= blockEnd; d = shiftDayKey(d, 1)) analysisDays.push(d);
    return { block, analysisDays };
  });
}

/** The last calendar day of the whole 6-block schedule. */
export function experimentEndDay(startDay: string): string {
  return shiftDayKey(startDay, BLOCKS * BLOCK_DAYS - 1);
}

export interface BlockTally { count: number; total: number }

/** How many of a block's analysis days had the outcome present, out of how many were logged. */
export function tallyBlock(rows: DayRow[], outcomeKey: string, analysisDays: string[]): BlockTally {
  const byDay = new Map(rows.map(r => [r.dayKey, r]));
  let count = 0, total = 0;
  for (const d of analysisDays) {
    const row = byDay.get(d);
    if (!row?.symptomObserved) continue;
    total++;
    if (row.symptoms.some(s => s.key === outcomeKey && s.present)) count++;
  }
  return { count, total };
}

/** Severity values (not just presence) on a block's analysis days, for the day's composite score. */
export function severityValues(rows: DayRow[], analysisDays: string[]): number[] {
  const byDay = new Map(rows.map(r => [r.dayKey, r]));
  const out: number[] = [];
  for (const d of analysisDays) {
    const row = byDay.get(d);
    if (!row?.symptomObserved) continue;
    const v = dailyComposite(row);
    if (v !== null) out.push(v);
  }
  return out;
}

function pooledRate(tallies: BlockTally[]): number {
  const count = tallies.reduce((a, t) => a + t.count, 0);
  const total = tallies.reduce((a, t) => a + t.total, 0);
  return total > 0 ? count / total : 0;
}

/** Pooled "with" rate minus pooled "without" rate, for one labelling of the 6 blocks. */
function statisticFor(order: Block[], tallyByIndex: BlockTally[]): number {
  const withTallies = order.map((b, i) => (b === 'with' ? tallyByIndex[i] : null)).filter((t): t is BlockTally => !!t);
  const withoutTallies = order.map((b, i) => (b === 'without' ? tallyByIndex[i] : null)).filter((t): t is BlockTally => !!t);
  return pooledRate(withTallies) - pooledRate(withoutTallies);
}

export interface ExperimentProgress {
  /** 0-5, or null once the schedule has finished. */
  currentBlockIndex: number | null;
  currentBlock: Block | null;
  /** 1-7 within the current block, or null once finished. */
  dayInBlock: number | null;
  daysElapsed: number;
  daysRemaining: number;
  /** True once `today` is on or after the schedule's last day. */
  readyForAnalysis: boolean;
}

/** Where the schedule stands on `today` (a Lumen day key). */
export function experimentProgress(startDay: string, order: Block[], today: string): ExperimentProgress {
  const daysElapsed = Math.max(0, daysBetween(startDay, today) + (today >= startDay ? 1 : 0));
  const totalDays = BLOCKS * BLOCK_DAYS;
  const dayIndex = daysBetween(startDay, today); // 0-based day offset; negative before the start
  const finished = dayIndex >= totalDays;
  const blockIndex = finished || dayIndex < 0 ? null : Math.floor(dayIndex / BLOCK_DAYS);
  return {
    currentBlockIndex: blockIndex,
    currentBlock: blockIndex === null ? null : order[blockIndex],
    dayInBlock: blockIndex === null ? null : (dayIndex % BLOCK_DAYS) + 1,
    daysElapsed: Math.min(daysElapsed, totalDays),
    daysRemaining: Math.max(0, totalDays - dayIndex),
    readyForAnalysis: dayIndex >= totalDays - 1,
  };
}

export interface ExperimentResult {
  withCount: number; withTotal: number;
  withoutCount: number; withoutTotal: number;
  /** Pooled with-rate minus without-rate; positive means the outcome was more common with the exposure. */
  statistic: number;
  /** One-sided exact p-value: the share of the 20 possible block labellings at least this striking. */
  pValue: number;
  /** A block with under this share of its days logged is too thin to trust. */
  thinBlocks: number;
}

const MIN_BLOCK_LOGGED_SHARE = 0.4;

/**
 * @param windows this experiment's 6 blocks, each with the labelling actually assigned and its
 *   analysis days (already reflects whatever washout length the experiment used)
 * @param tallyByIndex outcome tallies for each of the 6 block positions, in the same order
 */
export function analyseExperiment(windows: BlockWindow[], tallyByIndex: BlockTally[]): ExperimentResult {
  const order = windows.map(w => w.block);
  const observed = statisticFor(order, tallyByIndex);
  const orders = allBlockOrders();
  const atLeastAsExtreme = orders.filter(o => statisticFor(o, tallyByIndex) >= observed - 1e-9).length;
  const pValue = atLeastAsExtreme / orders.length;

  const withTallies = order.map((b, i) => (b === 'with' ? tallyByIndex[i] : null)).filter((t): t is BlockTally => !!t);
  const withoutTallies = order.map((b, i) => (b === 'without' ? tallyByIndex[i] : null)).filter((t): t is BlockTally => !!t);
  const sum = (key: keyof BlockTally, ts: BlockTally[]) => ts.reduce((a, t) => a + t[key], 0);

  return {
    withCount: sum('count', withTallies), withTotal: sum('total', withTallies),
    withoutCount: sum('count', withoutTallies), withoutTotal: sum('total', withoutTallies),
    statistic: observed,
    pValue,
    thinBlocks: tallyByIndex.filter((t, i) => t.total < windows[i].analysisDays.length * MIN_BLOCK_LOGGED_SHARE).length,
  };
}
