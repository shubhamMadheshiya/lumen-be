import mongoose, { Schema, Document, Model } from 'mongoose';
import type { DayMetricRow } from '../services/analytics/dayMetrics';

/** Stored `DayMetricRow` (see services/analytics/dayMetrics.ts). One per member per Lumen day. */
export interface IDayMetricDoc extends Document, Omit<DayMetricRow, never> {
  userId: mongoose.Types.ObjectId;
  version: number;
  builtAt: Date;
}

const DayMetricSchema = new Schema<IDayMetricDoc>(
  {
    userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dayKey:  { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    version: { type: Number, required: true },
    builtAt: { type: Date, required: true },
    logged:  { type: Schema.Types.Mixed, required: true },
    items:   { type: Schema.Types.Mixed, default: [] },
    metrics: { type: Schema.Types.Mixed, required: true },
    doses:   { type: Schema.Types.Mixed, default: [] },
  },
  { minimize: false },
);

DayMetricSchema.index({ userId: 1, dayKey: 1 }, { unique: true });

export const DayMetric: Model<IDayMetricDoc> = mongoose.model<IDayMetricDoc>('DayMetric', DayMetricSchema);
