import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { notesRouter } from '../routes/notes';
import { Note } from '../models/Note';

const app = express();
app.use(express.json());
app.use('/notes', notesRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ success: false, message: err.message });
});

const userId = new mongoose.Types.ObjectId();
const token = jwt.sign({ sub: userId.toString(), type: 'access' }, config.jwt.accessSecret);

describe('Notion Notes Routes (Supertest)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /notes/tree', () => {
    it('returns lightweight tree metadata excluding deleted pages', async () => {
      const mockNotes = [
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Root Page',
          icon: '📄',
          parentNoteId: null,
          sortOrder: 0,
          kind: 'page',
          isFavorite: false,
          isPinned: true,
          updatedAt: new Date(),
        },
      ];

      const findSpy = jest.spyOn(Note, 'find').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockNotes),
      } as any);

      const res = await request(app)
        .get('/notes/tree')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].title).toBe('Root Page');
      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(mongoose.Types.ObjectId),
          deletedAt: null,
          isArchived: false,
        })
      );
    });
  });

  describe('GET /notes/trash', () => {
    it('returns trashed notes', async () => {
      const mockTrash = [
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Old Trashed Page',
          icon: '🗑️',
          deletedAt: new Date(),
          trashRootId: new mongoose.Types.ObjectId(),
          kind: 'page',
          updatedAt: new Date(),
        },
      ];

      jest.spyOn(Note, 'find').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockTrash),
      } as any);

      const res = await request(app)
        .get('/notes/trash')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].title).toBe('Old Trashed Page');
    });
  });

  describe('GET /notes/search', () => {
    it('returns snippets and formatted search hits', async () => {
      const mockHits = [
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Dysautonomia Pacing Guide',
          icon: '⚡',
          kind: 'page',
          doc: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Drink 2.5L water daily and pace.' }] },
            ],
          },
          updatedAt: new Date(),
        },
      ];

      jest.spyOn(Note, 'find').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockHits),
      } as any);

      const res = await request(app)
        .get('/notes/search?q=pacing')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].snippet).toContain('Drink 2.5L water daily and pace.');
    });
  });

  describe('POST /notes', () => {
    it('creates note with client-generated id and auto-derives plainText and links from doc', async () => {
      const clientId = new mongoose.Types.ObjectId().toString();
      const targetSubPageId = new mongoose.Types.ObjectId().toString();

      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Daily Protocol' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'pageLink', attrs: { noteId: targetSubPageId, title: 'Target Page' } },
            ],
          },
        ],
      };

      const createSpy = jest.spyOn(Note, 'create').mockImplementation(async (payload: any) => ({
        ...payload,
        _id: payload._id,
      }));

      const res = await request(app)
        .post('/notes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          _id: clientId,
          title: 'My Daily Protocol',
          icon: '📝',
          doc,
        });

      expect(res.status).toBe(201);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(mongoose.Types.ObjectId),
          plainText: expect.stringContaining('My Daily Protocol'),
          linkedNoteIds: [targetSubPageId],
        })
      );
    });
  });

  describe('POST /notes/:id/move (Cycle prevention)', () => {
    it('refuses move when target parent is the page itself or a sub-page', async () => {
      const noteA = new mongoose.Types.ObjectId();
      const noteB = new mongoose.Types.ObjectId();

      // Note A exists
      jest.spyOn(Note, 'findOne').mockImplementation((query: any) => {
        if (query._id.equals(noteA)) {
          return {
            _id: noteA,
            parentNoteId: null,
            save: jest.fn(),
          } as any;
        }
        if (query._id.equals(noteB)) {
          // Note B is a child of Note A
          return {
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue({ _id: noteB, parentNoteId: noteA }),
            }),
            _id: noteB,
            parentNoteId: noteA,
          } as any;
        }
        return Promise.resolve(null) as any;
      });

      const res = await request(app)
        .post(`/notes/${noteA.toString()}/move`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          parentNoteId: noteB.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot move a page inside itself');
    });
  });

  describe('DELETE /notes/:id (Trash cascading)', () => {
    it('moves note and all descendants to trash with same trashRootId', async () => {
      const parentId = new mongoose.Types.ObjectId();
      const childId = new mongoose.Types.ObjectId();

      jest.spyOn(Note, 'findOne').mockResolvedValue({
        _id: parentId,
      } as any);

      // Descendants lookup
      jest.spyOn(Note, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValueOnce([{ _id: childId }]).mockResolvedValueOnce([]),
        }),
      } as any);

      const updateManySpy = jest.spyOn(Note, 'updateMany').mockResolvedValue({ modifiedCount: 2 } as any);

      const res = await request(app)
        .delete(`/notes/${parentId.toString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Moved to Trash');
      expect(updateManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: [parentId, childId] },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            trashRootId: parentId,
          }),
        })
      );
    });
  });
});
