import mongoose, { Schema, Document, Model } from 'mongoose';

export type FindingTier = 'still_learning' | 'possible' | 'consistent';

/**
 * One exposure -> symptom -> lag comparison and its running tier. The numbers are the latest
 * run's; `shownTier` is what the member sees after the two-day rule.
 */
export interface IInsightFindingDoc extends Document {
  userId: mongoose.Types.ObjectId;
  exposureKey: string; // opt_ / qa_ / cat_ prefixed id
  exposureLabel: string;
  outcomeKey: string;
  outcomeLabel: string;
  lagDays: number;
  a: number; b: number; c: number; d: number;
  pairs: number;
  riskDifference: number;
  shrunkRR: number;
  pHigher: number | null;
  fisherP: number;
  q: number;
  adjustedRD: number;
  circularP: number | null;
  halvesAgree: boolean | null;
  weakShare: number;
  testCount: number;
  latestTier: FindingTier;
  previousTier: FindingTier | null;
  latestDay: string;
  shownTier: FindingTier;
  /** True once the member has seen it at a tier above still_learning and it later fell away. */
  noLongerSeen: boolean;
  lastShownDay?: string;
  engineVersion: number;
  runId: mongoose.Types.ObjectId;
  updatedAt: Date;
}

const InsightFindingSchema = new Schema<IInsightFindingDoc>(
  {
    userId:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
    exposureKey:    { type: String, required: true },
    exposureLabel:  { type: String, required: true },
    outcomeKey:     { type: String, required: true },
    outcomeLabel:   { type: String, required: true },
    lagDays:        { type: Number, required: true },
    a: Number, b: Number, c: Number, d: Number,
    pairs:          Number,
    riskDifference: Number,
    shrunkRR:       Number,
    pHigher:        { type: Number, default: null },
    fisherP:        Number,
    q:              Number,
    adjustedRD:     Number,
    circularP:      { type: Number, default: null },
    halvesAgree:    { type: Boolean, default: null },
    weakShare:      { type: Number, default: 0 },
    testCount:      Number,
    latestTier:     { type: String, enum: ['still_learning', 'possible', 'consistent'], required: true },
    previousTier:   { type: String, enum: ['still_learning', 'possible', 'consistent', null], default: null },
    latestDay:      { type: String, required: true },
    shownTier:      { type: String, enum: ['still_learning', 'possible', 'consistent'], required: true },
    noLongerSeen:   { type: Boolean, default: false },
    lastShownDay:   { type: String },
    engineVersion:  { type: Number, required: true },
    runId:          { type: Schema.Types.ObjectId, ref: 'InsightRun' },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

InsightFindingSchema.index({ userId: 1, exposureKey: 1, outcomeKey: 1, lagDays: 1 }, { unique: true });
InsightFindingSchema.index({ userId: 1, shownTier: 1 });

export const InsightFinding: Model<IInsightFindingDoc> =
  mongoose.model<IInsightFindingDoc>('InsightFinding', InsightFindingSchema);
