import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUserDoc extends Document {
  email: string;
  passwordHash?: string;
  photoPinHash?: string;
  googleId?: string;
  name: string;
  conditions: string[];
  age?: number;
  weight?: number;
  gender?: 'male' | 'female' | 'non-binary' | 'other' | 'prefer_not_to_say';
  preferences: {
    units: 'metric' | 'imperial';
    tempUnit: 'C' | 'F';
    timezone: string;
    theme: 'light' | 'dark' | 'system';
    dayBoundaryHour: number;
    /** Off by default: see services/llm. Sends only pattern counts and labels, never notes or raw logs. */
    aiExplanations: boolean;
    /** Lumen AI chat/photo/weekly review may read all of the member's own data. Set only via POST /ai/access. */
    aiFullAccess: boolean;
    /** ...including photos, sensitive ones too. Needs the photo PIN to turn on when one is set. */
    aiPhotoAccess: boolean;
    /** When the member confirmed they read the Gemini free-tier data-use notice. */
    aiFreeTierAcknowledgedAt?: Date;
    /** Lumen AI provider + model the member picked (POST/PATCH /ai/settings only). Unset = Gemini default. */
    aiProvider?: 'gemini' | 'claude';
    aiModel?: string;
    /** When the member confirmed the Claude (paid) notice. */
    aiClaudeAcknowledgedAt?: Date;
    /** Voice chat: Gemini voice name, natural AI voice vs the phone's own, listening language. */
    aiVoice?: { ttsVoice?: string; natural?: boolean; sttLang?: 'en-IN' | 'hi-IN' };
    /** Lumen AI daily health journal (default on while full access is on), and its note. */
    aiJournal?: boolean;
    /** Short status shown on the member's community profile (e.g. low spoons today). */
    communityStatus?: string;
    /** False when the member muted community push notifications. */
    communityPush?: boolean;
    /** Quiet hours (22:00 to 08:00 local) for community push. */
    communityQuiet?: boolean;
    aiJournalNoteId?: string;
    /** Metrics pinned on Insights › Metrics (PUT /analytics/pins only). */
    analyticsPins?: string[];
    /** Rounded (2 decimals, ~1 km) location for the daily weather job (PUT /weather/location only). */
    weatherLocation?: { lat: number; lon: number; updatedAt: Date };
  };
  consentAcceptedAt?: Date;
  lastSeenAt?: Date;
  configVersion: number;
  comparePassword(candidate: string): Promise<boolean>;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDoc>(
  {
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: false, select: false },
    photoPinHash: { type: String, required: false, select: false },
    googleId:     { type: String, select: false },
    name:         { type: String, required: true, trim: true, maxlength: 80 },
    conditions:   [{ type: String }],
    age:          { type: Number, min: 0, max: 130 },
    weight:       { type: Number, min: 0, max: 500 },
    gender:       { type: String, enum: ['male', 'female', 'non-binary', 'other', 'prefer_not_to_say'] },
    preferences: {
      units:           { type: String, enum: ['metric', 'imperial'], default: 'metric' },
      tempUnit:        { type: String, enum: ['C', 'F'], default: 'C' },
      timezone:        { type: String, default: 'UTC' },
      theme:           { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      dayBoundaryHour: { type: Number, default: 4, min: 0, max: 12 },
      aiExplanations:  { type: Boolean, default: false },
      aiFullAccess:    { type: Boolean, default: false },
      aiPhotoAccess:   { type: Boolean, default: false },
      aiFreeTierAcknowledgedAt: { type: Date },
      aiProvider:      { type: String, enum: ['gemini', 'claude'] },
      aiModel:         { type: String, maxlength: 80 },
      aiClaudeAcknowledgedAt: { type: Date },
      aiVoice: {
        ttsVoice: { type: String, maxlength: 40 },
        natural:  { type: Boolean, default: true },
        sttLang:  { type: String, enum: ['en-IN', 'hi-IN'], default: 'en-IN' },
      },
      aiJournal:       { type: Boolean },
      communityStatus: { type: String, maxlength: 60 },
      communityPush:   { type: Boolean },
      communityQuiet:  { type: Boolean },
      /** Show the sender and text on the lock screen (like WhatsApp). Default on. */
      communityLockscreenText: { type: Boolean },
      /** Reciprocal: when off you neither send nor see "seen" ticks. Default on. */
      communityReadReceipts: { type: Boolean },
      /** Reciprocal: when off others don't see when you are online. Default on. */
      communityShowOnline: { type: Boolean },
      aiJournalNoteId: { type: String },
      analyticsPins:   { type: [String], default: undefined },
      weatherLocation: {
        lat:       { type: Number },
        lon:       { type: Number },
        updatedAt: { type: Date },
      },
    },
    /** When the person was last connected to the chat server (shown as last seen, if they allow it). */
    lastSeenAt:        { type: Date },
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
