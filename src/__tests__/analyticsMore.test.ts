/** Merged duplicate options, daylight-saving days, migration name mapping, and request validation on the new routes. */
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { buildMetricRows, MetricInput } from '../services/analytics/dayMetrics';
import { parseNameMap } from '../scripts/migrateAnalytics';
import { analyticsRouter } from '../routes/analytics';
import { dosesRouter } from '../routes/doses';
import { weatherRouter } from '../routes/weather';
import { logsRouter } from '../routes/logs';
import { configRouter } from '../routes/config';

const base = (over: Partial<MetricInput>): MetricInput => ({
  entries: [], categories: new Map([['catFood', { label: 'Food', kind: 'exposure' }]]), quickActions: new Map(), questions: new Map(),
  optionCategory: new Map([['dairyA', 'catFood'], ['dairyB', 'catFood']]),
  steps: new Map(), walkMinutes: new Map(), exerciseMinutes: new Map(), sessions: new Map(), weather: new Map(), doses: new Map(), flareDays: new Set(),
  timeZone: 'Asia/Kolkata', boundaryHour: 4, from: '2026-11-01', to: '2026-11-01', ...over,
});

describe('merged duplicate options', () => {
  it('counts a merged option under the option it was merged into', () => {
    const e = (opt: string, hh: string) => ({ occurredAt: new Date(`2026-11-01T${hh}:00+05:30`), timezone: 'Asia/Kolkata', categoryId: 'catFood', source: 'questionnaire', answers: [{ optionId: opt, optionLabelSnapshot: 'Dairy' }] });
    const rows = buildMetricRows(base({ entries: [e('dairyA', '09:00'), e('dairyB', '13:00')], optionMerge: new Map([['dairyB', 'dairyA']]) }));
    const keys = rows[0].items.filter(i => i.key.startsWith('opt_'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ key: 'opt_dairyA', count: 2 });
  });
});

describe('daylight-saving days', () => {
  it('keeps one row per day and the right day for logs around the change (Europe/London, 29 Mar 2026)', () => {
    const tz = 'Europe/London';
    const rows = buildMetricRows(base({
      timeZone: tz, from: '2026-03-28', to: '2026-03-30',
      entries: [
        // 03:30 local on the 29th is before the 4 AM boundary → still the 28th
        { occurredAt: new Date('2026-03-29T02:30:00Z'), timezone: tz, categoryId: 'catFood', source: 'questionnaire', answers: [{ optionId: 'dairyA', optionLabelSnapshot: 'Dairy' }] },
        // 23:30 local on the 29th (BST, UTC+1) → the 29th
        { occurredAt: new Date('2026-03-29T22:30:00Z'), timezone: tz, categoryId: 'catFood', source: 'questionnaire', answers: [{ optionId: 'dairyA', optionLabelSnapshot: 'Dairy' }] },
      ],
    }));
    expect(rows.map(r => r.dayKey)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(rows.map(r => r.items.find(i => i.key === 'opt_dairyA')?.count ?? 0)).toEqual([1, 1, 0]);
  });
});

describe('migration name mapping', () => {
  it('reads --map "typed=Medicine" pairs', () => {
    const m = parseNameMap(['--apply', '--map', 'HCQ=Hydroxychloroquine', '--map=vit d = Vitamin D3', '--map', 'broken']);
    expect([...m.entries()]).toEqual([['hcq', 'hydroxychloroquine'], ['vit d', 'vitamin d3']]);
  });
});

describe('request validation on the new routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/analytics', analyticsRouter);
  app.use('/medications', dosesRouter);
  app.use('/weather', weatherRouter);
  app.use('/logs', logsRouter);
  app.use('/', configRouter);
  app.use((err: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  const token = jwt.sign({ sub: new mongoose.Types.ObjectId().toString(), type: 'access' }, config.jwt.accessSecret);
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  it('rejects an Explore question it cannot read', async () => {
    expect((await auth(request(app).post('/analytics/explore').send({ target: { kind: 'evil' } }))).status).toBe(400);
    expect((await auth(request(app).post('/analytics/explore').send({ token: 'not a token!' }))).status).toBe(400);
    expect((await auth(request(app).post('/analytics/explore').send({ target: { kind: 'period', from: '2026-11-10', to: '2026-11-01' } }))).status).toBe(400);
    expect((await auth(request(app).post('/analytics/explore/days').send({ token: 'abc', key: '' }))).status).toBe(400);
  });

  it('rejects a bad dose mark, location, sleep night, log edit and pin list', async () => {
    const med = new mongoose.Types.ObjectId().toString();
    expect((await auth(request(app).put(`/medications/${med}/doses`).send({ dayKey: '17 Nov', slot: '8am', status: 'maybe', clientId: 'x' }))).status).toBe(400);
    expect((await auth(request(app).put('/weather/location').send({ lat: 123, lon: 0 }))).status).toBe(400);
    expect((await auth(request(app).put('/logs/sleep').send({ wakeTime: 'today', source: 'device' }))).status).toBe(400);
    expect((await auth(request(app).put('/logs/sleep').send({ wakeTime: new Date().toISOString(), durationMinutes: 5, source: 'device' }))).status).toBe(400);
    expect((await auth(request(app).patch(`/logs/${med}`).send({ occurredAt: 'yesterday' }))).status).toBe(400);
    expect((await auth(request(app).put('/analytics/pins').send({ pins: Array.from({ length: 13 }, (_, i) => `p${i}`) }))).status).toBe(400);
    expect((await auth(request(app).patch(`/options/${med}`).send({ mergedInto: 'not-an-id' }))).status).toBe(400);
    expect((await auth(request(app).patch(`/quick-actions/${med}`).send({ metricRole: 'steps' }))).status).toBe(400);
  });

  it('needs a signed-in member', async () => {
    expect((await request(app).get('/analytics/catalog')).status).toBe(401);
    expect((await request(app).get('/medications/doses')).status).toBe(401);
  });
});
