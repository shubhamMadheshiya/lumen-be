import mongoose, { Schema, Document, Model } from 'mongoose';
import { ITaskRepeat, TaskEnergyCost } from '../shared/types';

export interface ITaskStepDoc {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: Date;
}

export interface ITaskDoc extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  notes?: string;
  isCompleted: boolean;
  completedAt?: Date;
  isImportant: boolean;
  inMyDay: boolean;
  myDayDate?: string;
  dueDate?: string;
  reminderTime?: string;
  repeat?: ITaskRepeat;
  energyCost?: TaskEnergyCost;
  listId?: mongoose.Types.ObjectId;
  steps: ITaskStepDoc[];
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaskStepSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true, maxlength: 300 },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { _id: false }
);

const TaskRepeatSchema = new Schema(
  {
    frequency: { type: String, enum: ['daily', 'weekdays', 'weekly', 'monthly', 'custom'], required: true },
    interval: { type: Number, min: 1 },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
  },
  { _id: false }
);

const TaskSchema = new Schema<ITaskDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, maxlength: 300 },
    notes: { type: String, maxlength: 5000 },
    isCompleted: { type: Boolean, default: false, index: true },
    completedAt: { type: Date },
    isImportant: { type: Boolean, default: false, index: true },
    inMyDay: { type: Boolean, default: false, index: true },
    myDayDate: { type: String, index: true },
    dueDate: { type: String, index: true },
    reminderTime: { type: String },
    repeat: { type: TaskRepeatSchema },
    energyCost: { type: String, enum: ['gentle', 'moderate', 'demanding'] },
    listId: { type: Schema.Types.ObjectId, ref: 'TaskList', index: true },
    steps: { type: [TaskStepSchema], default: [] },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Task: Model<ITaskDoc> = mongoose.model<ITaskDoc>('Task', TaskSchema);
