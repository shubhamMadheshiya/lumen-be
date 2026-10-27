import mongoose, { Schema, Document, Model } from 'mongoose';

/** One row per user per local day: the step total the phone counted on its own. */
export interface IDailyActivityDoc extends Document {
  userId: mongoose.Types.ObjectId;
  date: string; // YYYY-MM-DD in the user's local time
  steps: number;
  source: 'ios_motion' | 'health_connect';
  createdAt: Date;
  updatedAt: Date;
}

const DailyActivitySchema = new Schema<IDailyActivityDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date:   { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    steps:  { type: Number, required: true, min: 0, max: 200000 },
    source: { type: String, enum: ['ios_motion', 'health_connect'], required: true },
  },
  { timestamps: true }
);

DailyActivitySchema.index({ userId: 1, date: 1 }, { unique: true });

export const DailyActivity: Model<IDailyActivityDoc> =
  mongoose.model<IDailyActivityDoc>('DailyActivity', DailyActivitySchema);
