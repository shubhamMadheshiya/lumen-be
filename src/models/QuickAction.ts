import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IQuickActionDoc extends Document {
  userId: mongoose.Types.ObjectId;
  label: string;
  icon: string;
  color: string;
  mode: 'counter' | 'timer' | 'toggle';
  defaultValue?: number;
  unit?: string;
  dailyGoal?: number;
  linkedQuestionId?: mongoose.Types.ObjectId;
  linkedOptionId?: mongoose.Types.ObjectId;
  order: number;
  isVisible: boolean;
  archivedAt?: Date;
  templateKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QuickActionSchema = new Schema<IQuickActionDoc>(
  {
    userId:           { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label:            { type: String, required: true, maxlength: 60 },
    icon:             { type: String, required: true, maxlength: 100 },
    color:            { type: String, required: true, match: /^#[0-9A-Fa-f]{6}$/ },
    mode:             { type: String, enum: ['counter', 'timer', 'toggle'], required: true },
    defaultValue:     { type: Number },
    unit:             { type: String },
    dailyGoal:        { type: Number },
    linkedQuestionId: { type: Schema.Types.ObjectId, ref: 'Question' },
    linkedOptionId:   { type: Schema.Types.ObjectId, ref: 'Option' },
    order:            { type: Number, default: 0 },
    isVisible:        { type: Boolean, default: true },
    archivedAt:       { type: Date },
    templateKey:      { type: String },
  },
  { timestamps: true },
);

QuickActionSchema.index({ userId: 1, order: 1 });

export const QuickAction: Model<IQuickActionDoc> = mongoose.model<IQuickActionDoc>('QuickAction', QuickActionSchema);
