import mongoose, { Schema, Document, Model } from 'mongoose';

/** One row per user per Lumen day, rebuilt from the raw logs. See services/insights/dayTable.ts. */
export interface IDayFeatureDoc extends Document {
  userId: mongoose.Types.ObjectId;
  dayKey: string; // YYYY-MM-DD of the Lumen day (starts at the Day Reset Boundary)
  symptomObserved: boolean;
  observedBasis: 'symptom_entry' | 'check_in' | 'weak' | 'none';
  exposureObserved: boolean;
  entryCount: number;
  distinctHours: number;
  engagement: number;
  nonSymptomEntries: number;
  symptoms: Array<{ key: string; label: string; present: boolean; max: number | null }>;
  exposures: Array<{ key: string; label: string; count: number; afterSymptomCount: number; firstAt: Date; lastAt: Date }>;
  reactiveCount: number;
  symptomPresent: boolean;
  symptomMax: number | null;
  symptomMean: number | null;
  patientGlobal: number | null;
  noSymptomsCheckIn: boolean;
  explicitFlare: boolean;
  steps: number | null;
  walkMinutes: number | null;
  wakeTime: Date | null;
  sleepTime: Date | null;
  sleepHours: number | null;
  timeZone: string;
  boundaryHour: number;
  version: number;
  builtAt: Date;
}

const SymptomSchema = new Schema({
  key: String, label: String, present: Boolean, max: { type: Number, default: null },
}, { _id: false });

const ExposureSchema = new Schema({
  key: String, label: String, count: Number, afterSymptomCount: Number, firstAt: Date, lastAt: Date,
}, { _id: false });

const DayFeatureSchema = new Schema<IDayFeatureDoc>(
  {
    userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dayKey:            { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    symptomObserved:   { type: Boolean, required: true },
    observedBasis:     { type: String, enum: ['symptom_entry', 'check_in', 'weak', 'none'], required: true },
    exposureObserved:  { type: Boolean, required: true },
    entryCount:        { type: Number, required: true },
    distinctHours:     { type: Number, required: true },
    engagement:        { type: Number, required: true },
    nonSymptomEntries: { type: Number, default: 0 },
    symptoms:          [SymptomSchema],
    exposures:         [ExposureSchema],
    reactiveCount:     { type: Number, default: 0 },
    symptomPresent:    { type: Boolean, required: true },
    symptomMax:        { type: Number, default: null },
    symptomMean:       { type: Number, default: null },
    patientGlobal:     { type: Number, default: null },
    noSymptomsCheckIn: { type: Boolean, default: false },
    explicitFlare:     { type: Boolean, default: false },
    steps:             { type: Number, default: null },
    walkMinutes:       { type: Number, default: null },
    wakeTime:          { type: Date, default: null },
    sleepTime:         { type: Date, default: null },
    sleepHours:        { type: Number, default: null },
    timeZone:          { type: String, required: true },
    boundaryHour:      { type: Number, required: true },
    version:           { type: Number, required: true },
    builtAt:           { type: Date, required: true },
  },
  // A regular collection, not a time-series one: those cannot be upserted or have unique indexes
  { timestamps: false },
);

DayFeatureSchema.index({ userId: 1, dayKey: 1 }, { unique: true });

export const DayFeature: Model<IDayFeatureDoc> = mongoose.model<IDayFeatureDoc>('DayFeature', DayFeatureSchema);
