import { normalCdf } from '../insights/stats';

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    for (let k = i; k <= j; k++) r[order[k].i] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation with an approximate two-sided p-value (t / normal approximation). */
export function spearman(x: number[], y: number[]): { rho: number; p: number } | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const rx = ranks(x.slice(0, n));
  const ry = ranks(y.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { rho: 0, p: 1 };
  const rho = sxy / Math.sqrt(sxx * syy);
  const z = rho * Math.sqrt(n - 1);
  return { rho, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) };
}
