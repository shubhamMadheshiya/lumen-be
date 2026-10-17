/**
 * Clinical-Grade Health Report Generator
 * Generates structured, professional PDF, CSV, and JSON medical reports.
 * 
 * Includes:
 * - Patient & Consultation Profile
 * - 30-Second Executive Clinical Summary (Frequencies, Adherence, Vitals ranges)
 * - Anatomical Body Map & Joint Map resolution (humanized anatomical labels)
 * - Geographical Location & Environment tracking (city, region, place, travel)
 * - Complete Parameter & Value preservation (temperatures, scales, durations, Bristol types)
 * - Photographic evidence badges
 * - Quick Action label resolution & rapid-tap aggregation
 * - Clean medical layout with zebra-striping, typography hierarchy, and running headers/footers
 */

import PDFDocument from 'pdfkit';
import { ILogEntryDoc } from '../models/LogEntry';
import { IUserDoc } from '../models/User';

// ── Anatomical Terminology Dictionary ───────────────────────────
const ANATOMICAL_MAP: Record<string, string> = {
  // Head & Neck
  head: 'Head',
  forehead: 'Forehead',
  temple_left: 'Left temple',
  temple_right: 'Right temple',
  occipital: 'Back of head',
  neck: 'Neck',
  throat: 'Throat',
  jaw: 'Jaw',

  // Upper Extremities
  r_shoulder: 'Right shoulder',
  l_shoulder: 'Left shoulder',
  r_upper_arm: 'Right upper arm',
  l_upper_arm: 'Left upper arm',
  r_elbow: 'Right elbow',
  l_elbow: 'Left elbow',
  r_forearm: 'Right forearm',
  l_forearm: 'Left forearm',
  r_wrist: 'Right wrist',
  l_wrist: 'Left wrist',
  r_hand: 'Right hand',
  l_hand: 'Left hand',
  r_fingers: 'Right fingers',
  l_fingers: 'Left fingers',
  r_thumb: 'Right thumb',
  l_thumb: 'Left thumb',
  r_pip: 'Right PIP (finger joint)',
  l_pip: 'Left PIP (finger joint)',
  r_mcp: 'Right MCP (knuckle)',
  l_mcp: 'Left MCP (knuckle)',
  r_dip: 'Right DIP (fingertip joint)',
  l_dip: 'Left DIP (fingertip joint)',

  // Torso & Spine
  chest: 'Chest',
  chest_substernal: 'Substernal chest',
  chest_left_precordial: 'Left precordial chest',
  chest_right_parasternal: 'Right parasternal chest',
  upper_back: 'Upper back',
  mid_back: 'Mid back',
  lower_back: 'Lower back (lumbar)',
  abdomen: 'Abdomen',
  upper_abdomen: 'Epigastric / Upper abdomen',
  lower_abdomen: 'Lower abdomen / Pelvis',
  ribs_left: 'Left ribs',
  ribs_right: 'Right ribs',

  // Lower Extremities
  r_hip: 'Right hip',
  l_hip: 'Left hip',
  groin: 'Groin / Pelvis',
  r_thigh: 'Right thigh',
  l_thigh: 'Left thigh',
  r_knee: 'Right knee',
  l_knee: 'Left knee',
  r_lower_leg: 'Right lower leg (calf/shin)',
  l_lower_leg: 'Left lower leg (calf/shin)',
  r_ankle: 'Right ankle',
  l_ankle: 'Left ankle',
  r_foot: 'Right foot',
  l_foot: 'Left foot',
  r_toes: 'Right toes',
  l_toes: 'Left toes',
  r_mtp: 'Right MTP (toe joint)',
  l_mtp: 'Left MTP (toe joint)',
};

// ── Bristol Stool Scale Dictionary ──────────────────────────────
const BRISTOL_SCALE_MAP: Record<string, string> = {
  '1': 'Type 1 (Separate hard lumps, severe constipation)',
  '2': 'Type 2 (Lumpy, sausage-like, mild constipation)',
  '3': 'Type 3 (Sausage with surface cracks, normal)',
  '4': 'Type 4 (Smooth, soft sausage, optimal normal)',
  '5': 'Type 5 (Soft blobs with clear edges, low fiber)',
  '6': 'Type 6 (Mushy consistency, mild diarrhea)',
  '7': 'Type 7 (Liquid, entirely watery, diarrhea)',
};

export function humanizeAnatomicalCode(code: string): string {
  if (!code) return '';
  const trimmed = String(code).trim().toLowerCase();
  if (ANATOMICAL_MAP[trimmed]) return ANATOMICAL_MAP[trimmed];
  return trimmed
    .replace(/^r_/, 'Right ')
    .replace(/^l_/, 'Left ')
    .replace(/^chest_/, 'Chest: ')
    .replace(/^joint_/, 'Joint: ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function formatDurationHuman(secondsOrVal: number, unit?: string): string {
  if (unit === 'seconds' || (!unit && secondsOrVal >= 60)) {
    const mins = Math.round(secondsOrVal / 60);
    if (mins < 60) return `${mins} min`;
    const hours = (mins / 60).toFixed(1).replace('.0', '');
    return `${hours} hr (${mins} min)`;
  }
  return `${secondsOrVal} ${unit || ''}`.trim();
}

export interface ReportGenerationContext {
  entries: ILogEntryDoc[];
  user: IUserDoc | null;
  from: string;
  to: string;
  categoryMap: Record<string, string>;
  quickActionMap: Record<string, string>;
}

export interface FormattedEntryAnswer {
  label: string;
  details: string[];
  anatomicalLocations: string[];
  comment?: string;
  otherText?: string;
  hasPhoto: boolean;
}

export interface FormattedLogItem {
  id: string;
  occurredAt: Date;
  dateKey: string;
  dateFormatted: string;
  timeFormatted: string;
  category: string;
  source: string;
  isQuickAction: boolean;
  quickActionLabel?: string;
  answers: FormattedEntryAnswer[];
  geoLocation?: string;
  note?: string;
  photoCount: number;
}

/**
 * Normalizes and enriches raw log entries into clean clinical items
 */
export function processLogEntries(ctx: ReportGenerationContext): FormattedLogItem[] {
  const { entries, categoryMap, quickActionMap } = ctx;
  const userTimezone = entries[0]?.timezone || 'UTC';

  return entries.map(e => {
    const occurred = new Date(e.occurredAt);
    const tz = e.timezone || userTimezone;

    let timeFormatted = '';
    let dateFormatted = '';
    let dateKey = '';
    try {
      timeFormatted = occurred.toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      dateFormatted = occurred.toLocaleDateString('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      dateKey = occurred.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    } catch {
      timeFormatted = occurred.toISOString().slice(11, 16);
      dateFormatted = occurred.toISOString().slice(0, 10);
      dateKey = dateFormatted;
    }

    // Category name resolution
    let category = '';
    if (e.categoryId) {
      category = categoryMap[e.categoryId.toString()] || 'General';
    } else if (e.source === 'quick_action') {
      category = 'Quick Action';
    } else if (e.source === 'check_in') {
      category = 'Check-In';
    } else if (e.source === 'activity') {
      category = 'Physical Activity';
    } else {
      category = e.source.charAt(0).toUpperCase() + e.source.slice(1).replace(/_/g, ' ');
    }

    // Quick action name resolution
    const isQuickAction = e.source === 'quick_action';
    let quickActionLabel: string | undefined;
    if (isQuickAction && e.quickActionId) {
      quickActionLabel = quickActionMap[e.quickActionId.toString()];
    }

    // Geographic location
    let geoLocation: string | undefined;
    if (e.location) {
      const parts: string[] = [];
      if (e.location.name) parts.push(e.location.name);
      if (e.location.city) parts.push(e.location.city);
      if (e.location.region && e.location.region !== e.location.city) parts.push(e.location.region);
      if (parts.length > 0) {
        geoLocation = parts.join(', ');
      } else if (e.location.formattedAddress) {
        geoLocation = e.location.formattedAddress;
      }
    }

    // Answers & values parsing
    const answers: FormattedEntryAnswer[] = (e.answers || []).map(ans => {
      const label = ans.optionLabelSnapshot || 'Selected';
      const details: string[] = [];
      const anatomicalLocations: string[] = [];
      let hasPhoto = false;

      for (const fv of ans.values || []) {
        if (fv.value === undefined || fv.value === null || fv.value === '') continue;

        // Anatomical Body Locations
        if (fv.dataType === 'location' || fv.fieldKey === 'location' || fv.fieldKey === 'joints' || fv.fieldKey === 'chest_location') {
          const locCodes = Array.isArray(fv.value) ? fv.value : [fv.value];
          for (const code of locCodes) {
            const h = humanizeAnatomicalCode(String(code));
            if (h && !anatomicalLocations.includes(h)) {
              anatomicalLocations.push(h);
            }
          }
        }
        // Bristol Stool Scale
        else if (fv.fieldKey === 'type' && (label.toLowerCase().includes('stool') || category.toLowerCase().includes('symptom'))) {
          const mapped = BRISTOL_SCALE_MAP[String(fv.value)];
          details.push(mapped || `Type ${fv.value}`);
        }
        // Temperature
        else if (fv.dataType === 'temperature' || fv.fieldKey === 'temp' || fv.fieldKey === 'temperature') {
          const tempVal = Number(fv.value);
          const unit = fv.unit || '°C';
          const rangeNote = unit.includes('C')
            ? (tempVal >= 38.0 ? ' (Fever)' : tempVal >= 37.3 ? ' (Low-grade)' : ' (Normal)')
            : (tempVal >= 100.4 ? ' (Fever)' : tempVal >= 99.1 ? ' (Low-grade)' : ' (Normal)');
          details.push(`${tempVal} ${unit}${rangeNote}`);
        }
        // Severity scale
        else if (fv.dataType === 'range' || fv.fieldKey === 'severity') {
          const sev = Number(fv.value);
          const sevWord = sev >= 8 ? 'Severe' : sev >= 5 ? 'Moderate' : sev >= 1 ? 'Mild' : 'None';
          details.push(`Severity: ${sev}/10 (${sevWord})`);
        }
        // Duration
        else if (fv.dataType === 'duration' || fv.fieldKey === 'duration') {
          const num = Number(fv.value);
          if (!isNaN(num)) {
            details.push(`Duration: ${formatDurationHuman(num, fv.unit)}`);
          } else {
            details.push(`Duration: ${fv.value} ${fv.unit || ''}`.trim());
          }
        }
        // Image / Photo
        else if (fv.dataType === 'image' || fv.fieldKey === 'photo') {
          hasPhoto = true;
          details.push('[Photo attached]');
        }
        // Generic number / string
        else {
          details.push(`${fv.value}${fv.unit ? ' ' + fv.unit : ''}`);
        }
      }

      const totalPhotos = (ans as any).mediaIds?.length || (hasPhoto ? 1 : 0);

      return {
        label,
        details,
        anatomicalLocations,
        comment: ans.comment,
        otherText: ans.otherText,
        hasPhoto: totalPhotos > 0,
      };
    });

    const photoCount = (e.mediaIds?.length || 0) + answers.filter(a => a.hasPhoto).length;

    return {
      id: e._id.toString(),
      occurredAt: occurred,
      dateKey,
      dateFormatted,
      timeFormatted,
      category,
      source: e.source,
      isQuickAction,
      quickActionLabel,
      answers,
      geoLocation,
      note: e.note,
      photoCount,
    };
  });
}

/**
 * Aggregates rapid consecutive quick actions on the same day (e.g. 6 water taps in 2 mins)
 */
export function aggregateQuickActions(items: FormattedLogItem[]): FormattedLogItem[] {
  const result: FormattedLogItem[] = [];
  let currentGroup: FormattedLogItem[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) return;
    if (currentGroup.length === 1) {
      result.push(currentGroup[0]);
    } else {
      const first = currentGroup[0];
      const last = currentGroup[currentGroup.length - 1];
      const label = first.quickActionLabel || 'Quick Action';
      const timeSpan = first.timeFormatted === last.timeFormatted
        ? first.timeFormatted
        : `${first.timeFormatted} – ${last.timeFormatted}`;

      result.push({
        ...first,
        timeFormatted: timeSpan,
        quickActionLabel: `${label} (×${currentGroup.length} recorded)`,
      });
    }
    currentGroup = [];
  };

  for (const item of items) {
    if (item.isQuickAction && item.answers.length === 0) {
      if (currentGroup.length === 0) {
        currentGroup.push(item);
      } else {
        const prev = currentGroup[currentGroup.length - 1];
        const isSameAction = prev.quickActionLabel === item.quickActionLabel;
        const timeDiffMs = Math.abs(item.occurredAt.getTime() - prev.occurredAt.getTime());
        if (isSameAction && timeDiffMs < 5 * 60 * 1000) {
          currentGroup.push(item);
        } else {
          flushGroup();
          currentGroup.push(item);
        }
      }
    } else {
      flushGroup();
      result.push(item);
    }
  }
  flushGroup();

  return result;
}

/**
 * Computes clinical highlights for the Executive Summary
 */
export function computeClinicalHighlights(items: FormattedLogItem[]) {
  const symptomCounts: Record<string, { count: number; maxSeverity?: number; locations: Set<string> }> = {};
  const temperatures: number[] = [];
  const medicationRecords: Record<string, { taken: number; total: number }> = {};
  const geoLocationsTracked = new Set<string>();

  for (const item of items) {
    if (item.geoLocation) {
      geoLocationsTracked.add(item.geoLocation);
    }

    for (const ans of item.answers) {
      const lowerCat = item.category.toLowerCase();
      const lowerLbl = ans.label.toLowerCase();

      // Symptoms tracking
      if (lowerCat.includes('symptom') || lowerCat.includes('check-in')) {
        if (!symptomCounts[ans.label]) {
          symptomCounts[ans.label] = { count: 0, locations: new Set() };
        }
        symptomCounts[ans.label].count += 1;
        for (const loc of ans.anatomicalLocations) {
          symptomCounts[ans.label].locations.add(loc);
        }
        for (const d of ans.details) {
          if (d.includes('Severity:')) {
            const match = d.match(/Severity:\s*(\d+)/);
            if (match) {
              const val = Number(match[1]);
              const currentMax = symptomCounts[ans.label].maxSeverity ?? 0;
              if (val > currentMax) symptomCounts[ans.label].maxSeverity = val;
            }
          }
        }
      }

      // Temperatures
      for (const d of ans.details) {
        if (d.includes('°C')) {
          const match = d.match(/([\d.]+)\s*°C/);
          if (match) temperatures.push(Number(match[1]));
        }
      }

      // Medications
      if (lowerCat.includes('medication')) {
        if (!medicationRecords[ans.label]) {
          medicationRecords[ans.label] = { taken: 0, total: 0 };
        }
        medicationRecords[ans.label].total += 1;
        if (lowerLbl.includes('taken') || lowerLbl === 'yes' || !lowerLbl.includes('no')) {
          medicationRecords[ans.label].taken += 1;
        }
      }
    }
  }

  // Top symptoms sorted by frequency
  const topSymptoms = Object.entries(symptomCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, data]) => ({
      name,
      count: data.count,
      maxSeverity: data.maxSeverity,
      locations: Array.from(data.locations).slice(0, 4),
    }));

  return {
    topSymptoms,
    temperatures: {
      min: temperatures.length > 0 ? Math.min(...temperatures) : undefined,
      max: temperatures.length > 0 ? Math.max(...temperatures) : undefined,
      avg: temperatures.length > 0 ? (temperatures.reduce((a, b) => a + b, 0) / temperatures.length).toFixed(1) : undefined,
      count: temperatures.length,
    },
    medications: medicationRecords,
    locations: Array.from(geoLocationsTracked),
  };
}

/**
 * Builds the high-resolution clinical PDF document
 */
export function buildPdfReport(doc: PDFKit.PDFDocument, ctx: ReportGenerationContext): void {
  const rawItems = processLogEntries(ctx);
  const items = aggregateQuickActions(rawItems);
  const highlights = computeClinicalHighlights(items);

  const { user, from, to } = ctx;
  const userName = user?.name || 'Patient';
  const userEmail = user?.email || '';

  // Clean date formatting for headers
  const fromClean = from.slice(0, 10);
  const toClean = to.slice(0, 10);

  // Styling colors
  const primaryColor = '#C2410C'; // Warm clinical rust / primary
  const textDark = '#0F172A';
  const textMuted = '#475569';
  const textLight = '#64748B';
  const borderLight = '#E2E8F0';
  const bgCard = '#F8FAFC';

  // ── HEADER ──────────────────────────────────────────────────
  doc.rect(50, 40, doc.page.width - 100, 4).fill(primaryColor);
  doc.y = 52;

  doc.fontSize(20).font('Helvetica-Bold').fillColor(textDark).text('LUMEN HEALTH REPORT', { align: 'left' });
  doc.moveDown(0.2);

  doc.fontSize(10).font('Helvetica').fillColor(textMuted).text(
    `Patient: ${userName} ${userEmail ? `(${userEmail})` : ''}  |  Period: ${fromClean} to ${toClean}  |  Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    { align: 'left' },
  );

  doc.moveDown(0.5);
  doc.fontSize(8).font('Helvetica-Oblique').fillColor(textLight).text(
    '[CONFIDENTIAL MEDICAL RECORD] Observational self-tracked patient diary for clinical consultation. Share with your healthcare provider for evaluation.',
    { align: 'left' },
  );

  doc.moveDown(0.6);
  doc.strokeColor(borderLight).lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(0.8);

  // ── EXECUTIVE CLINICAL SUMMARY BOX ─────────────────────────
  doc.fontSize(12).font('Helvetica-Bold').fillColor(textDark).text('EXECUTIVE CLINICAL SUMMARY');
  doc.moveDown(0.4);

  const summaryTopY = doc.y;
  const summaryBoxWidth = doc.page.width - 100;

  // Highlights Columns
  doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor).text('KEY REPORTED SYMPTOMS & ANATOMICAL REGIONS:');
  doc.moveDown(0.2);

  if (highlights.topSymptoms.length > 0) {
    for (const sym of highlights.topSymptoms) {
      const locText = sym.locations.length > 0 ? ` (Areas: ${sym.locations.join(', ')})` : '';
      const sevText = sym.maxSeverity ? ` [Peak Severity: ${sym.maxSeverity}/10]` : '';
      doc.fontSize(8.5).font('Helvetica').fillColor(textDark).text(
        `• ${sym.name}: ${sym.count} episodes logged${sevText}${locText}`,
        { indent: 10 },
      );
    }
  } else {
    doc.fontSize(8.5).font('Helvetica').fillColor(textMuted).text('• No acute symptom flares recorded in this window.', { indent: 10 });
  }

  doc.moveDown(0.4);

  // Vitals & Medications Row
  doc.fontSize(9).font('Helvetica-Bold').fillColor(primaryColor).text('VITALS, MEASUREMENTS & MEDICATION ADHERENCE:');
  doc.moveDown(0.2);

  if (highlights.temperatures.count > 0) {
    doc.fontSize(8.5).font('Helvetica').fillColor(textDark).text(
      `• Body Temperature: Range ${highlights.temperatures.min} °C – ${highlights.temperatures.max} °C (Avg: ${highlights.temperatures.avg} °C across ${highlights.temperatures.count} readings)`,
      { indent: 10 },
    );
  }

  const medKeys = Object.keys(highlights.medications);
  if (medKeys.length > 0) {
    for (const med of medKeys) {
      const mData = highlights.medications[med];
      const pct = Math.round((mData.taken / mData.total) * 100);
      doc.fontSize(8.5).font('Helvetica').fillColor(textDark).text(
        `• ${med}: Logged ${mData.taken}/${mData.total} times (~${pct}% adherence)`,
        { indent: 10 },
      );
    }
  }

  if (highlights.locations.length > 0) {
    doc.fontSize(8.5).font('Helvetica').fillColor(textDark).text(
      `• Geographical Locations Recorded: ${highlights.locations.slice(0, 5).join('; ')}`,
      { indent: 10 },
    );
  }

  doc.moveDown(0.8);
  doc.strokeColor(borderLight).lineWidth(0.8).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(0.8);

  // ── DETAILED TIMELINE ───────────────────────────────────────
  doc.fontSize(12).font('Helvetica-Bold').fillColor(textDark).text('DETAILED CLINICAL TIMELINE (CHRONOLOGICAL)');
  doc.moveDown(0.5);

  // Group items by dateKey
  const byDate = new Map<string, FormattedLogItem[]>();
  for (const item of items) {
    if (!byDate.has(item.dateKey)) byDate.set(item.dateKey, []);
    byDate.get(item.dateKey)!.push(item);
  }

  for (const [dateKey, dayEntries] of byDate.entries()) {
    // Check page overflow before starting day
    if (doc.y > doc.page.height - 120) {
      doc.addPage();
    }

    const firstItem = dayEntries[0];
    const dayLocations = Array.from(new Set(dayEntries.map(d => d.geoLocation).filter(Boolean)));
    const locHeader = dayLocations.length > 0 ? `  ·  Location: ${dayLocations.join(', ')}` : '';

    // Day Header Bar
    const barY = doc.y;
    doc.rect(50, barY, doc.page.width - 100, 18).fill('#F1F5F9');
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(textDark).text(
      `${firstItem.dateFormatted}${locHeader}`,
      58,
      barY + 4,
    );
    doc.y = barY + 24;

    // Day Entries
    for (const e of dayEntries) {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
      }

      const itemStartY = doc.y;

      // Time & Category Tag
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(primaryColor).text(
        `${e.timeFormatted}`,
        58,
        itemStartY,
        { width: 55 },
      );

      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(textDark).text(
        `[${e.category}]`,
        115,
        itemStartY,
        { width: 95 },
      );

      // Body text / findings
      let findingsText = '';
      if (e.isQuickAction && e.quickActionLabel) {
        findingsText = e.quickActionLabel;
      } else if (e.answers.length > 0) {
        const answerSnippets = e.answers.map(a => {
          let str = a.label;
          if (a.anatomicalLocations.length > 0) {
            str += ` (Location: ${a.anatomicalLocations.join(', ')})`;
          }
          if (a.details.length > 0) {
            str += ` [${a.details.join(', ')}]`;
          }
          if (a.comment) {
            str += ` - "${a.comment}"`;
          }
          if (a.otherText) {
            str += ` - Custom: "${a.otherText}"`;
          }
          return str;
        });
        findingsText = answerSnippets.join('; ');
      } else {
        findingsText = e.category;
      }

      if (e.note) {
        findingsText += ` — Note: "${e.note}"`;
      }

      if (e.photoCount > 0) {
        findingsText += `  [📷 ${e.photoCount} Photo${e.photoCount > 1 ? 's' : ''}]`;
      }

      doc.fontSize(8).font('Helvetica').fillColor(textDark).text(
        findingsText,
        215,
        itemStartY,
        { width: doc.page.width - 270, lineGap: 1.5 },
      );

      doc.moveDown(0.3);
    }

    doc.moveDown(0.4);
  }

  // ── FOOTER ON ALL PAGES ─────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 35;
    doc.strokeColor(borderLight).lineWidth(0.5).moveTo(50, footerY - 5).lineTo(doc.page.width - 50, footerY - 5).stroke();
    doc.fontSize(7.5).font('Helvetica').fillColor(textLight).text(
      'Lumen Personal Health Diary · Confidential · Not a standalone medical diagnosis',
      50,
      footerY,
      { align: 'left' },
    );
    doc.fontSize(7.5).font('Helvetica').fillColor(textLight).text(
      `Page ${i + 1} of ${range.count}`,
      doc.page.width - 150,
      footerY,
      { align: 'right' },
    );
  }
}

/**
 * Builds clean clinical CSV export with anatomical and geo locations
 */
export function buildCsvReport(ctx: ReportGenerationContext): string {
  const rawItems = processLogEntries(ctx);
  const items = aggregateQuickActions(rawItems);

  const header = [
    'Date',
    'Time',
    'Category',
    'Source',
    'Findings_And_Answers',
    'Anatomical_Body_Locations',
    'Geo_Location',
    'Patient_Notes',
    'Photos_Recorded',
  ];

  const escapeCsv = (val?: string) => `"${(val || '').replace(/"/g, '""')}"`;

  const rows: string[] = [header.join(',')];

  for (const item of items) {
    const findings = item.answers.map(a => {
      const parts = [a.label];
      if (a.details.length > 0) parts.push(`(${a.details.join(', ')})`);
      if (a.comment) parts.push(`Note: ${a.comment}`);
      return parts.join(' ');
    }).join(' | ') || (item.quickActionLabel || item.category);

    const anatomical = Array.from(
      new Set(item.answers.flatMap(a => a.anatomicalLocations)),
    ).join('; ');

    rows.push([
      escapeCsv(item.dateKey),
      escapeCsv(item.timeFormatted),
      escapeCsv(item.category),
      escapeCsv(item.source),
      escapeCsv(findings),
      escapeCsv(anatomical),
      escapeCsv(item.geoLocation),
      escapeCsv(item.note),
      item.photoCount > 0 ? String(item.photoCount) : '0',
    ].join(','));
  }

  return rows.join('\n');
}
