import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { Task } from '../models/Task';
import { TaskList } from '../models/TaskList';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateTaskListSchema,
  UpdateTaskListSchema,
} from '../shared/schemas';

export const tasksRouter = Router();
tasksRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// ─────────────────────────────────────────────────────────────
// TASK LISTS
// ─────────────────────────────────────────────────────────────

// GET /api/v1/tasks/lists - get all task lists
tasksRouter.get('/lists', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const lists = await TaskList.find({ userId }).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ success: true, data: lists });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/tasks/lists - create a task list
tasksRouter.post('/lists', validate(CreateTaskListSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const list = await TaskList.create({ ...req.body, userId });
    res.status(201).json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/tasks/lists/:id - update a task list
tasksRouter.patch('/lists/:id', validate(UpdateTaskListSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const list = await TaskList.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true }
    );
    if (!list) {
      return res.status(404).json({ success: false, message: 'Task list not found' });
    }
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/tasks/lists/:id - delete a task list
tasksRouter.delete('/lists/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const list = await TaskList.findOneAndDelete({ _id: req.params.id, userId });
    if (!list) {
      return res.status(404).json({ success: false, message: 'Task list not found' });
    }
    // Dissociate tasks in this list rather than deleting them
    await Task.updateMany({ userId, listId: req.params.id }, { $unset: { listId: '' } });
    res.json({ success: true, message: 'Task list deleted' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// SUGGESTIONS (Microsoft To Do style lightbulb drawer)
// ─────────────────────────────────────────────────────────────

// GET /api/v1/tasks/suggestions
tasksRouter.get('/suggestions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const todayStr = (req.query.today as string) || new Date().toISOString().slice(0, 10);

    // 1. Overdue tasks: dueDate < today and not completed
    const overdue = await Task.find({
      userId,
      isCompleted: false,
      dueDate: { $lt: todayStr, $ne: '' },
    }).sort({ dueDate: 1 }).limit(10);

    // 2. Due today but not yet in My Day: dueDate === today and inMyDay: false
    const dueToday = await Task.find({
      userId,
      isCompleted: false,
      dueDate: todayStr,
      inMyDay: false,
    }).sort({ isImportant: -1, createdAt: -1 }).limit(10);

    // 3. Important tasks not in My Day
    const important = await Task.find({
      userId,
      isCompleted: false,
      isImportant: true,
      inMyDay: false,
    }).sort({ createdAt: -1 }).limit(10);

    // 4. Recently added tasks not in My Day
    const recent = await Task.find({
      userId,
      isCompleted: false,
      inMyDay: false,
      dueDate: { $exists: false },
    }).sort({ createdAt: -1 }).limit(10);

    res.json({
      success: true,
      data: {
        overdue,
        dueToday,
        important,
        recent,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// TASKS CRUD
// ─────────────────────────────────────────────────────────────

// GET /api/v1/tasks - get tasks with filtering
tasksRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { filter, listId, energyCost, includeCompleted, search, today } = req.query;

    if (today && typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
      // Auto-prune tasks from previous tracking days to maintain clean slate in sync with client
      await Task.updateMany(
        { userId, inMyDay: true, myDayDate: { $exists: true, $ne: today } },
        { $set: { inMyDay: false } }
      );
    }

    const query: Record<string, unknown> = { userId };

    if (filter === 'my-day') {
      query.inMyDay = true;
    } else if (filter === 'important') {
      query.isImportant = true;
    } else if (filter === 'planned') {
      query.dueDate = { $exists: true, $ne: '' };
    } else if (filter === 'completed') {
      query.isCompleted = true;
    }

    if (listId) {
      query.listId = listId;
    }

    if (energyCost && ['gentle', 'moderate', 'demanding'].includes(energyCost as string)) {
      query.energyCost = energyCost;
    }

    if (filter !== 'completed') {
      if (includeCompleted === 'true') {
        // include both
      } else if (includeCompleted === 'false' || !includeCompleted) {
        query.isCompleted = false;
      }
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      query.title = { $regex: search.trim(), $options: 'i' };
    }

    const tasks = await Task.find(query).sort({ sortOrder: 1, isImportant: -1, createdAt: -1 });
    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/tasks - create task
tasksRouter.post('/', validate(CreateTaskSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = req.body;

    const task = await Task.create({
      ...body,
      userId,
      isCompleted: body.isCompleted || false,
      completedAt: body.isCompleted ? new Date() : undefined,
    });

    res.status(201).json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/tasks/:id - get single task
tasksRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const task = await Task.findOne({ _id: req.params.id, userId });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/tasks/:id - update task
tasksRouter.patch('/:id', validate(UpdateTaskSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = req.body;

    const updateFields: Record<string, unknown> = { ...body };

    if (body.isCompleted !== undefined) {
      if (body.isCompleted) {
        updateFields.completedAt = new Date();
      } else {
        updateFields.completedAt = null;
      }
    }

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updateFields },
      { new: true }
    );

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/tasks/:id - delete task
tasksRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const task = await Task.findOneAndDelete({ _id: req.params.id, userId });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// STEPS SUB-ITEMS (Microsoft To Do checklist steps)
// ─────────────────────────────────────────────────────────────

// POST /api/v1/tasks/:id/steps - add step to task
tasksRouter.post('/:id/steps', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { title } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Step title is required' });
    }

    const newStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim(),
      completed: false,
    };

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $push: { steps: newStep } },
      { new: true }
    );

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.status(201).json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/tasks/:id/steps/:stepId - update step (toggle completion or rename)
tasksRouter.patch('/:id/steps/:stepId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { stepId } = req.params;
    const { title, completed } = req.body;

    const task = await Task.findOne({ _id: req.params.id, userId });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const step = task.steps.find((s) => s.id === stepId);
    if (!step) {
      return res.status(404).json({ success: false, message: 'Step not found' });
    }

    if (title !== undefined && typeof title === 'string') {
      step.title = title.trim();
    }
    if (completed !== undefined) {
      step.completed = Boolean(completed);
      step.completedAt = step.completed ? new Date() : undefined;
    }

    await task.save();
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/tasks/:id/steps/:stepId - remove step
tasksRouter.delete('/:id/steps/:stepId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { stepId } = req.params;

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $pull: { steps: { id: stepId } } },
      { new: true }
    );

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});
