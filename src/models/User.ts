import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUserDoc extends Document {
  email: string;
  passwordHash?: string;
  googleId?: string;
  name: string;
  conditions: string[];
  preferences: {
    units: 'metric' | 'imperial';
    tempUnit: 'C' | 'F';
    timezone: string;
    theme: 'light' | 'dark' | 'system';
    dayBoundaryHour: number;
  };
  consentAcceptedAt?: Date;
  configVersion: number;
  comparePassword(candidate: string): Promise<boolean>;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDoc>(
  {
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: false, select: false },
    googleId:     { type: String, select: false },
    name:         { type: String, required: true, trim: true, maxlength: 80 },
    conditions:   [{ type: String }],
    preferences: {
      units:           { type: String, enum: ['metric', 'imperial'], default: 'metric' },
      tempUnit:        { type: String, enum: ['C', 'F'], default: 'C' },
      timezone:        { type: String, default: 'UTC' },
      theme:           { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      dayBoundaryHour: { type: Number, default: 4, min: 0, max: 12 },
    },
    consentAcceptedAt: { type: Date },
    configVersion:     { type: Number, default: 1 },
  },
  { timestamps: true },
);

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidate, this.passwordHash);
};

UserSchema.index({ googleId: 1 }, { sparse: true });


export const User: Model<IUserDoc> = mongoose.model<IUserDoc>('User', UserSchema);
