import mongoose, { Schema, Document, Model } from 'mongoose';

/** One analysis run: what went in (a hash of the day table) and how many tests were corrected for. */
export interface IInsightRunDoc extends Document {
  userId: mongoose.Types.ObjectId;
  ranAt: Date;
  /** Lumen day the run happened on, for the two-day confirmation rule. */
  dayKey: string;
  engineVersion: number;
  dataHash: string;
  daysObserved: number;
  eligibleTests: number;
  /** Findings by candidate tier on this run, before the two-day rule. */
  candidates: { possible: number; consistent: number };
  config: unknown;
}

const InsightRunSchema = new Schema<IInsightRunDoc>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ranAt:         { type: Date, required: true },
    dayKey:        { type: String, required: true },
    engineVersion: { type: Number, required: true },
    dataHash:      { type: String, required: true },
    daysObserved:  { type: Number, required: true },
    eligibleTests: { type: Number, required: true },
    candidates:    { possible: { type: Number, default: 0 }, consistent: { type: Number, default: 0 } },
    config:        { type: Schema.Types.Mixed },
  },
  { timestamps: false },
);

InsightRunSchema.index({ userId: 1, ranAt: -1 });

export const InsightRun: Model<IInsightRunDoc> = mongoose.model<IInsightRunDoc>('InsightRun', InsightRunSchema);
