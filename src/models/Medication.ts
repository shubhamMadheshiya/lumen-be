import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMedicationDoc extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  dose?: string;
  unit?: string;
  schedule?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MedicationSchema = new Schema<IMedicationDoc>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:     { type: String, required: true, maxlength: 100 },
    dose:     { type: String, maxlength: 50 },
    unit:     { type: String, maxlength: 20 },
    schedule: { type: String, maxlength: 200 },
    active:   { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Medication: Model<IMedicationDoc> = mongoose.model<IMedicationDoc>('Medication', MedicationSchema);
