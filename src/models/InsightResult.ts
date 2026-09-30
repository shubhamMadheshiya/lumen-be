import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IInsightResultDoc extends Document {
  userId: mongoose.Types.ObjectId;
  triggerId: string;    // categoryId, optionId, or quickActionId as string
  triggerLabel: string;
  symptomId: string;    // categoryId or optionId as string
  symptomLabel: string;
  lagWindowHours: [number, number];
  lift: number;
  baselineRate: number;
  triggerRate: number;
  occurrences: number;
  confidence: 'low' | 'medium' | 'high';
  computedAt: Date;
}

const InsightResultSchema = new Schema<IInsightResultDoc>(
  {
    userId:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
    triggerId:      { type: String, required: true },
    triggerLabel:   { type: String, required: true },
    symptomId:      { type: String, required: true },
    symptomLabel:   { type: String, required: true },
    lagWindowHours: { type: [Number], required: true },
    lift:           { type: Number, required: true },
    baselineRate:   { type: Number, required: true },
    triggerRate:    { type: Number, required: true },
    occurrences:    { type: Number, required: true },
    confidence:     { type: String, enum: ['low', 'medium', 'high'], required: true },
    computedAt:     { type: Date, required: true },
  },
  { timestamps: false },
);

InsightResultSchema.index({ userId: 1, computedAt: -1 });
// Replace previous results for the same (trigger, symptom, window)
InsightResultSchema.index({ userId: 1, triggerId: 1, symptomId: 1, lagWindowHours: 1 }, { unique: false });

export const InsightResult: Model<IInsightResultDoc> = mongoose.model<IInsightResultDoc>('InsightResult', InsightResultSchema);
