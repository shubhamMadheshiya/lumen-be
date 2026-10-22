import mongoose from 'mongoose';
import { Task } from '../models/Task';
import { TaskList } from '../models/TaskList';
import { CreateTaskSchema, UpdateTaskSchema, CreateTaskListSchema } from '../shared/schemas';

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
});
