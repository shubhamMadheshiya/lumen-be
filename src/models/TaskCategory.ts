import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITaskCategoryDoc extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaskCategorySchema = new Schema<ITaskCategoryDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, maxlength: 50 },
    color: { type: String, default: '#007AFF', maxlength: 20 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const TaskCategory: Model<ITaskCategoryDoc> = mongoose.model<ITaskCategoryDoc>('TaskCategory', TaskCategorySchema);
