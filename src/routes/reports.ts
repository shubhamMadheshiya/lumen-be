import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ReportRequestSchema } from '@lumen/shared';
import { LogEntry } from '../models/LogEntry';
import { Category } from '../models/Category';
import { User } from '../models/User';
import { z } from 'zod';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.post('/', validate(ReportRequestSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const { from, to, format, categoryIds } = req.body as z.infer<typeof ReportRequestSchema>;

    const filter: Record<string, unknown> = {
      userId,
      occurredAt: { $gte: new Date(from), $lte: new Date(to) },
      deletedAt: { $exists: false },
    };
    if (categoryIds?.length) {
      filter.categoryId = { $in: categoryIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    const [entries, user] = await Promise.all([
      LogEntry.find(filter).sort({ occurredAt: 1 }).limit(5000),
      User.findById(userId),
    ]);

    const categories = await Category.find({ userId });
    const categoryMap = Object.fromEntries(categories.map(c => [c._id.toString(), c.name]));

    if (format === 'csv') {
      const rows: string[] = ['Date,Time,Category,Source,Note,Answers'];
      for (const e of entries) {
        const date = e.occurredAt.toISOString().slice(0, 10);
        const time = e.occurredAt.toISOString().slice(11, 16);
        const cat  = e.categoryId ? (categoryMap[e.categoryId.toString()] || '') : '';
        const answerSummary = e.answers.map(a =>
          `${a.optionLabelSnapshot}${a.values.length ? ': ' + a.values.map(v => `${v.value}${v.unit ? ' ' + v.unit : ''}`).join(', ') : ''}`,
        ).join(' | ');
        rows.push(`"${date}","${time}","${cat}","${e.source}","${(e.note || '').replace(/"/g, '""')}","${answerSummary.replace(/"/g, '""')}"`);
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="lumen-report-${from}-to-${to}.csv"`);
      res.send(rows.join('\n'));
      return;
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="lumen-report-${from}-to-${to}.json"`);
      res.json({ exportedAt: new Date(), user: { name: user?.name, email: user?.email }, from, to, entries });
      return;
    }

    // ── PDF ──────────────────────────────────
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lumen-report-${from}-to-${to}.pdf"`);
    doc.pipe(res);

    // Cover
    doc.fontSize(24).font('Helvetica-Bold').text('Lumen Health Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').text(`${user?.name || 'User'} · ${from} to ${to}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#888888').text(
      '⚠️  This is a personal tracking record, not a medical diagnosis.\n' +
      'All patterns are observational only. Share with your healthcare provider for professional assessment.',
      { align: 'center' },
    );
    doc.fillColor('#000000').moveDown(1);

    // Summary
    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.fontSize(11).font('Helvetica')
      .text(`Total entries: ${entries.length}`)
      .text(`Date range: ${from} – ${to}`)
      .text(`Categories tracked: ${[...new Set(entries.map(e => e.categoryId?.toString()).filter(Boolean))].map(id => categoryMap[id!] || id).join(', ') || 'None'}`);
    doc.moveDown(1);

    // Entries grouped by day
    const byDay = new Map<string, typeof entries>();
    for (const e of entries) {
      const day = e.occurredAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(e);
    }

    for (const [day, dayEntries] of [...byDay.entries()].slice(0, 60)) {
      doc.fontSize(12).font('Helvetica-Bold').text(day);
      for (const e of dayEntries) {
        const time = e.occurredAt.toISOString().slice(11, 16);
        const cat  = e.categoryId ? (categoryMap[e.categoryId.toString()] || '?') : e.source;
        const answers = e.answers.map(a => a.optionLabelSnapshot).join(', ');
        doc.fontSize(10).font('Helvetica').text(`  ${time}  [${cat}]  ${answers}${e.note ? ' — ' + e.note : ''}`);
      }
      doc.moveDown(0.5);
    }

    if (byDay.size > 60) {
      doc.fontSize(10).fillColor('#888888').text(`… and ${byDay.size - 60} more days (export as CSV/JSON for the full dataset)`);
    }

    doc.end();
  } catch (err) { next(err); }
});
