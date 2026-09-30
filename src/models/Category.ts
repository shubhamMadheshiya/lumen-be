import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICategoryDoc extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  icon: string;
  color: string;
  role: 'trigger_candidate' | 'symptom' | 'context';
  order: number;
  isActive: boolean;
  archivedAt?: Date;
  templateKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategoryDoc>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:        { type: String, required: true, maxlength: 60 },
    icon:        { type: String, required: true, maxlength: 100 },
    color:       { type: String, required: true, match: /^#[0-9A-Fa-f]{6}$/ },
    role:        { type: String, enum: ['trigger_candidate', 'symptom', 'context'], required: true },
    order:       { type: Number, default: 0 },
    isActive:    { type: Boolean, default: true },
    archivedAt:  { type: Date },
    templateKey: { type: String, index: true },
  },
  { timestamps: true },
);

CategorySchema.index({ userId: 1, order: 1 });
CategorySchema.index({ userId: 1, templateKey: 1 });

export const Category: Model<ICategoryDoc> = mongoose.model<ICategoryDoc>('Category', CategorySchema);
