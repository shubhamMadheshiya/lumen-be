import mongoose, { Schema, Document, Model } from 'mongoose';

/** Bookkeeping that keeps a member's DayMetric rows fresh without rebuilding everything. */
export interface IMetricStateDoc extends Document {
  userId: mongoose.Types.ObjectId;
  version: number;
  /** Changes made after this moment have not been folded in yet. */
  builtAt: Date;
  timeZone: string;
  boundaryHour: number;
  /** Hash of everything that changes how every day is read (analysis kinds, metric roles, dose plans). */
  configHash: string;
  /** Days to rebuild that leave no updatedAt trail (a log moved away from them, a deleted dose). */
  dirtyDays: string[];
  firstDay?: string;
}

const MetricStateSchema = new Schema<IMetricStateDoc>({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  version:      { type: Number, required: true },
  builtAt:      { type: Date, required: true },
  timeZone:     { type: String, required: true },
  boundaryHour: { type: Number, required: true },
  configHash:   { type: String, required: true },
  dirtyDays:    { type: [String], default: [] },
  firstDay:     { type: String },
});

export const MetricState: Model<IMetricStateDoc> = mongoose.model<IMetricStateDoc>('MetricState', MetricStateSchema);
