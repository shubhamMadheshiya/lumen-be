import mongoose, { Schema, Document, Model } from 'mongoose';

export const INTELLIGENCE_CAPABILITIES = [
  'adaptiveTiming',
  'flareRisk',
  'triggerWatch',
  'pacing',
  'safety',
] as const;
export type IntelligenceCapability = (typeof INTELLIGENCE_CAPABILITIES)[number];

export interface INotificationPolicyDoc extends Document {
  userId: mongoose.Types.ObjectId;
  masterEnabled: boolean;
  dailyBudget: number;
  quietHours: { enabled: boolean; start: string; end: string };
  flareMode: {
    active: boolean;
    auto: boolean;
    source?: 'auto' | 'manual';
    activatedAt?: Date;
  };
  capabilities: Record<IntelligenceCapability, boolean>;
  mutedUntil?: Date;
  suppressedTypes: string[];
  careTeamPhone?: string;
  safetyConsentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationPolicySchema = new Schema<INotificationPolicyDoc>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    masterEnabled: { type: Boolean, default: true },
    dailyBudget:   { type: Number, default: 2, min: 1, max: 5 },
    quietHours: {
      enabled: { type: Boolean, default: true },
      start:   { type: String, default: '22:00', match: /^\d{2}:\d{2}$/ },
      end:     { type: String, default: '07:00', match: /^\d{2}:\d{2}$/ },
    },
    flareMode: {
      active:      { type: Boolean, default: false },
      auto:        { type: Boolean, default: true },
      source:      { type: String, enum: ['auto', 'manual'] },
      activatedAt: { type: Date },
    },
    capabilities: {
      adaptiveTiming: { type: Boolean, default: true },
      flareRisk:      { type: Boolean, default: true },
      triggerWatch:   { type: Boolean, default: true },
      pacing:         { type: Boolean, default: true },
      // Stays off until the patient gives explicit consent in the app.
      safety:         { type: Boolean, default: false },
    },
    mutedUntil:       { type: Date },
    suppressedTypes:  [{ type: String }],
    careTeamPhone:    { type: String, maxlength: 40 },
    safetyConsentAt:  { type: Date },
  },
  { timestamps: true },
);

export const NotificationPolicy: Model<INotificationPolicyDoc> =
  mongoose.model<INotificationPolicyDoc>('NotificationPolicy', NotificationPolicySchema);

export async function getOrCreatePolicy(userId: mongoose.Types.ObjectId): Promise<INotificationPolicyDoc> {
  const existing = await NotificationPolicy.findOne({ userId });
  if (existing) return existing;
  try {
    return await NotificationPolicy.create({ userId });
  } catch (err: any) {
    // Two first-time requests can race on the unique index.
    if (err?.code === 11000) {
      const winner = await NotificationPolicy.findOne({ userId });
      if (winner) return winner;
    }
    throw err;
  }
}
