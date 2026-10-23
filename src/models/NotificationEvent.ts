import mongoose, { Schema, Document, Model } from 'mongoose';
import { NotificationStatus } from '../shared';

export interface INotificationEventDoc extends Document {
  userId: mongoose.Types.ObjectId;
  reminderId?: mongoose.Types.ObjectId;
  clientId: string;
  scheduledFor: Date;
  triggeredAt?: Date;
  status: NotificationStatus;
  respondedAt?: Date;
  actionTaken?: string;
  linkedLogEntryId?: mongoose.Types.ObjectId;
  notificationType?: string;
  feedback?: 'helpful' | 'not_useful';
  createdAt: Date;
  updatedAt: Date;
}

const NotificationEventSchema = new Schema<INotificationEventDoc>(
  {
    userId:           { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Optional: intelligent notifications are not tied to a user-set reminder.
    reminderId:       { type: Schema.Types.ObjectId, ref: 'Reminder', index: true },
    clientId:         { type: String, required: true },
    scheduledFor:     { type: Date, required: true },
    triggeredAt:      { type: Date },
    status:           {
      type: String,
      enum: ['TRIGGERED', 'COMPLETED', 'SNOOZED', 'DISMISSED', 'MISSED'],
      default: 'TRIGGERED',
      required: true,
    },
    respondedAt:      { type: Date },
    actionTaken:      { type: String },
    linkedLogEntryId: { type: Schema.Types.ObjectId, ref: 'LogEntry' },
    notificationType: { type: String },
    feedback:         { type: String, enum: ['helpful', 'not_useful'] },
  },
  { timestamps: true }
);

NotificationEventSchema.index({ userId: 1, reminderId: 1, scheduledFor: -1 });
NotificationEventSchema.index({ userId: 1, notificationType: 1, scheduledFor: -1 });

export const NotificationEvent: Model<INotificationEventDoc> =
  mongoose.model<INotificationEventDoc>('NotificationEvent', NotificationEventSchema);
