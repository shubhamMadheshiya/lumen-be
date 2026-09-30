import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IQuestionDoc extends Document {
  userId: mongoose.Types.ObjectId;
  categoryId: mongoose.Types.ObjectId;
  title: string;
  helpText?: string;
  icon?: string;
  color?: string;
  selectionType: 'single' | 'multiple';
  allowOther: boolean;
  required: boolean;
  frequency: 'anytime' | 'once_per_day' | 'per_meal' | 'morning' | 'evening';
  conditionalDisplay?: {
    questionId: mongoose.Types.ObjectId;
    optionId: mongoose.Types.ObjectId;
  };
  order: number;
  version: number;
  isActive: boolean;
  archivedAt?: Date;
  templateKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema<IQuestionDoc>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    categoryId:  { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    title:       { type: String, required: true, maxlength: 200 },
    helpText:    { type: String, maxlength: 500 },
    icon:        { type: String, maxlength: 100 },
    color:       { type: String, match: /^#[0-9A-Fa-f]{6}$/ },
    selectionType: { type: String, enum: ['single', 'multiple'], required: true },
    allowOther:  { type: Boolean, default: false },
    required:    { type: Boolean, default: false },
    frequency:   { type: String, enum: ['anytime', 'once_per_day', 'per_meal', 'morning', 'evening'], default: 'anytime' },
    conditionalDisplay: {
      questionId: { type: Schema.Types.ObjectId },
      optionId:   { type: Schema.Types.ObjectId },
    },
    order:       { type: Number, default: 0 },
    version:     { type: Number, default: 1 },
    isActive:    { type: Boolean, default: true },
    archivedAt:  { type: Date },
    templateKey: { type: String },
  },
  { timestamps: true },
);

QuestionSchema.index({ userId: 1, categoryId: 1, order: 1 });
QuestionSchema.index({ userId: 1, templateKey: 1 });

export const Question: Model<IQuestionDoc> = mongoose.model<IQuestionDoc>('Question', QuestionSchema);
