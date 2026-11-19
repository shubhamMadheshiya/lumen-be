/**
 * One-off clean-up for the Explore / Metrics release. DRY RUN by default; pass --apply to write.
 *
 *   node dist/scripts/migrateAnalytics.js            # report only
 *   node dist/scripts/migrateAnalytics.js --apply    # make the changes
 *
 * 1. Sleep entries: one per night. Copies of the same night are soft-deleted (the most complete
 *    one is kept and re-keyed to `sleep:<userId>:<day>`). Entries the old "I'm awake" button made
 *    WITHOUT a known bedtime were an invented 8-hour night — they are soft-deleted.
 * 2. Day sessions: `sessionDate` becomes the Lumen day (it was the UTC date). Two sessions that
 *    land on the same day are merged (earliest wake, latest bedtime).
 * 3. Old "Taken / Missed dose / Extra" answers become dose marks (source "import") for medicines
 *    whose name matches exactly (ignoring case). Names that match nothing are listed.
 * 4. Every member's Explore / Metrics rows are rebuilt.
 */
import mongoose from 'mongoose';
import { LogEntry } from '../models/LogEntry';
import { DaySession } from '../models/DaySession';
import { Medication } from '../models/Medication';
import { DoseEvent } from '../models/DoseEvent';
import { Category } from '../models/Category';
import { User } from '../models/User';
import { userDayContext } from '../utils/userDay';
import { sleepClientId } from '../services/sleep/sleepRecord';
import { rebuildAllMetrics } from '../services/analytics/freshness';

type Val = { fieldKey: string; value: unknown };
const val = (e: { answers?: Array<{ values?: Val[] }> }, key: string) => e.answers?.[0]?.values?.find(v => v.fieldKey === key)?.value;

export async function migrateAnalytics(apply: boolean): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = { apply };
  const users = await User.find({}).select('_id').lean();
  let sleepDeleted = 0, sleepInvented = 0, sleepRekeyed = 0, sessionsMoved = 0, sessionsMerged = 0, dosesImported = 0;
  const unmatched = new Map<string, number>();

  for (const u of users) {
    const uid = u._id as mongoose.Types.ObjectId;
    const userId = String(uid);
    const ctx = await userDayContext(uid);

    // 1. Sleep
    const sleeps = await LogEntry.find({ userId: uid, source: 'sleep', deletedAt: { $exists: false } }).sort({ updatedAt: -1 });
    const byDay = new Map<string, typeof sleeps>();
    for (const s of sleeps) {
      if (val(s, 'bedtime') === undefined && val(s, 'sleep_source') === undefined) {
        sleepInvented++;
        if (apply) { s.deletedAt = new Date(); s.clientId = `${s.clientId}:invented:${s._id}`; await s.save(); }
        continue;
      }
      const day = ctx.dayKeyOf(s.occurredAt, s.timezone);
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
    }
    for (const [day, list] of byDay) {
      const score = (e: (typeof list)[number]) => (val(e, 'bedtime') ? 2 : 0) + (val(e, 'sleep_quality') ? 1 : 0) + (val(e, 'sleep_source') === 'device' ? 4 : 0);
      const [keep, ...dupes] = [...list].sort((a, b) => score(b) - score(a));
      for (const d of dupes) {
        sleepDeleted++;
        if (apply) { d.deletedAt = new Date(); d.clientId = `${d.clientId}:dup:${d._id}`; await d.save(); }
      }
      const wanted = sleepClientId(userId, day);
      if (keep.clientId !== wanted) {
        sleepRekeyed++;
        if (apply) {
          const clash = await LogEntry.findOne({ userId: uid, clientId: wanted, _id: { $ne: keep._id } });
          if (clash) { clash.clientId = `${wanted}:old:${clash._id}`; if (!clash.deletedAt) clash.deletedAt = new Date(); await clash.save(); }
          keep.clientId = wanted;
          if (keep.timezone === 'UTC') keep.timezone = ctx.timeZone;
          await keep.save();
        }
      }
    }

    // 2. Day sessions: group by the Lumen day of their wake time, merge groups, then move.
    const sessions = await DaySession.find({ userId: uid }).sort({ sessionDate: 1 });
    const groups = new Map<string, Array<(typeof sessions)[number]>>();
    for (const s of sessions) {
      const anchor = s.wakeTime ?? s.sleepTime ?? s.createdAt;
      const day = anchor ? ctx.dayKeyOf(new Date(anchor)) : s.sessionDate;
      groups.set(day, [...(groups.get(day) ?? []), s]);
    }
    const moves: Array<{ id: unknown; day: string }> = [];
    for (const [day, list] of groups) {
      const [keep, ...rest] = list;
      for (const r of rest) {
        sessionsMerged++;
        if (apply) {
          if (r.wakeTime && (!keep.wakeTime || r.wakeTime < keep.wakeTime)) keep.wakeTime = r.wakeTime;
          if (r.sleepTime && (!keep.sleepTime || r.sleepTime > keep.sleepTime)) keep.sleepTime = r.sleepTime;
          await DaySession.deleteOne({ _id: r._id });
        }
      }
      if (apply && rest.length) await DaySession.updateOne({ _id: keep._id }, { $set: { wakeTime: keep.wakeTime, sleepTime: keep.sleepTime } });
      if (keep.sessionDate !== day) { sessionsMoved++; moves.push({ id: keep._id, day }); }
    }
    if (apply && moves.length) {
      // Two steps so no two sessions ever share a date in between (unique index).
      for (const m of moves) await DaySession.updateOne({ _id: m.id }, { $set: { sessionDate: `tmp-${String(m.id)}` } });
      for (const m of moves) await DaySession.updateOne({ _id: m.id }, { $set: { sessionDate: m.day } });
    }

    // 3. Old medicine answers → dose marks
    const meds = await Medication.find({ userId: uid }).select('name').lean();
    const byName = new Map<string, (typeof meds)[number][]>();
    for (const m of meds) byName.set(m.name.trim().toLowerCase(), [...(byName.get(m.name.trim().toLowerCase()) ?? []), m]);
    const medCats = await Category.find({ userId: uid, name: /medic/i }).select('_id').lean();
    if (medCats.length) {
      const entries = await LogEntry.find({ userId: uid, categoryId: { $in: medCats.map(c => c._id) }, deletedAt: { $exists: false } }).lean();
      for (const e of entries) {
        for (const a of e.answers ?? []) {
          const label = (a.optionLabelSnapshot ?? '').toLowerCase();
          const status = /miss|skip|forgot/.test(label) ? 'skipped' : /extra|rescue/.test(label) ? 'extra' : /taken|took/.test(label) ? 'taken' : null;
          if (!status) continue;
          const name = String((a.values ?? []).find(v => v.fieldKey === 'name')?.value ?? '').trim().toLowerCase();
          if (!name) continue;
          const matches = byName.get(name) ?? [];
          if (matches.length !== 1) { unmatched.set(name, (unmatched.get(name) ?? 0) + 1); continue; }
          const med = matches[0];
          const clientId = `import:${e._id}:${a.optionId}`;
          dosesImported++;
          if (apply) {
            const at = new Date(e.occurredAt);
            await DoseEvent.updateOne(
              { userId: uid, clientId },
              { $setOnInsert: {
                userId: uid, clientId, medicationId: med._id, dayKey: ctx.dayKeyOf(at, e.timezone),
                slot: status === 'extra' ? 'prn' : 'unscheduled', status, at, source: 'import', nameSnapshot: med.name, clientUpdatedAt: at,
              } },
              { upsert: true },
            );
          }
        }
      }
    }

    // 4. Rebuild Explore / Metrics rows
    if (apply) await rebuildAllMetrics(userId);
  }

  Object.assign(report, {
    users: users.length, sleepDuplicatesRemoved: sleepDeleted, inventedSleepRemoved: sleepInvented, sleepRekeyed,
    sessionsMoved, sessionsMerged, dosesImported,
    unmatchedMedicineNames: [...unmatched.entries()].map(([name, n]) => `${name} (${n})`),
  });
  return report;
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;
  if (!uri) { console.error('MONGO_URI is not set'); process.exit(1); }
  mongoose.connect(uri)
    .then(() => migrateAnalytics(apply))
    .then(r => { console.log(JSON.stringify(r, null, 2)); return mongoose.disconnect(); })
    .catch(err => { console.error(err); process.exit(1); });
}
