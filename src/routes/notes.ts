import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { Note, INoteDoc } from '../models/Note';
import { CreateNoteSchema, UpdateNoteSchema, MoveNoteSchema } from '../shared/schemas';
import { INoteBlock, INoteBreadcrumb } from '../shared/types';
import { blocksToDoc, docToPlainText, extractLinks, docSnippet } from '../shared/notes/docUtils';
import { AppError } from '../utils/errors';

export const notesRouter = Router();
notesRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// ─────────────────────────────────────────────────────────────
// PREBUILT CLINICAL TEMPLATES (with modern ProseMirror doc)
// ─────────────────────────────────────────────────────────────

const RAW_HEALTH_NOTE_TEMPLATES: Array<{
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

export const HEALTH_NOTE_TEMPLATES = RAW_HEALTH_NOTE_TEMPLATES.map((t) => ({
  ...t,
  doc: blocksToDoc(t.blocks),
}));

// GET /api/v1/notes/templates
notesRouter.get('/templates', (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: HEALTH_NOTE_TEMPLATES });
});

// ─────────────────────────────────────────────────────────────
// TREE, SEARCH & TRASH ENDPOINTS
// ─────────────────────────────────────────────────────────────

// GET /api/v1/notes/tree - lightweight metadata for pages not in trash
notesRouter.get('/tree', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const pages = await Note.find({
      userId,
      deletedAt: null,
      isArchived: false,
    })
      .select('_id title icon parentNoteId sortOrder kind isFavorite isPinned updatedAt')
      .sort({ sortOrder: 1, isPinned: -1, updatedAt: -1 })
      .lean();

    res.json({ success: true, data: pages });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/notes/trash - list pages currently in Trash
notesRouter.get('/trash', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const trash = await Note.find({
      userId,
      deletedAt: { $ne: null },
    })
      .select('_id title icon deletedAt trashRootId kind updatedAt')
      .sort({ deletedAt: -1 })
      .lean();

    res.json({ success: true, data: trash });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/notes/search?q= - full-text search across notes
notesRouter.get('/search', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.json({ success: true, data: [] });
    }

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hits = await Note.find({
      userId,
      deletedAt: null,
      $or: [
        { title: { $regex: regex } },
        { plainText: { $regex: regex } },
        { tags: { $regex: regex } },
      ],
    })
      .select('_id title icon kind doc updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    const formatted = hits.map((h) => ({
      _id: h._id,
      title: h.title,
      icon: h.icon,
      kind: h.kind || 'page',
      updatedAt: h.updatedAt,
      snippet: docSnippet(h.doc),
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// CRUD ENDPOINTS
// ─────────────────────────────────────────────────────────────

// GET /api/v1/notes - list notes with filtering & search
notesRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { parentId, tag, pinned, archived, search } = req.query;

    const query: Record<string, unknown> = {
      userId,
      deletedAt: null,
    };

    if (archived === 'true') {
      query.isArchived = true;
    } else {
      query.isArchived = false;
    }

    if (parentId === 'root') {
      query.$or = [{ parentNoteId: null }, { parentNoteId: { $exists: false } }];
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
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { title: { $regex: regex } },
        { plainText: { $regex: regex } },
        { tags: { $regex: regex } },
        { 'blocks.content': { $regex: regex } },
      ];
    }

    const notes = await Note.find(query).sort({ sortOrder: 1, isPinned: -1, updatedAt: -1 });
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

    // Use client-generated ID if provided
    const _id = body._id && mongoose.Types.ObjectId.isValid(body._id)
      ? new mongoose.Types.ObjectId(body._id)
      : new mongoose.Types.ObjectId();

    // Derive doc & plain text
    let doc = body.doc;
    if (!doc && Array.isArray(body.blocks) && body.blocks.length > 0) {
      doc = blocksToDoc(body.blocks);
    }

    const plainText = doc ? docToPlainText(doc) : (body.plainText || '');
    const { noteIds, mediaIds } = doc ? extractLinks(doc) : { noteIds: [], mediaIds: [] };

    const parentNoteId = body.parentNoteId && mongoose.Types.ObjectId.isValid(body.parentNoteId)
      ? new mongoose.Types.ObjectId(body.parentNoteId)
      : null;

    const note = await Note.create({
      ...body,
      _id,
      userId,
      doc,
      plainText,
      linkedNoteIds: noteIds,
      mediaIds,
      parentNoteId,
      deletedAt: null,
      trashRootId: null,
    });

    res.status(201).json({ success: true, data: note });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/notes/:id - get single note with breadcrumbs, sub-pages, and backlinks
notesRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw AppError.notFound('Note not found');
    }

    const note = await Note.findOne({ _id: req.params.id, userId });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    // Lazy migration of legacy notes missing doc
    if (!note.doc && note.blocks && note.blocks.length > 0) {
      note.doc = blocksToDoc(note.blocks);
      note.plainText = docToPlainText(note.doc);
      const links = extractLinks(note.doc);
      note.linkedNoteIds = links.noteIds;
      note.mediaIds = links.mediaIds;
      await note.save().catch(() => {});
    }

    // 1. Breadcrumbs: walk up parents to root
    const breadcrumbs: INoteBreadcrumb[] = [];
    let currentParentId = note.parentNoteId;
    const visitedParents = new Set<string>();

    while (currentParentId && !visitedParents.has(currentParentId.toString())) {
      visitedParents.add(currentParentId.toString());
      const p = await Note.findOne({ _id: currentParentId, userId })
        .select('_id title icon parentNoteId')
        .lean();
      if (!p) break;
      breadcrumbs.unshift({
        _id: String(p._id),
        title: p.title || 'Untitled',
        icon: p.icon || '📝',
      });
      currentParentId = (p.parentNoteId as mongoose.Types.ObjectId) || null;
    }

    // 2. Child pages / database rows (include rowProps)
    const subPages = await Note.find({
      userId,
      parentNoteId: note._id,
      deletedAt: null,
    })
      .select('_id title icon coverGradient sortOrder kind isFavorite isPinned rowProps updatedAt')
      .sort({ sortOrder: 1, updatedAt: -1 })
      .lean();

    // 3. Backlinks (other non-deleted notes that link to this note ID)
    const noteIdStr = note._id.toString();
    const backlinks = await Note.find({
      userId,
      deletedAt: null,
      _id: { $ne: note._id },
      linkedNoteIds: noteIdStr,
    })
      .select('_id title icon kind updatedAt')
      .sort({ updatedAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        ...note.toObject(),
        breadcrumbs,
        subPages,
        backlinks,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/notes/:id - partial update note
notesRouter.patch('/:id', validate(UpdateNoteSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw AppError.notFound('Note not found');
    }

    const body = req.body;
    const updateFields: Record<string, unknown> = { ...body };

    if (body.parentNoteId !== undefined) {
      updateFields.parentNoteId =
        body.parentNoteId && mongoose.Types.ObjectId.isValid(body.parentNoteId)
          ? new mongoose.Types.ObjectId(body.parentNoteId)
          : null;
    }

    // If doc was provided or updated, re-derive plainText, links, media
    if (body.doc !== undefined) {
      if (body.doc) {
        updateFields.plainText = docToPlainText(body.doc);
        const { noteIds, mediaIds } = extractLinks(body.doc);
        updateFields.linkedNoteIds = noteIds;
        updateFields.mediaIds = mediaIds;
      } else {
        updateFields.plainText = '';
        updateFields.linkedNoteIds = [];
        updateFields.mediaIds = [];
      }
    } else if (Array.isArray(body.blocks) && body.blocks.length > 0) {
      const derivedDoc = blocksToDoc(body.blocks);
      updateFields.doc = derivedDoc;
      updateFields.plainText = docToPlainText(derivedDoc);
      const { noteIds, mediaIds } = extractLinks(derivedDoc);
      updateFields.linkedNoteIds = noteIds;
      updateFields.mediaIds = mediaIds;
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

// ─────────────────────────────────────────────────────────────
// MOVE & DUPLICATE
// ─────────────────────────────────────────────────────────────

// Helper to check for cycles before moving
async function wouldCreateCycle(
  userId: mongoose.Types.ObjectId,
  noteId: mongoose.Types.ObjectId,
  targetParentId: mongoose.Types.ObjectId
): Promise<boolean> {
  if (noteId.equals(targetParentId)) return true;
  let curr: mongoose.Types.ObjectId | null = targetParentId;
  const visited = new Set<string>();

  while (curr) {
    if (curr.equals(noteId)) return true;
    const str = curr.toString();
    if (visited.has(str)) break;
    visited.add(str);
    const parentDoc: any = await Note.findOne({ _id: curr, userId }).select('parentNoteId').lean();
    curr = parentDoc?.parentNoteId ? new mongoose.Types.ObjectId(parentDoc.parentNoteId) : null;
  }
  return false;
}

// POST /api/v1/notes/:id/move - move note to a new parent or reorder
notesRouter.post('/:id/move', validate(MoveNoteSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const noteId = new mongoose.Types.ObjectId(req.params.id);

    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
      throw AppError.notFound('Note not found');
    }

    const { parentNoteId, sortOrder } = req.body;
    let targetParentOid: mongoose.Types.ObjectId | null = null;

    if (parentNoteId) {
      if (!mongoose.Types.ObjectId.isValid(parentNoteId)) {
        throw AppError.badRequest('Invalid parentNoteId');
      }
      targetParentOid = new mongoose.Types.ObjectId(parentNoteId);

      const targetParent = await Note.findOne({ _id: targetParentOid, userId, deletedAt: null });
      if (!targetParent) {
        throw AppError.notFound('Target parent note not found');
      }

      // Cycle prevention
      const isCycle = await wouldCreateCycle(userId, noteId, targetParentOid);
      if (isCycle) {
        throw AppError.badRequest('Cannot move a page inside itself or one of its sub-pages');
      }
    }

    note.parentNoteId = targetParentOid;
    if (typeof sortOrder === 'number') {
      note.sortOrder = sortOrder;
    }
    await note.save();

    res.json({ success: true, data: note });
  } catch (err) {
    next(err);
  }
});

// Helper for deep duplication
async function duplicateRecursive(
  userId: mongoose.Types.ObjectId,
  sourceNoteId: mongoose.Types.ObjectId,
  newParentId: mongoose.Types.ObjectId | null,
  isRoot = true
): Promise<INoteDoc> {
  const source = await Note.findOne({ _id: sourceNoteId, userId }).lean();
  if (!source) throw AppError.notFound('Source note not found');

  const newId = new mongoose.Types.ObjectId();
  const title = isRoot ? `${source.title} (Copy)` : source.title;

  const created = await Note.create({
    ...source,
    _id: newId,
    userId,
    title,
    parentNoteId: newParentId,
    isPinned: false,
    deletedAt: null,
    trashRootId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const children = await Note.find({ userId, parentNoteId: source._id, deletedAt: null }).lean();
  for (const child of children) {
    await duplicateRecursive(userId, child._id as mongoose.Types.ObjectId, newId, false);
  }

  return created;
}

// POST /api/v1/notes/:id/duplicate - duplicate note and all sub-pages
notesRouter.post('/:id/duplicate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const sourceId = new mongoose.Types.ObjectId(req.params.id);
    const source = await Note.findOne({ _id: sourceId, userId, deletedAt: null });
    if (!source) {
      throw AppError.notFound('Note not found');
    }

    const duplicated = await duplicateRecursive(userId, sourceId, source.parentNoteId || null, true);
    res.status(201).json({ success: true, data: duplicated });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
// TRASH & RESTORE
// ─────────────────────────────────────────────────────────────

// Helper to collect all recursive descendant IDs
async function collectDescendantIds(
  userId: mongoose.Types.ObjectId,
  rootId: mongoose.Types.ObjectId
): Promise<mongoose.Types.ObjectId[]> {
  const result: mongoose.Types.ObjectId[] = [];
  const queue: mongoose.Types.ObjectId[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await Note.find({ userId, parentNoteId: current, deletedAt: null })
      .select('_id')
      .lean();

    for (const c of children) {
      const cid = c._id as mongoose.Types.ObjectId;
      result.push(cid);
      queue.push(cid);
    }
  }

  return result;
}

// DELETE /api/v1/notes/:id - move note and its descendants to Trash
notesRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const noteId = new mongoose.Types.ObjectId(req.params.id);

    const note = await Note.findOne({ _id: noteId, userId, deletedAt: null });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    const descendantIds = await collectDescendantIds(userId, noteId);
    const allIdsToTrash = [noteId, ...descendantIds];

    const now = new Date();
    await Note.updateMany(
      { _id: { $in: allIdsToTrash }, userId },
      {
        $set: {
          deletedAt: now,
          trashRootId: noteId,
        },
      }
    );

    res.json({
      success: true,
      message: 'Moved to Trash',
      data: { trashedCount: allIdsToTrash.length },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/notes/:id/restore - restore note and its descendants from Trash
notesRouter.post('/:id/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const noteId = new mongoose.Types.ObjectId(req.params.id);

    const note = await Note.findOne({ _id: noteId, userId, deletedAt: { $ne: null } });
    if (!note) {
      throw AppError.notFound('Note not found in Trash');
    }

    // Check if the original parent is still valid and not in trash
    let validParentId: mongoose.Types.ObjectId | null = null;
    if (note.parentNoteId) {
      const parent = await Note.findOne({ _id: note.parentNoteId, userId, deletedAt: null });
      if (parent) {
        validParentId = note.parentNoteId;
      }
    }

    // Restore note and descendants that shared this trash root
    await Note.updateMany(
      {
        userId,
        $or: [{ _id: noteId }, { trashRootId: noteId }],
      },
      {
        $set: {
          deletedAt: null,
          trashRootId: null,
        },
      }
    );

    // If parent was in trash, lift this note to root
    if (note.parentNoteId && !validParentId) {
      note.parentNoteId = null;
      await note.save();
    }

    res.json({ success: true, message: 'Note restored from Trash' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/notes/:id/permanent - permanently delete note and its descendants
notesRouter.delete('/:id/permanent', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const noteId = new mongoose.Types.ObjectId(req.params.id);

    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    // Collect all descendants (even if in trash)
    const queue = [noteId];
    const allIds = [noteId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const children = await Note.find({ userId, parentNoteId: curr }).select('_id').lean();
      for (const ch of children) {
        allIds.push(ch._id as mongoose.Types.ObjectId);
        queue.push(ch._id as mongoose.Types.ObjectId);
      }
    }

    await Note.deleteMany({ _id: { $in: allIds }, userId });

    res.json({ success: true, message: 'Note permanently deleted', data: { deletedCount: allIds.length } });
  } catch (err) {
    next(err);
  }
});

/**
 * Purges notes in Trash for more than olderThanDays (default 30 days).
 */
export async function purgeExpiredTrash(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const res = await Note.deleteMany({
    deletedAt: { $ne: null, $lt: cutoff },
  });
  return res.deletedCount || 0;
}
