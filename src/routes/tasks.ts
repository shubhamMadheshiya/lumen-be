import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
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
  UpdateTaskListGroupSchema,
  CreateTaskCategorySchema,
  UpdateTaskCategorySchema,
} from '../shared/schemas';

export const tasksRouter = Router();
tasksRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}


// Ids from old clients could be "temp_..." placeholders; answer 404 instead of a cast error.
tasksRouter.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  next();
});

/** Splits a PATCH body into $set and $unset: null means "clear this field". */
function splitNulls(body: Record<string, unknown>): { $set: Record<string, unknown>; $unset: Record<string, ''> } {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === null) $unset[k] = '';
    else if (v !== undefined) $set[k] = v;
  }
  return { $set, $unset };
}

function update(set: Record<string, unknown>, unset: Record<string, ''>): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (Object.keys(set).length) u.$set = set;
  if (Object.keys(unset).length) u.$unset = unset;
  return u;
}

function dayBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
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
    if (req.body._id) {
      const existing = await TaskList.findOne({ _id: req.body._id, userId });
      if (existing) return res.status(200).json({ success: true, data: existing });
    }
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
    const { $set, $unset } = splitNulls(req.body);
    const list = await TaskList.findOneAndUpdate(
      { _id: req.params.id, userId },
      update($set, $unset),
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
// LIST GROUPS & CATEGORIES
// ─────────────────────────────────────────────────────────────

tasksRouter.get('/groups', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const groups = await TaskListGroup.find({ userId: uid(req) }).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ success: true, data: groups });
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/groups', validate(CreateTaskListGroupSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    if (req.body._id) {
      const existing = await TaskListGroup.findOne({ _id: req.body._id, userId });
      if (existing) return res.status(200).json({ success: true, data: existing });
    }
    const group = await TaskListGroup.create({ ...req.body, userId });
    res.status(201).json({ success: true, data: group });
  } catch (err) {
    next(err);
  }
});

tasksRouter.patch('/groups/:id', validate(UpdateTaskListGroupSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const group = await TaskListGroup.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { $set: req.body },
      { new: true }
    );
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    res.json({ success: true, data: group });
  } catch (err) {
    next(err);
  }
});

// Deleting a group ungroups its lists; the lists and their tasks stay.
tasksRouter.delete('/groups/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const group = await TaskListGroup.findOneAndDelete({ _id: req.params.id, userId });
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    await TaskList.updateMany({ userId, groupId: req.params.id }, { $unset: { groupId: '' } });
    res.json({ success: true, message: 'Group deleted' });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/categories', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cats = await TaskCategory.find({ userId: uid(req) }).sort({ sortOrder: 1, createdAt: 1 });
    res.json({ success: true, data: cats });
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/categories', validate(CreateTaskCategorySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    if (req.body._id) {
      const existing = await TaskCategory.findOne({ _id: req.body._id, userId });
      if (existing) return res.status(200).json({ success: true, data: existing });
    }
    const cat = await TaskCategory.create({ ...req.body, userId });
    res.status(201).json({ success: true, data: cat });
  } catch (err) {
    next(err);
  }
});

tasksRouter.patch('/categories/:id', validate(UpdateTaskCategorySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const cat = await TaskCategory.findOne({ _id: req.params.id, userId });
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
    const oldName = cat.name;
    Object.assign(cat, req.body);
    await cat.save();
    // Tasks store the category name, so a rename has to follow through.
    if (req.body.name && req.body.name !== oldName) {
      await Task.updateMany(
        { userId, categories: oldName },
        { $set: { 'categories.$[c]': req.body.name } },
        { arrayFilters: [{ c: oldName }] }
      );
    }
    res.json({ success: true, data: cat });
  } catch (err) {
    next(err);
  }
});

tasksRouter.delete('/categories/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const cat = await TaskCategory.findOneAndDelete({ _id: req.params.id, userId });
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
    await Task.updateMany({ userId, categories: cat.name }, { $pull: { categories: cat.name } });
    res.json({ success: true, message: 'Category deleted' });
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

    // 5. Added to My Day yesterday and still open ("From yesterday")
    const yesterday = await Task.find({
      userId,
      isCompleted: false,
      inMyDay: false,
      myDayDate: dayBefore(todayStr),
    }).sort({ createdAt: -1 }).limit(10);

    res.json({
      success: true,
      data: {
        overdue,
        dueToday,
        important,
        recent,
        yesterday,
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

    if (body._id) {
      const existing = await Task.findOne({ _id: body._id, userId });
      if (existing) return res.status(200).json({ success: true, data: existing });
    }

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

    const { $set: updateFields, $unset } = splitNulls(body);

    if (body.isCompleted !== undefined) {
      if (body.isCompleted) {
        updateFields.completedAt = new Date();
      } else {
        delete updateFields.completedAt;
        $unset.completedAt = '';
      }
    }

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId },
      update(updateFields, $unset),
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
