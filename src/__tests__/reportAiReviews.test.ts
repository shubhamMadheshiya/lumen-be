import PDFDocument from 'pdfkit';
import { plainForPdf, renderAiReviewsPages } from '../services/reportGenerator';

describe('AI weekly reviews in the doctor PDF', () => {
  it('turns markdown into plain text with bullets', () => {
    expect(plainForPdf('## Sleep\n**Better** this week.\n- 7.2 h average\n* fewer wake-ups')).toBe(
      'Sleep\nBetter this week.\n• 7.2 h average\n• fewer wake-ups',
    );
  });

  it('renders every review, flowing onto extra pages when long', async () => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise<void>(r => doc.on('end', () => r()));
    const long = Array.from({ length: 120 }, (_, i) => `- line ${i} about symptoms and sleep`).join('\n');
    renderAiReviewsPages(doc, [
      { weekStart: '2026-10-26', weekEnd: '2026-11-01', text: long },
      { weekStart: '2026-11-02', weekEnd: '2026-11-08', text: 'Short week.' },
    ]);
    const pages = doc.bufferedPageRange().count;
    doc.end();
    await done;
    expect(pages).toBeGreaterThan(1);
    expect(Buffer.concat(chunks).subarray(0, 4).toString()).toBe('%PDF');
  });
});
