import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITaskListGroupDoc extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaskListGroupSchema = new Schema<ITaskListGroupDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, maxlength: 100 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const TaskListGroup: Model<ITaskListGroupDoc> = mongoose.model<ITaskListGroupDoc>('TaskListGroup', TaskListGroupSchema);
