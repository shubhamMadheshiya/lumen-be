import mongoose from 'mongoose';
import { Task } from '../models/Task';
import { TaskList } from '../models/TaskList';
import { TaskListGroup } from '../models/TaskListGroup';
import { TaskCategory } from '../models/TaskCategory';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateTaskListSchema,
  UpdateTaskListSchema,
  CreateTaskListGroupSchema,
  CreateTaskCategorySchema,
} from '../shared/schemas';

describe('Server Models & Schemas: Microsoft To Do Tasks', () => {
  it('validates a comprehensive CreateTaskSchema payload', () => {
    const validTask = {
      title: 'Take morning electrolytes and pacing rest',
      notes: 'Dissolve in 500ml water, rest 15 mins after.',
      isCompleted: false,
      isImportant: true,
      inMyDay: true,
      myDayDate: '2026-10-22',
      dueDate: '2026-10-22',
      reminderTime: '2026-10-22T08:00:00.000Z',
      repeat: {
        frequency: 'daily' as const,
      },
      energyCost: 'gentle' as const,
      steps: [
        { id: 's1', title: 'Prepare water bottle', completed: true },
        { id: 's2', title: 'Add electrolyte tablet', completed: false },
      ],
      sortOrder: 1,
    };

    const parsed = CreateTaskSchema.safeParse(validTask);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe(validTask.title);
      expect(parsed.data.energyCost).toBe('gentle');
      expect(parsed.data.steps).toHaveLength(2);
    }
  });

  it('rejects invalid energyCost in CreateTaskSchema', () => {
    const invalidTask = {
      title: 'Invalid task',
      energyCost: 'extreme_workout', // not in gentle | moderate | demanding
    };

    const parsed = CreateTaskSchema.safeParse(invalidTask);
    expect(parsed.success).toBe(false);
  });

  it('validates a complete Task Mongoose model instance', () => {
    const userId = new mongoose.Types.ObjectId();
    const task = new Task({
      userId,
      title: 'Physical Therapy session',
      notes: 'Focus on vagus nerve stimulation exercises',
      isCompleted: false,
      isImportant: true,
      inMyDay: true,
      myDayDate: '2026-10-22',
      dueDate: '2026-10-22',
      energyCost: 'moderate',
      steps: [
        { id: 'step_1', title: 'Gentle neck stretches', completed: false },
        { id: 'step_2', title: 'Box breathing (5 min)', completed: false },
      ],
    });

    const err = task.validateSync();
    expect(err).toBeUndefined();
    expect(task.title).toBe('Physical Therapy session');
    expect(task.energyCost).toBe('moderate');
    expect(task.steps.length).toBe(2);
  });

  it('validates a TaskList Mongoose model instance', () => {
    const userId = new mongoose.Types.ObjectId();
    const list = new TaskList({
      userId,
      name: 'Health & Recovery',
      icon: '🌿',
      color: '#10B981',
      sortOrder: 0,
      isDefault: false,
    });

    const err = list.validateSync();
    expect(err).toBeUndefined();
    expect(list.name).toBe('Health & Recovery');
    expect(list.icon).toBe('🌿');
  });

  it('validates CreateTaskListSchema payload', () => {
    const validList = {
      name: 'Work Routines',
      icon: '💼',
      color: '#3B82F6',
    };

    const parsed = CreateTaskListSchema.safeParse(validList);
    expect(parsed.success).toBe(true);
  });

  it('accepts a client generated 24-hex _id and rejects a temp id', () => {
    const id = new mongoose.Types.ObjectId().toHexString();
    expect(CreateTaskSchema.safeParse({ _id: id, title: 'x' }).success).toBe(true);
    expect(CreateTaskSchema.safeParse({ _id: 'temp_123', title: 'x' }).success).toBe(false);
    expect(CreateTaskSchema.safeParse({ title: 'x', listId: 'list_123' }).success).toBe(false);
  });

  it('lets UpdateTaskSchema clear fields with null', () => {
    const parsed = UpdateTaskSchema.safeParse({
      dueDate: null,
      reminderTime: null,
      repeat: null,
      energyCost: null,
      listId: null,
      myDayDate: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dueDate).toBeNull();
      expect(parsed.data.repeat).toBeNull();
    }
  });

  it('does not apply create defaults on a partial update', () => {
    const parsed = UpdateTaskSchema.safeParse({ title: 'renamed' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ title: 'renamed' });
    }
  });

  it('allows yearly repeat, categories and fractional sortOrder', () => {
    const parsed = CreateTaskSchema.safeParse({
      title: 'Renew prescription',
      repeat: { frequency: 'yearly', interval: 1 },
      categories: ['Doctor'],
      sortOrder: 1.5,
    });
    expect(parsed.success).toBe(true);
  });

  it('lets a list leave its group with groupId null', () => {
    expect(UpdateTaskListSchema.safeParse({ groupId: null }).success).toBe(true);
  });

  it('validates group and category payloads and models', () => {
    expect(CreateTaskListGroupSchema.safeParse({ name: 'Health admin' }).success).toBe(true);
    expect(CreateTaskListGroupSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateTaskCategorySchema.safeParse({ name: 'Doctor', color: '#FF3B30' }).success).toBe(true);
    expect(CreateTaskCategorySchema.safeParse({ name: 'Doctor', color: 'red' }).success).toBe(false);

    const userId = new mongoose.Types.ObjectId();
    expect(new TaskListGroup({ userId, name: 'Health admin' }).validateSync()).toBeUndefined();
    expect(new TaskCategory({ userId, name: 'Doctor' }).validateSync()).toBeUndefined();
    const task = new Task({ userId, title: 'x', categories: ['Doctor'], repeat: { frequency: 'yearly' } });
    expect(task.validateSync()).toBeUndefined();
    expect(task.categories).toEqual(['Doctor']);
  });
});
