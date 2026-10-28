import mongoose, { Schema, Document, Model } from 'mongoose';
import { HealthRecordType, IBiomarker, IPrescribedMedication } from '../shared/types';

export interface IHealthRecordDoc extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  type: HealthRecordType;
  date: Date;
  doctorName?: string;
  clinicOrLab?: string;
  mediaIds: mongoose.Types.ObjectId[];
  fileUrls?: string[];
  fileNames?: string[];
  notes?: string;
  isSensitive: boolean;
  biomarkers?: IBiomarker[];
  medications?: IPrescribedMedication[];
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const BiomarkerSchema = new Schema(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    unit: { type: String },
    referenceRange: { type: String },
    flag: { type: String, enum: ['normal', 'high', 'low', 'critical'], default: 'normal' },
  },
  { _id: false },
);

const PrescribedMedicationSchema = new Schema(
  {
    name: { type: String, required: true },
    dosage: { type: String },
    frequency: { type: String },
    instructions: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    isActive: { type: Boolean, default: true },
    refills: { type: Number, default: 0 },
  },
  { _id: false },
);

const HealthRecordSchema = new Schema<IHealthRecordDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['blood_test', 'doctor_prescription', 'imaging', 'doctor_note'],
      required: true,
      index: true,
    },
    date: { type: Date, required: true, index: true },
    doctorName: { type: String, trim: true },
    clinicOrLab: { type: String, trim: true },
    mediaIds: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
    fileUrls: [{ type: String }],
    fileNames: [{ type: String }],
    notes: { type: String },
    isSensitive: { type: Boolean, default: false },
    biomarkers: [BiomarkerSchema],
    medications: [PrescribedMedicationSchema],
    tags: [{ type: String, trim: true }],
  },
  { timestamps: true },
);

HealthRecordSchema.index({ userId: 1, date: -1 });
HealthRecordSchema.index({ userId: 1, type: 1 });

export const HealthRecord: Model<IHealthRecordDoc> = mongoose.model<IHealthRecordDoc>(
  'HealthRecord',
  HealthRecordSchema,
);
