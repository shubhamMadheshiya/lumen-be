import mongoose, { Schema, Document, Model } from 'mongoose';

export const REPORT_REASONS = ['spam', 'harassment', 'harmful_advice', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A member reports a message to the staff of its server. The text is copied so edits cannot hide it. */
export interface ICommunityReportDoc extends Document {
  reporterId: mongoose.Types.ObjectId;
  messageId: mongoose.Types.ObjectId;
  channelId: mongoose.Types.ObjectId;
  serverId?: mongoose.Types.ObjectId;
  reason: ReportReason;
  note?: string;
  snippet: string;
  senderLabel: string;
  status: 'open' | 'dismissed' | 'actioned';
  createdAt: Date;
}

const CommunityReportSchema = new Schema<ICommunityReportDoc>(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'CommunityMessage', required: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'CommunityChannel', required: true },
    serverId: { type: Schema.Types.ObjectId, ref: 'CommunityServer', index: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    note: { type: String, maxlength: 300 },
    snippet: { type: String, default: '', maxlength: 300 },
    senderLabel: { type: String, default: '', maxlength: 80 },
    status: { type: String, enum: ['open', 'dismissed', 'actioned'], default: 'open' },
  },
  { timestamps: true }
);
CommunityReportSchema.index({ reporterId: 1, messageId: 1 }, { unique: true });

export const CommunityReport: Model<ICommunityReportDoc> =
  mongoose.model<ICommunityReportDoc>('CommunityReport', CommunityReportSchema);
