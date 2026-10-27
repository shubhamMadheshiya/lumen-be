jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../models/User', () => ({ User: { find: jest.fn() } }));
jest.mock('../models/LogEntry', () => ({ LogEntry: { distinct: jest.fn() } }));
jest.mock('../services/insightService', () => ({ computeInsights: jest.fn() }));

import { isDueNow, localHour } from '../jobs/insightScheduler';

describe('insight scheduler timing', () => {
  it('reads the hour in the member\'s own zone', () => {
    const t = new Date('2026-10-27T23:00:00Z'); // 04:30 in India
    expect(localHour(t, 'Asia/Kolkata')).toBe(4);
    expect(localHour(t, 'UTC')).toBe(23);
    expect(localHour(t, 'Not/AZone')).toBe(23);
  });

  it('is due in the hour of the Day Reset Boundary only', () => {
    const t = new Date('2026-10-27T23:00:00Z');
    expect(isDueNow({ timezone: 'Asia/Kolkata', dayBoundaryHour: 4 }, t)).toBe(true);
    expect(isDueNow({ timezone: 'Asia/Kolkata', dayBoundaryHour: 5 }, t)).toBe(false);
    expect(isDueNow({ timezone: 'UTC', dayBoundaryHour: 4 }, t)).toBe(false);
  });

  it('defaults to a 4 AM boundary', () => {
    expect(isDueNow({ timezone: 'Asia/Kolkata' }, new Date('2026-10-27T23:00:00Z'))).toBe(true);
    expect(isDueNow(undefined, new Date('2026-10-27T04:30:00Z'))).toBe(true);
  });
});
