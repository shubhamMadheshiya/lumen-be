/**
 * Daily weather for the member's rounded location (Open-Meteo, free, no key). Stored per Lumen
 * day so Explore can compare weather with symptoms. The day used is the calendar day in the
 * member's zone; with a 4 AM boundary that is the same day for every hour that matters.
 */
import mongoose from 'mongoose';
import { WeatherDay } from '../../models/WeatherDay';

export interface WeatherRow {
  dayKey: string;
  tMaxC: number | null;
  tMinC: number | null;
  humidity: number | null;
  pressureHpa: number | null;
  pressureDelta: number | null;
  uvMax: number | null;
  precipMm: number | null;
}

type Fetcher = (url: string) => Promise<unknown>;
let fetcher: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
};
/** Tests swap the network call. */
export function setWeatherFetcherForTesting(f: Fetcher | null): void {
  fetcher = f ?? (async (url) => { const r = await fetch(url); return r.json(); });
}

/** Two decimals ≈ 1 km: enough for weather, not a home address. */
export const roundCoord = (v: number) => Math.round(v * 100) / 100;

const round1 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

interface OpenMeteoResponse {
  daily?: { time?: string[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; uv_index_max?: (number | null)[]; precipitation_sum?: (number | null)[] };
  hourly?: { time?: string[]; relative_humidity_2m?: (number | null)[]; pressure_msl?: (number | null)[] };
}

/** Pure: Open-Meteo JSON → one row per day (humidity and pressure averaged from hourly values). */
export function parseOpenMeteo(json: OpenMeteoResponse): WeatherRow[] {
  const days = json.daily?.time ?? [];
  const hourly = json.hourly ?? {};
  const byDay = new Map<string, { hum: number[]; pres: number[] }>();
  (hourly.time ?? []).forEach((t, i) => {
    const d = String(t).slice(0, 10);
    const slot = byDay.get(d) ?? { hum: [], pres: [] };
    const h = hourly.relative_humidity_2m?.[i];
    const p = hourly.pressure_msl?.[i];
    if (typeof h === 'number') slot.hum.push(h);
    if (typeof p === 'number') slot.pres.push(p);
    byDay.set(d, slot);
  });
  const avg = (xs: number[]) => (xs.length >= 12 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const rows: WeatherRow[] = days.map((d, i) => ({
    dayKey: d,
    tMaxC: round1(json.daily?.temperature_2m_max?.[i]),
    tMinC: round1(json.daily?.temperature_2m_min?.[i]),
    uvMax: round1(json.daily?.uv_index_max?.[i]),
    precipMm: round1(json.daily?.precipitation_sum?.[i]),
    humidity: round1(avg(byDay.get(d)?.hum ?? [])),
    pressureHpa: round1(avg(byDay.get(d)?.pres ?? [])),
    pressureDelta: null,
  }));
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].pressureHpa;
    const b = rows[i].pressureHpa;
    rows[i].pressureDelta = a !== null && b !== null ? round1(b - a) : null;
  }
  return rows;
}

export function openMeteoUrl(lat: number, lon: number, timeZone: string, pastDays: number): string {
  const q = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    daily: 'temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum',
    hourly: 'relative_humidity_2m,pressure_msl',
    past_days: String(Math.max(0, Math.min(92, pastDays))),
    forecast_days: '1',
    timezone: timeZone || 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

/**
 * Fetches and stores weather days. Today is skipped while still in progress only when it is
 * incomplete (fewer than 12 hourly values); the next run fills it in. Returns rows stored.
 */
export async function refreshWeather(userId: string, lat: number, lon: number, timeZone: string, pastDays: number): Promise<number> {
  const uid = new mongoose.Types.ObjectId(userId);
  const json = (await fetcher(openMeteoUrl(lat, lon, timeZone, pastDays))) as OpenMeteoResponse;
  const rows = parseOpenMeteo(json);
  // The first row has no day before it in this response; take its delta from what is stored.
  if (rows.length > 0 && rows[0].pressureHpa !== null) {
    const prev = await WeatherDay.findOne({ userId: uid, dayKey: { $lt: rows[0].dayKey } }).sort({ dayKey: -1 }).select('dayKey pressureHpa').lean();
    if (prev?.pressureHpa != null) rows[0].pressureDelta = round1(rows[0].pressureHpa - prev.pressureHpa);
  }
  const usable = rows.filter(r => r.tMaxC !== null || r.humidity !== null);
  if (usable.length === 0) return 0;
  await WeatherDay.bulkWrite(usable.map(r => ({
    updateOne: {
      filter: { userId: uid, dayKey: r.dayKey },
      update: { $set: { ...r, lat: roundCoord(lat), lon: roundCoord(lon) } },
      upsert: true,
    },
  })));
  return usable.length;
}
