import mongoose, { Schema, Document, Model } from 'mongoose';

export type ExperimentBlock = 'with' | 'without';
export type ExperimentStatus = 'active' | 'completed' | 'abandoned';

/** A guided "test it for 6 weeks" self-experiment: six randomised 7-day with/without blocks. */
export interface IExperimentDoc extends Document {
  userId: mongoose.Types.ObjectId;
  exposureKey: string; // opt_/qa_/cat_ prefixed, or a free-text key for a custom exposure
  exposureLabel: string;
  outcomeKey: string;
  outcomeLabel: string;
  startDay: string; // YYYY-MM-DD, the first day of block 1
  washoutDays: number;
  blockOrder: ExperimentBlock[]; // length 6, three 'with' and three 'without'
  /** A medicine change routes its copy to "discuss with your doctor" rather than a plain self-test. */
  isMedicineRelated: boolean;
  status: ExperimentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ExperimentSchema = new Schema<IExperimentDoc>(
  {
    userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exposureKey:        { type: String, required: true },
    exposureLabel:       { type: String, required: true, maxlength: 100 },
    outcomeKey:         { type: String, required: true },
    outcomeLabel:        { type: String, required: true, maxlength: 100 },
    startDay:           { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    washoutDays:         { type: Number, required: true, min: 0, max: 3 },
    blockOrder:          { type: [String], required: true },
    isMedicineRelated:   { type: Boolean, default: false },
    status:              { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
  },
  { timestamps: true },
);

ExperimentSchema.index({ userId: 1, status: 1 });

export const Experiment: Model<IExperimentDoc> = mongoose.model<IExperimentDoc>('Experiment', ExperimentSchema);
