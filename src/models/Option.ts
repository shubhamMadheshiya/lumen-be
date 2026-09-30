import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Embedded FieldDefinition ──────────────────

const EnumValueSchema = new Schema({
  value:       { type: String, required: true },
  label:       { type: String, required: true },
  icon:        { type: String },
  color:       { type: String },
  description: { type: String },
}, { _id: false });

const FieldDefinitionSchema = new Schema({
  key:          { type: String, required: true, maxlength: 50 },
  label:        { type: String, required: true, maxlength: 100 },
  dataType:     {
    type: String,
    enum: ['time','datetime','duration','temperature','range','number','string','enum','boolean','image','location'],
    required: true,
  },
  unit:         { type: String },
  allowedUnits: [{ type: String }],
  min:          { type: Number },
  max:          { type: Number },
  step:         { type: Number },
  enumValues:   [EnumValueSchema],
  defaultValue: { type: Schema.Types.Mixed },
  required:     { type: Boolean, default: false },
  placeholder:  { type: String },
  helpText:     { type: String },
  displayAs:    {
    type: String,
    enum: ['slider','stepper','chips','dropdown','text','picker','color-swatch','image-grid','toggle','camera','body-map'],
  },
}, { _id: false });

// ── IOptionDoc ────────────────────────────────

export interface IOptionDoc extends Document {
  userId: mongoose.Types.ObjectId;
  questionId: mongoose.Types.ObjectId;
  label: string;
  icon?: string;
  color?: string;
  allowComment: boolean;
  captureTime: 'none' | 'auto_now' | 'user_picks';
  fields: Array<{
    key: string;
    label: string;
    dataType: string;
    unit?: string;
    allowedUnits?: string[];
    min?: number;
    max?: number;
    step?: number;
    enumValues?: Array<{ value: string; label: string; icon?: string; color?: string; description?: string }>;
    defaultValue?: unknown;
    required?: boolean;
    placeholder?: string;
    helpText?: string;
    displayAs?: string;
  }>;
  order: number;
  isActive: boolean;
  archivedAt?: Date;
  templateKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OptionSchema = new Schema<IOptionDoc>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questionId:  { type: Schema.Types.ObjectId, ref: 'Question', required: true, index: true },
    label:       { type: String, required: true, maxlength: 100 },
    icon:        { type: String, maxlength: 100 },
    color:       { type: String, match: /^#[0-9A-Fa-f]{6}$/ },
    allowComment:{ type: Boolean, default: false },
    captureTime: { type: String, enum: ['none', 'auto_now', 'user_picks'], default: 'none' },
    fields:      [FieldDefinitionSchema],
    order:       { type: Number, default: 0 },
    isActive:    { type: Boolean, default: true },
    archivedAt:  { type: Date },
    templateKey: { type: String },
  },
  { timestamps: true },
);

OptionSchema.index({ userId: 1, questionId: 1, order: 1 });
OptionSchema.index({ userId: 1, templateKey: 1 });

export const Option: Model<IOptionDoc> = mongoose.model<IOptionDoc>('Option', OptionSchema);
