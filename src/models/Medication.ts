import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMedicationChange {
  at: string; // YYYY-MM-DD Lumen day the change happened
  kind: 'started' | 'stopped' | 'dose_changed';
  note?: string;
}

/** A planned dose time: "08:00" plus an optional amount ("1 tablet"). */
export interface IDoseTime { slot: string; amount?: string }

/** The dose plan from a given Lumen day on, so past days keep the plan that applied then. */
export interface IScheduleVersion {
  from: string; // YYYY-MM-DD
  doseTimes: IDoseTime[];
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  daysOfWeek: number[];
  prn: boolean;
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
  /** "As needed": never expected, so never counted as skipped. */
  prn: boolean;
  doseTimes: IDoseTime[];
  daysOfWeek: number[];
  scheduleHistory: IScheduleVersion[];
  createdAt: Date;
  updatedAt: Date;
}

const MedicationChangeSchema = new Schema<IMedicationChange>({
  at:   { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  kind: { type: String, enum: ['started', 'stopped', 'dose_changed'], required: true },
  note: { type: String, maxlength: 200 },
}, { _id: false });

const DoseTimeSchema = new Schema<IDoseTime>({
  slot:   { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  amount: { type: String, maxlength: 40 },
}, { _id: false });

const ScheduleVersionSchema = new Schema<IScheduleVersion>({
  from:       { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  doseTimes:  { type: [DoseTimeSchema], default: [] },
  daysOfWeek: { type: [Number], default: [] },
  prn:        { type: Boolean, default: false },
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
    prn:       { type: Boolean, default: false },
    doseTimes: { type: [DoseTimeSchema], default: [] },
    daysOfWeek:{ type: [Number], default: [] },
    scheduleHistory: { type: [ScheduleVersionSchema], default: [] },
  },
  { timestamps: true },
);

export const Medication: Model<IMedicationDoc> = mongoose.model<IMedicationDoc>('Medication', MedicationSchema);
