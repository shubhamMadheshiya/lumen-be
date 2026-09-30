import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IDaySessionDoc extends Document {
  userId: mongoose.Types.ObjectId;
  sessionDate: string; // YYYY-MM-DD
  wakeTime?: Date;
  sleepTime?: Date;
  wakeEdited: boolean;
  sleepEdited: boolean;
  morningCheckInEntryId?: mongoose.Types.ObjectId;
  eveningCheckInEntryId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DaySessionSchema = new Schema<IDaySessionDoc>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    wakeTime:    { type: Date },
    sleepTime:   { type: Date },
    wakeEdited:  { type: Boolean, default: false },
    sleepEdited: { type: Boolean, default: false },
    morningCheckInEntryId: { type: Schema.Types.ObjectId, ref: 'LogEntry' },
    eveningCheckInEntryId: { type: Schema.Types.ObjectId, ref: 'LogEntry' },
  },
  { timestamps: true },
);

// One session per user per calendar date
DaySessionSchema.index({ userId: 1, sessionDate: 1 }, { unique: true });

export const DaySession: Model<IDaySessionDoc> = mongoose.model<IDaySessionDoc>('DaySession', DaySessionSchema);
