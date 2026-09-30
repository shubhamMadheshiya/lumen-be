import mongoose, { Schema, Document, Model } from 'mongoose';

const FieldValueSchema = new Schema({
  fieldKey:      { type: String, required: true },
  dataType:      { type: String, required: true },
  value:         { type: Schema.Types.Mixed },
  unit:          { type: String },
  canonicalValue:{ type: Number }, // in base unit
}, { _id: false });

const AnswerSchema = new Schema({
  optionId:           { type: Schema.Types.ObjectId, required: true },
  optionLabelSnapshot:{ type: String, required: true }, // de-normalised; survives option rename/archive
  values:             [FieldValueSchema],
  comment:            { type: String, maxlength: 1000 },
  otherText:          { type: String, maxlength: 500 },
}, { _id: false });

export interface ILogEntryDoc extends Document {
  userId: mongoose.Types.ObjectId;
  clientId: string;                // UUID from the device — used for dedup on sync
  daySessionId?: mongoose.Types.ObjectId;
  source: 'quick_action' | 'questionnaire' | 'check_in' | 'reminder' | 'activity';
  categoryId?: mongoose.Types.ObjectId;
  questionId?: mongoose.Types.ObjectId;
  questionVersion?: number;
  quickActionId?: mongoose.Types.ObjectId;
  activitySessionId?: mongoose.Types.ObjectId;
  reminderId?: mongoose.Types.ObjectId;
  occurredAt: Date;
  loggedAt: Date;
  timezone: string;
  answers: Array<{
    optionId: mongoose.Types.ObjectId;
    optionLabelSnapshot: string;
    values: Array<{ fieldKey: string; dataType: string; value: unknown; unit?: string; canonicalValue?: number }>;
    comment?: string;
    otherText?: string;
  }>;
  mediaIds: mongoose.Types.ObjectId[];
  note?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LogEntrySchema = new Schema<ILogEntryDoc>(
  {
    userId:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId:        { type: String, required: true },
    daySessionId:    { type: Schema.Types.ObjectId, ref: 'DaySession' },
    source:          { type: String, enum: ['quick_action', 'questionnaire', 'check_in', 'reminder', 'activity'], required: true },
    categoryId:      { type: Schema.Types.ObjectId, ref: 'Category' },
    questionId:      { type: Schema.Types.ObjectId, ref: 'Question' },
    questionVersion: { type: Number },
    quickActionId:   { type: Schema.Types.ObjectId, ref: 'QuickAction' },
    activitySessionId: { type: Schema.Types.ObjectId, ref: 'ActivitySession' },
    reminderId:      { type: Schema.Types.ObjectId, ref: 'Reminder' },
    occurredAt:      { type: Date, required: true },
    loggedAt:        { type: Date, required: true, default: () => new Date() },
    timezone:        { type: String, required: true },
    answers:         [AnswerSchema],
    mediaIds:        [{ type: Schema.Types.ObjectId, ref: 'Media' }],
    note:            { type: String, maxlength: 2000 },
    deletedAt:       { type: Date },
  },
  { timestamps: true },
);

// Primary query patterns
LogEntrySchema.index({ userId: 1, occurredAt: -1 });
LogEntrySchema.index({ userId: 1, categoryId: 1, occurredAt: -1 });
LogEntrySchema.index({ userId: 1, quickActionId: 1, occurredAt: -1 });
// Dedup on sync
LogEntrySchema.index({ userId: 1, clientId: 1 }, { unique: true });

export const LogEntry: Model<ILogEntryDoc> = mongoose.model<ILogEntryDoc>('LogEntry', LogEntrySchema);
