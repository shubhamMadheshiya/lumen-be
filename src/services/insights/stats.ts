/**
 * The small amount of statistics the engine needs, written out so it has no dependencies:
 * Fisher's exact test, Beta posteriors for "is the rate higher on exposure days", and the
 * Benjamini-Hochberg false-discovery correction. All deterministic; no random numbers.
 */

// ── factorials and the gamma function ───────────────────────────────────────────

const logFactCache: number[] = [0, 0];
function logFact(n: number): number {
  for (let i = logFactCache.length; i <= n; i++) logFactCache[i] = logFactCache[i - 1] + Math.log(i);
  return logFactCache[n];
}
const logChoose = (n: number, k: number) => logFact(n) - logFact(k) - logFact(n - k);

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// ── regularised incomplete beta (the Beta distribution's CDF) ───────────────────

function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return h;
}

/** P(X <= x) for X ~ Beta(a, b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Probability that the true rate on exposure days is higher than on other days, given
 * `events1` of `n1` exposure days and `events0` of `n0` other days, each with a Jeffreys
 * Beta(0.5, 0.5) prior. Summed over a grid, so it stays accurate even when a rate is near 0 or 1.
 */
export function probabilityHigher(events1: number, n1: number, events0: number, n0: number, steps = 256): number {
  const a1 = events1 + 0.5, b1 = n1 - events1 + 0.5;
  const a0 = events0 + 0.5, b0 = n0 - events0 + 0.5;
  let total = 0;
  let prev = 0;
  for (let i = 1; i <= steps; i++) {
    const x = i / steps;
    const cdf0 = betaCdf(x, a0, b0);
    const mid = (i - 0.5) / steps;
    total += (cdf0 - prev) * (1 - betaCdf(mid, a1, b1));
    prev = cdf0;
  }
  return Math.min(1, Math.max(0, total));
}

// ── Fisher's exact test ─────────────────────────────────────────────────────────

/**
 * One-sided Fisher exact p-value that exposure days have MORE outcome days than chance:
 *            outcome  no outcome
 * exposed       a         b
 * unexposed     c         d
 */
export function fisherGreater(a: number, b: number, c: number, d: number): number {
  const n = a + b;
  const k = a + c;
  const total = a + b + c + d;
  if (total === 0) return 1;
  const denominator = logChoose(total, n);
  let p = 0;
  for (let x = a; x <= Math.min(n, k); x++) {
    p += Math.exp(logChoose(k, x) + logChoose(total - k, n - x) - denominator);
  }
  return Math.min(1, p);
}

// ── multiple tests ──────────────────────────────────────────────────────────────

/** Benjamini-Hochberg adjusted p-values (q-values), in the order given. */
export function benjaminiHochberg(p: number[]): number[] {
  const m = p.length;
  const order = p.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
  const q = new Array<number>(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const { value, index } = order[rank - 1];
    running = Math.min(running, (value * m) / rank);
    q[index] = Math.min(1, running);
  }
  return q;
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation, scaled to be comparable with a standard deviation under normality. */
export function scaledMad(xs: number[]): number {
  const med = median(xs);
  return 1.4826 * median(xs.map(x => Math.abs(x - med)));
}

// ── normal distribution (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7) ──────────

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** P(Z <= z) for the standard normal distribution. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// ── Mann-Kendall trend test and Theil-Sen slope ─────────────────────────────────

export interface MannKendall {
  s: number;
  z: number;
  /** Two-sided p-value: the chance a flat series produces a trend this strong, by chance. */
  p: number;
}

/** Non-parametric trend test: tests whether `values` (in order) tend to rise or fall, handling ties. */
export function mannKendall(values: number[]): MannKendall {
  const n = values.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(values[j] - values[i]);
    }
  }
  const tieGroups = new Map<number, number>();
  for (const v of values) tieGroups.set(v, (tieGroups.get(v) ?? 0) + 1);
  const tieCorrection = Array.from(tieGroups.values()).reduce((acc, t) => acc + t * (t - 1) * (2 * t + 5), 0);
  const varS = (n * (n - 1) * (2 * n + 5) - tieCorrection) / 18;
  if (varS <= 0 || s === 0) return { s, z: 0, p: 1 };
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : (s + 1) / Math.sqrt(varS);
  return { s, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

/** Median of all pairwise slopes (y_j - y_i) / (j - i): a trend line resistant to one bad week. */
export function theilSenSlope(values: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      slopes.push((values[j] - values[i]) / (j - i));
    }
  }
  return slopes.length ? median(slopes) : 0;
}

/** Median of every post[j] - pre[i]: a robust shift estimate between two groups (Hodges-Lehmann). */
export function hodgesLehmannShift(pre: number[], post: number[]): number {
  if (pre.length === 0 || post.length === 0) return 0;
  const diffs: number[] = [];
  for (const a of pre) for (const b of post) diffs.push(b - a);
  return median(diffs);
}
