import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { Note } from '../models/Note';
import { CreateNoteSchema, UpdateNoteSchema } from '../shared/schemas';
import { INoteBlock } from '../shared/types';

export const notesRouter = Router();
notesRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// ─────────────────────────────────────────────────────────────
// PREBUILT CLINICAL TEMPLATES
// ─────────────────────────────────────────────────────────────

export const HEALTH_NOTE_TEMPLATES: Array<{
  key: string;
  title: string;
  icon: string;
  coverGradient: string;
  tags: string[];
  description: string;
  blocks: INoteBlock[];
}> = [
  {
    key: 'doctor_visit_prep',
    title: 'Clinical Appointment Prep & Debrief',
    icon: '🩺',
    coverGradient: 'linear-gradient(135deg, #0F172A 0%, #0369A1 100%)',
    tags: ['Doctor Visit', 'Clinical', 'Appointment'],
    description: 'Prepare chief complaints, questions, medication review, and record doctor instructions.',
    blocks: [
      {
        id: 'b1',
        type: 'callout',
        content: 'Appointment objective: Review ongoing dysautonomia/fatigue management and lab results.',
        calloutIcon: '💡',
        calloutColor: '#0284C7',
      },
      { id: 'b2', type: 'heading_2', content: '1. Top 3 Issues to Discuss Today' },
      { id: 'b3', type: 'bullet_list', content: 'Recent worsening of orthostatic dizziness in morning hours' },
      { id: 'b4', type: 'bullet_list', content: 'Review blood panel (ferritin, thyroid, B12)' },
      { id: 'b5', type: 'bullet_list', content: 'Discuss prescription dosage adjustment' },
      { id: 'b6', type: 'heading_2', content: '2. Current Medications & Tolerability' },
      { id: 'b7', type: 'quote', content: 'Bring full medication list and recent vitals summary to exam room.' },
      { id: 'b8', type: 'heading_2', content: '3. Clinical Action Items & Plan' },
      { id: 'b9', type: 'todo', content: 'Pick up modified prescription from pharmacy', completed: false },
      { id: 'b10', type: 'todo', content: 'Schedule follow-up appointment in 6 weeks', completed: false },
      { id: 'b11', type: 'todo', content: 'Log morning blood pressure daily for 2 weeks', completed: false },
    ],
  },
  {
    key: 'flare_retrospective',
    title: 'Symptom Flare Analysis & Protocol',
    icon: '⚡',
    coverGradient: 'linear-gradient(135deg, #450A0A 0%, #DC2626 100%)',
    tags: ['Flare', 'PEM', 'Pacing'],
    description: 'Analyze potential triggers, symptom severity, pacing breakdown, and resting recovery plan.',
    blocks: [
      {
        id: 'f1',
        type: 'callout',
        content: 'Active flare protocol: Transition to emergency resting baseline. Cancel non-urgent demands.',
        calloutIcon: '⚠️',
        calloutColor: '#EF4444',
      },
      { id: 'f2', type: 'heading_2', content: '1. Suspected Triggers (24-48h prior)' },
      { id: 'f3', type: 'bullet_list', content: 'Physical exertion: Extended walking / stairs' },
      { id: 'f4', type: 'bullet_list', content: 'Environmental: Weather pressure drop or poor sleep' },
      { id: 'f5', type: 'heading_2', content: '2. Recovery Care Plan' },
      { id: 'f6', type: 'todo', content: 'Aggressive hydration with electrolyte solution (2.5L)', completed: false },
      { id: 'f7', type: 'todo', content: 'Horizontal bed rest with legs elevated', completed: false },
      { id: 'f8', type: 'todo', content: 'Postpone tasks in To Do for 2 days', completed: false },
      { id: 'f9', type: 'heading_2', content: '3. Learnings for Future Pacing' },
      { id: 'f10', type: 'paragraph', content: 'Set an earlier timer when running errands to prevent crossing the anaerobic threshold.' },
    ],
  },
  {
    key: 'medication_trial',
    title: 'New Medication & Treatment Trial Log',
    icon: '💊',
    coverGradient: 'linear-gradient(135deg, #1E1B4B 0%, #7C3AED 100%)',
    tags: ['Medication', 'Treatment', 'Trial'],
    description: 'Track side effects, therapeutic response, and titration schedule over weeks.',
    blocks: [
      {
        id: 'm1',
        type: 'callout',
        content: 'Dosage instructions: Take with morning meal. Do not skip doses.',
        calloutIcon: '📋',
        calloutColor: '#8B5CF6',
      },
      { id: 'm2', type: 'heading_2', content: '1. Target Symptoms & Baseline' },
      { id: 'm3', type: 'paragraph', content: 'Goal: Reduce cognitive fatigue and improve resting heart rate stability.' },
      { id: 'm4', type: 'heading_2', content: '2. Weekly Check-In Log' },
      { id: 'm5', type: 'toggle', content: 'Week 1 Observations', isCollapsed: false, children: [
        { id: 'm5_1', type: 'bullet_list', content: 'Mild nausea on days 1-2, resolved by day 4' },
        { id: 'm5_2', type: 'bullet_list', content: 'Noticeable reduction in brain fog around 2 PM' },
      ] },
      { id: 'm6', type: 'heading_2', content: '3. Efficacy Verdict' },
      { id: 'm7', type: 'paragraph', content: 'To be evaluated with physician at 30-day mark.' },
    ],
  },
];

// GET /api/v1/notes/templates
notesRouter.get('/templates', (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: HEALTH_NOTE_TEMPLATES });
});

// ─────────────────────────────────────────────────────────────
// CRUD ENDPOINTS
// ─────────────────────────────────────────────────────────────

// GET /api/v1/notes - list notes with filtering & search
notesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { parentId, tag, pinned, archived, search } = req.query;

    const query: Record<string, unknown> = { userId };

    if (archived === 'true') {
      query.isArchived = true;
    } else {
      query.isArchived = false;
    }

    if (parentId === 'root') {
      query.parentNoteId = { $exists: false };
    } else if (parentId && mongoose.Types.ObjectId.isValid(parentId as string)) {
      query.parentNoteId = new mongoose.Types.ObjectId(parentId as string);
    }

    if (tag && typeof tag === 'string') {
      query.tags = tag;
    }

    if (pinned === 'true') {
      query.isPinned = true;
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      const q = search.trim();
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { 'blocks.content': { $regex: q, $options: 'i' } },
        { tags: { $regex: q, $options: 'i' } },
      ];
    }

    const notes = await Note.find(query).sort({ isPinned: -1, updatedAt: -1 });
    res.json({ success: true, data: notes });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/notes - create note
notesRouter.post('/', validate(CreateNoteSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = req.body;

    const note = await Note.create({
      ...body,
      userId,
      parentNoteId: body.parentNoteId && mongoose.Types.ObjectId.isValid(body.parentNoteId)
        ? new mongoose.Types.ObjectId(body.parentNoteId)
        : undefined,
    });

    res.status(201).json({ success: true, data: note });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/notes/:id - get single note with sub-pages
notesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const note = await Note.findOne({ _id: req.params.id, userId });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    // Also fetch sub-pages nested inside this note (Notion sub-page hierarchy)
    const subPages = await Note.find({ userId, parentNoteId: note._id }).select('title icon coverGradient isPinned updatedAt');

    res.json({
      success: true,
      data: {
        ...note.toObject(),
        subPages,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/notes/:id - update note
notesRouter.patch('/:id', validate(UpdateNoteSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = req.body;

    const updateFields: Record<string, unknown> = { ...body };
    if (body.parentNoteId !== undefined) {
      updateFields.parentNoteId =
        body.parentNoteId && mongoose.Types.ObjectId.isValid(body.parentNoteId)
          ? new mongoose.Types.ObjectId(body.parentNoteId)
          : null;
    }

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updateFields },
      { new: true }
    );

    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    res.json({ success: true, data: note });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/notes/:id - delete note
notesRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const note = await Note.findOneAndDelete({ _id: req.params.id, userId });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    // Disassociate child sub-pages so they become root notes rather than orphaned
    await Note.updateMany({ userId, parentNoteId: req.params.id }, { $unset: { parentNoteId: '' } });

    res.json({ success: true, message: 'Note deleted' });
  } catch (err) {
    next(err);
  }
});
