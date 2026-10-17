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
import {
  buildPdfReport,
  buildCsvReport,
  processLogEntries,
  aggregateQuickActions,
  computeClinicalHighlights,
  ReportGenerationContext,
} from '../services/reportGenerator';
import { z } from 'zod';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.post('/', validate(ReportRequestSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const { from, to, format, categoryIds } = req.body as z.infer<typeof ReportRequestSchema>;

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

    buildPdfReport(doc, context);

    doc.end();
  } catch (err) { next(err); }
});
