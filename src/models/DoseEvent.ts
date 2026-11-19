import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * One mark on one planned dose (or an "as needed" / extra dose): Taken, Skipped or Extra.
 * A planned dose with no mark is "not marked" — never assumed skipped.
 */
export type DoseStatus = 'taken' | 'skipped' | 'extra';
export type DoseSource = 'notification' | 'checklist' | 'backfill' | 'import' | 'ai';

export interface IDoseEventDoc extends Document {
  userId: mongoose.Types.ObjectId;
  medicationId: mongoose.Types.ObjectId;
  dayKey: string;
  /** "08:00" for a planned dose, "prn" for an as-needed dose, "unscheduled" for an imported one. */
  slot: string;
  status: DoseStatus;
  at: Date;
  source: DoseSource;
  clientId: string;
  nameSnapshot: string;
  note?: string;
  /** When the device made the change; a stale offline edit never overwrites a newer one. */
  clientUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DoseEventSchema = new Schema<IDoseEventDoc>(
  {
    userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    medicationId: { type: Schema.Types.ObjectId, ref: 'Medication', required: true },
    dayKey:       { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    slot:         { type: String, required: true, maxlength: 16 },
    status:       { type: String, enum: ['taken', 'skipped', 'extra'], required: true },
    at:           { type: Date, required: true },
    source:       { type: String, enum: ['notification', 'checklist', 'backfill', 'import', 'ai'], required: true },
    clientId:     { type: String, required: true, maxlength: 120 },
    nameSnapshot: { type: String, required: true, maxlength: 100 },
    note:         { type: String, maxlength: 300 },
    clientUpdatedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

DoseEventSchema.index({ userId: 1, clientId: 1 }, { unique: true });
DoseEventSchema.index({ userId: 1, dayKey: 1 });
DoseEventSchema.index({ userId: 1, medicationId: 1, dayKey: 1, slot: 1 });
DoseEventSchema.index({ userId: 1, updatedAt: 1 });

export const DoseEvent: Model<IDoseEventDoc> = mongoose.model<IDoseEventDoc>('DoseEvent', DoseEventSchema);
