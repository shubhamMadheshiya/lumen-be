import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMedicationChange {
  at: string; // YYYY-MM-DD Lumen day the change happened
  kind: 'started' | 'stopped' | 'dose_changed';
  note?: string;
}

export interface IMedicationDoc extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  dose?: string;
  unit?: string;
  schedule?: string;
  active: boolean;
  /** YYYY-MM-DD Lumen days, for overlaying on the progress trend and "did it help" comparisons. */
  startedOn?: string;
  stoppedOn?: string;
  changes: IMedicationChange[];
  createdAt: Date;
  updatedAt: Date;
}

const MedicationChangeSchema = new Schema<IMedicationChange>({
  at:   { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  kind: { type: String, enum: ['started', 'stopped', 'dose_changed'], required: true },
  note: { type: String, maxlength: 200 },
}, { _id: false });

const MedicationSchema = new Schema<IMedicationDoc>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:      { type: String, required: true, maxlength: 100 },
    dose:      { type: String, maxlength: 50 },
    unit:      { type: String, maxlength: 20 },
    schedule:  { type: String, maxlength: 200 },
    active:    { type: Boolean, default: true },
    startedOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    stoppedOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    changes:   { type: [MedicationChangeSchema], default: [] },
  },
  { timestamps: true },
);

export const Medication: Model<IMedicationDoc> = mongoose.model<IMedicationDoc>('Medication', MedicationSchema);
