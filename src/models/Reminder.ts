import mongoose, { Schema, Document, Model } from 'mongoose';
import { ReminderCategory, ReminderScheduleType, WeekDay } from '@lumen/shared';

export interface IReminderDoc extends Document {
  userId: mongoose.Types.ObjectId;
  clientId?: string;
  name: string;
  description?: string;
  icon: string;
  category: ReminderCategory;
  scheduleType: ReminderScheduleType;
  
  targetTime?: string;
  targetDate?: string;
  daysOfWeek?: WeekDay[];
  
  intervalMinutes?: number;
  windowStartTime?: string;
  windowEndTime?: string;
  
  inactivityThresholdMinutes?: number;
  
  notificationTitle?: string;
  notificationMessage: string;
  snoozeDurationMinutes: number;
  
  linkedQuickActionId?: mongoose.Types.ObjectId;
  linkedQuestionId?: mongoose.Types.ObjectId;
  
  // Legacy / fallback fields
  type?: 'time' | 'inactivity';
  schedule?: string;
  inactivityMinutes?: number;
  message?: string;
  isActive?: boolean;

  enabled: boolean;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReminderSchema = new Schema<IReminderDoc>(
  {
    userId:                     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId:                   { type: String },
    name:                       { type: String, required: true, default: 'Reminder' },
    description:                { type: String },
    icon:                       { type: String, default: '⏰' },
    category:                   {
      type: String,
      enum: ['SLEEP', 'HYDRATION', 'MOVEMENT', 'FOOD', 'MEDICATION', 'EXERCISE', 'WELLNESS', 'SYMPTOM_TRACKING', 'PERSONAL', 'CUSTOM'],
      default: 'CUSTOM',
    },
    scheduleType:               {
      type: String,
      enum: ['ONE_TIME', 'DAILY', 'WEEKLY', 'CUSTOM_DAYS', 'INTERVAL', 'INACTIVITY', 'MISSED_TRACKING', 'GOAL_BASED', 'CUSTOM'],
      default: 'DAILY',
    },
    targetTime:                 { type: String },
    targetDate:                 { type: String },
    daysOfWeek:                 [{ type: String, enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] }],
    intervalMinutes:            { type: Number },
    windowStartTime:            { type: String },
    windowEndTime:              { type: String },
    inactivityThresholdMinutes: { type: Number },
    notificationTitle:          { type: String },
    notificationMessage:        { type: String, required: true, maxlength: 300 },
    snoozeDurationMinutes:      { type: Number, default: 10 },
    linkedQuickActionId:        { type: Schema.Types.ObjectId, ref: 'QuickAction' },
    linkedQuestionId:           { type: Schema.Types.ObjectId, ref: 'Question' },
    
    // Legacy support
    type:                       { type: String, enum: ['time', 'inactivity'] },
    schedule:                   { type: String },
    inactivityMinutes:          { type: Number },
    message:                    { type: String },
    isActive:                   { type: Boolean },

    enabled:                    { type: Boolean, default: true },
    archivedAt:                 { type: Date },
  },
  { timestamps: true }
);

ReminderSchema.index({ userId: 1, enabled: 1 });
ReminderSchema.index({ userId: 1, clientId: 1 });

export const Reminder: Model<IReminderDoc> = mongoose.model<IReminderDoc>('Reminder', ReminderSchema);
