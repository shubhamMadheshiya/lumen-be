import mongoose, { Schema, Document, Model } from 'mongoose';

export const AI_NOTIFICATION_KINDS = ['briefing', 'nudge', 'check_in', 'log_reply', 'test'] as const;
export type AiNotificationKind = (typeof AI_NOTIFICATION_KINDS)[number];

/**
 * A notification Lumen AI wrote for the member. Kept whether or not it was pushed (the budget,
 * quiet hours or flare mode may hold it back), so the app can still show it in "For you today".
 */
export interface IAiNotificationDoc extends Document {
  userId: mongoose.Types.ObjectId;
  kind: AiNotificationKind;
  /** Once-per-slot key: `<kind>:<YYYY-MM-DD>` for scheduled kinds, `log_reply:<entryId>`, `test:<ms>`. */
  slotKey: string;
  /** The member's local day (YYYY-MM-DD) it belongs to. */
  dateKey: string;
  title: string;
  body: string;
  /** In-app route a tap opens. */
  route: string;
  conversationId?: string;
  pushed: boolean;
  /** Why it was not pushed: budget, quiet_hours, flare_mode, no_token, master_off, … */
  reason?: string;
  provider?: string;
  llmModel?: string;
  createdAt: Date;
}

const AiNotificationSchema = new Schema<IAiNotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: AI_NOTIFICATION_KINDS, required: true },
    slotKey: { type: String, required: true },
    dateKey: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 600 },
    route: { type: String, required: true, maxlength: 120 },
    conversationId: { type: String },
    pushed: { type: Boolean, default: false },
    reason: { type: String },
    provider: { type: String },
    llmModel: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AiNotificationSchema.index({ userId: 1, slotKey: 1 }, { unique: true });
AiNotificationSchema.index({ userId: 1, createdAt: -1 });

export const AiNotification: Model<IAiNotificationDoc> =
  mongoose.model<IAiNotificationDoc>('AiNotification', AiNotificationSchema);
