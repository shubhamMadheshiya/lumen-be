import {
  benjaminiHochberg, betaCdf, fisherGreater, hodgesLehmannShift, logGamma, mannKendall, median,
  normalCdf, probabilityHigher, theilSenSlope, variance,
} from '../services/insights/stats';

describe('stats helpers', () => {
  it('log-gamma matches known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 9);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 9);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 9);
  });

  it('Beta CDF matches known values', () => {
    expect(betaCdf(0.3, 1, 1)).toBeCloseTo(0.3, 9);
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 9);
    expect(betaCdf(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 9);
    expect(betaCdf(0.2, 2, 5)).toBeCloseTo(0.34464, 4);
    expect(betaCdf(0, 2, 5)).toBe(0);
    expect(betaCdf(1, 2, 5)).toBe(1);
  });

  it('Fisher exact matches a hand calculation', () => {
    // [[8,2],[2,8]]: (45*45 + 10*10 + 1) / C(20,10)
    expect(fisherGreater(8, 2, 2, 8)).toBeCloseTo(2126 / 184756, 9);
    expect(fisherGreater(5, 5, 5, 5)).toBeGreaterThan(0.5);
    expect(fisherGreater(0, 0, 0, 0)).toBe(1);
  });

  it('Benjamini-Hochberg adjusts and keeps the input order', () => {
    const q = benjaminiHochberg([0.04, 0.01, 0.2, 0.03]);
    expect(q[1]).toBeCloseTo(0.04, 9);
    expect(q[3]).toBeCloseTo(0.0533333, 6);
    expect(q[0]).toBeCloseTo(0.0533333, 6);
    expect(q[2]).toBeCloseTo(0.2, 9);
    expect(benjaminiHochberg([])).toEqual([]);
  });

  it('probability of a higher rate is 0.5 for equal data and high for a clear gap', () => {
    expect(probabilityHigher(5, 20, 5, 20)).toBeCloseTo(0.5, 2);
    expect(probabilityHigher(12, 20, 3, 20)).toBeGreaterThan(0.99);
    expect(probabilityHigher(3, 20, 12, 20)).toBeLessThan(0.01);
    const p = probabilityHigher(0, 10, 0, 10);
    expect(p).toBeGreaterThan(0.45);
    expect(p).toBeLessThan(0.55);
  });

  it('median handles odd and even counts', () => {
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('variance is 0 for one point and matches a hand calculation', () => {
    expect(variance([5])).toBe(0);
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.5714, 3);
  });

  it('normal CDF matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(3)).toBeCloseTo(0.99865, 4);
  });

  describe('mannKendall', () => {
    it('finds no trend in a flat or symmetric series', () => {
      expect(mannKendall([5, 5, 5, 5, 5]).p).toBe(1);
      expect(mannKendall([1, 2, 3, 2, 1]).s).toBe(0);
    });

    it('finds a strong trend in a steadily falling series', () => {
      const r = mannKendall([9, 8, 7, 6, 5, 4, 3, 2, 1]);
      expect(r.s).toBeLessThan(0);
      expect(r.p).toBeLessThan(0.01);
    });

    it('a weak trend buried in noise is not significant', () => {
      const r = mannKendall([5, 6, 4, 5, 6, 5, 4, 5]);
      expect(r.p).toBeGreaterThan(0.1);
    });

    it('ties lower the variance correction without breaking the test', () => {
      const r = mannKendall([3, 3, 3, 5, 5, 5, 7, 7, 7]);
      expect(r.p).toBeLessThan(0.05);
    });
  });

  describe('theilSenSlope', () => {
    it('matches the exact slope of a straight line, ignoring one outlier', () => {
      expect(theilSenSlope([0, 2, 4, 6, 8])).toBeCloseTo(2, 9);
      expect(theilSenSlope([0, 2, 4, 100, 8])).toBeCloseTo(2, 9);
    });

    it('is 0 for a flat series', () => {
      expect(theilSenSlope([5, 5, 5, 5])).toBe(0);
    });
  });

  describe('hodgesLehmannShift', () => {
    it('is the median of every post-minus-pre pairing', () => {
      expect(hodgesLehmannShift([1, 2, 3], [4, 5, 6])).toBe(3);
      expect(hodgesLehmannShift([5], [5])).toBe(0);
    });

    it('is 0 for an empty group', () => {
      expect(hodgesLehmannShift([], [1, 2])).toBe(0);
      expect(hodgesLehmannShift([1, 2], [])).toBe(0);
    });
  });
});
