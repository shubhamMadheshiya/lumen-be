import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITaskListDoc extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TaskListSchema = new Schema<ITaskListDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, maxlength: 100 },
    icon: { type: String, default: '📋', maxlength: 50 },
    color: { type: String, default: '#4A90E2', maxlength: 20 },
    sortOrder: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const TaskList: Model<ITaskListDoc> = mongoose.model<ITaskListDoc>('TaskList', TaskListSchema);
