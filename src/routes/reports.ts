import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ReportRequestSchema } from '../shared';
import { LogEntry } from '../models/LogEntry';
import { Category } from '../models/Category';
import { QuickAction } from '../models/QuickAction';
import { User } from '../models/User';
import { Medication } from '../models/Medication';
import { InsightFinding } from '../models/InsightFinding';
import { FlareEpisode } from '../models/FlareEpisode';
import {
  buildPdfReport,
  buildCsvReport,
  renderSummaryPage,
  processLogEntries,
  aggregateQuickActions,
  computeClinicalHighlights,
  ReportGenerationContext,
} from '../services/reportGenerator';
import { loadPersistedDayRows, loadFlareDayKeys } from '../services/insights/dayTableService';
import { classifyTrend, weeklyMedians } from '../services/insights/progress';
import { buildSummaryModel, FindingInfo, FlareEpisodeInfo, MedicationInfo, RedFlagEventInfo } from '../services/insights/summaryModel';
import { evaluateRedFlags, mergeFlags, FlagEntry } from '../services/safety/redFlags';
import { trackingDayKey, resolveTimeZone, DEFAULT_BOUNDARY_HOUR } from '../utils/dayKey';
import { z } from 'zod';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.post('/', validate(ReportRequestSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const { from, to, format, categoryIds, includeSummary, notesForDoctor } = req.body as z.infer<typeof ReportRequestSchema>;

    const fromDate = new Date(from);
    let toDate = new Date(to);
    if (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to.trim())) {
      toDate = new Date(`${to.trim()}T23:59:59.999Z`);
    }

    const filter: Record<string, unknown> = {
      userId,
      occurredAt: { $gte: fromDate, $lte: toDate },
      deletedAt: { $exists: false },
    };
    if (categoryIds?.length) {
      filter.categoryId = { $in: categoryIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    const [entries, user, categories, quickActions] = await Promise.all([
      LogEntry.find(filter).sort({ occurredAt: 1 }).limit(5000),
      User.findById(userId),
      Category.find({ userId }),
      QuickAction.find({ userId }),
    ]);

    const categoryMap = Object.fromEntries(categories.map(c => [c._id.toString(), c.name]));
    const quickActionMap = Object.fromEntries(quickActions.map(qa => [qa._id.toString(), qa.label]));

    const context: ReportGenerationContext = {
      entries,
      user,
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      categoryMap,
      quickActionMap,
    };

    const fromClean = context.from;
    const toClean = context.to;

    // ── CSV Export ──────────────────────────────
    if (format === 'csv') {
      const csvData = buildCsvReport(context);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="lumen-report-${fromClean}-to-${toClean}.csv"`);
      res.send(csvData);
      return;
    }

    // ── JSON Export ─────────────────────────────
    if (format === 'json') {
      const rawItems = processLogEntries(context);
      const items = aggregateQuickActions(rawItems);
      const highlights = computeClinicalHighlights(items);
      res.setHeader('Content-Disposition', `attachment; filename="lumen-report-${fromClean}-to-${toClean}.json"`);
      res.json({
        exportedAt: new Date(),
        user: { name: user?.name, email: user?.email },
        from: fromClean,
        to: toClean,
        summary: highlights,
        entries: items,
      });
      return;
    }

    // ── PDF Export (Clinical Grade) ─────────────
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lumen-report-${fromClean}-to-${toClean}.pdf"`);
    doc.pipe(res);

    if (includeSummary) {
      const model = await buildReportSummaryModel(String(userId), fromClean, toClean, entries, notesForDoctor);
      renderSummaryPage(doc, model, user?.name);
      doc.addPage();
    }
    buildPdfReport(doc, context);

    doc.end();
  } catch (err) { next(err); }
});

/**
 * Gathers everything the one-page doctor summary needs and turns it into a SummaryModel.
 * `entries` are the same report-period log entries the detail pages use, reused here for the
 * red-flag notices so this does not re-query the database for them.
 */
async function buildReportSummaryModel(
  userId: string,
  from: string,
  to: string,
  entries: Array<{ occurredAt: Date; timezone?: string; answers?: unknown }>,
  notesForDoctor?: string,
) {
  const uid = new mongoose.Types.ObjectId(userId);
  const [fullRows, flareDayKeys, medications, flareDocs, findingDocs, user] = await Promise.all([
    loadPersistedDayRows(userId),
    loadFlareDayKeys(userId),
    Medication.find({ userId: uid }).select('name dose unit active startedOn stoppedOn').lean(),
    FlareEpisode.find({ userId: uid, confirmed: { $ne: 'no' }, startDay: { $lte: to }, endDay: { $gte: from } })
      .select('startDay endDay source confirmed').lean(),
    InsightFinding.find({ userId: uid, shownTier: { $in: ['possible', 'consistent'] } })
      .select('exposureLabel outcomeLabel lagDays a b c d shownTier').lean(),
    User.findById(uid).select('preferences.timezone preferences.dayBoundaryHour').lean(),
  ]);

  const timeZone = resolveTimeZone(user?.preferences?.timezone);
  const boundaryHour = user?.preferences?.dayBoundaryHour ?? DEFAULT_BOUNDARY_HOUR;

  const medicationInfo: MedicationInfo[] = medications.map(m => ({
    name: m.name, dose: m.dose, unit: m.unit, active: m.active, startedOn: m.startedOn, stoppedOn: m.stoppedOn,
  }));
  const flareInfo: FlareEpisodeInfo[] = flareDocs.map(f => ({
    startDay: f.startDay, endDay: f.endDay, source: f.source, confirmed: f.confirmed ?? null,
  }));
  const findingInfo: FindingInfo[] = findingDocs.map(f => ({
    exposureLabel: f.exposureLabel, outcomeLabel: f.outcomeLabel, lagDays: f.lagDays,
    counts: { exposedWith: f.a, exposedTotal: f.a + f.b, otherWith: f.c, otherTotal: f.c + f.d },
    tier: f.shownTier as 'possible' | 'consistent',
  }));

  // Same fixed rules as POST /logs, recomputed over this period's entries rather than stored
  // separately — a rule change applies retroactively to older reports, which is an accepted trade-off.
  const sorted = [...entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const redFlagEvents: RedFlagEventInfo[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i] as FlagEntry;
    const recent = sorted.slice(0, i) as FlagEntry[];
    // evaluateRedFlags' freshness check is relative to `now`; for a historical report that "now" is
    // the entry's own time, so an old entry is judged on what it said, not on how long ago it was.
    const flags = mergeFlags(evaluateRedFlags(entry, recent, new Date(sorted[i].occurredAt)));
    const dayKey = trackingDayKey(new Date(sorted[i].occurredAt), timeZone, boundaryHour);
    for (const f of flags) redFlagEvents.push({ dayKey, title: f.title, level: f.level });
  }

  const trend = classifyTrend(weeklyMedians(fullRows));

  return buildSummaryModel({
    from, to, rows: fullRows, medications: medicationInfo, trend,
    flareEpisodes: flareInfo, redFlagEvents, findings: findingInfo, notesForDoctor,
  }, flareDayKeys);
}
