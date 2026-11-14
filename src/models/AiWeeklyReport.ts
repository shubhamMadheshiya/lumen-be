import mongoose, { Schema, Document, Model } from 'mongoose';

/** Lumen AI's written review of one week (Monday to Sunday, Lumen days). */
export interface IAiWeeklyReportDoc extends Document {
  userId: mongoose.Types.ObjectId;
  /** YYYY-MM-DD, the Monday the week starts on. */
  weekStart: string;
  weekEnd: string;
  text: string;
  createdAt: Date;
}

const AiWeeklyReportSchema = new Schema<IAiWeeklyReportDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    weekStart: { type: String, required: true },
    weekEnd: { type: String, required: true },
    text: { type: String, required: true, maxlength: 20000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AiWeeklyReportSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

export const AiWeeklyReport: Model<IAiWeeklyReportDoc> =
  mongoose.model<IAiWeeklyReportDoc>('AiWeeklyReport', AiWeeklyReportSchema);
