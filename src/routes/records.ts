import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { HealthRecord } from '../models/HealthRecord';
import { Media } from '../models/Media';
import { getDownloadUrl } from '../utils/s3';
import { AppError } from '../utils/errors';

export const recordsRouter = Router();
recordsRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

/** Resolve download URLs for media IDs associated with a record */
async function attachMediaUrls(records: any[]): Promise<any[]> {
  const allMediaIds = records.flatMap((r) => r.mediaIds || []).filter(Boolean);
  if (allMediaIds.length === 0) return records;

  const mediaDocs = await Media.find({ _id: { $in: allMediaIds } });
  const mediaMap = new Map<string, string>();

  await Promise.all(
    mediaDocs.map(async (m) => {
      try {
        const url = await getDownloadUrl(m.storageKey, 3600); // 1 hour validity
        mediaMap.set(m._id.toString(), url);
      } catch {
        // Fall back gracefully
      }
    }),
  );

  return records.map((record) => {
    const doc = record.toObject ? record.toObject() : { ...record };
    const urls: string[] = [];
    if (doc.mediaIds && Array.isArray(doc.mediaIds)) {
      for (const mId of doc.mediaIds) {
        const url = mediaMap.get(mId.toString());
        if (url) urls.push(url);
      }
    }
    return {
      ...doc,
      fileUrls: urls.length > 0 ? urls : doc.fileUrls || [],
    };
  });
}

// GET /api/v1/records - list records with search & filter
recordsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { type, q, from, to } = req.query;

    const filter: Record<string, any> = { userId };

    if (type && typeof type === 'string' && type !== 'all') {
      filter.type = type;
    }

    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to) filter.date.$lte = new Date(to as string);
    }

    if (q && typeof q === 'string' && q.trim().length > 0) {
      const regex = { $regex: q.trim(), $options: 'i' };
      filter.$or = [
        { title: regex },
        { doctorName: regex },
        { clinicOrLab: regex },
        { notes: regex },
        { 'biomarkers.name': regex },
        { 'medications.name': regex },
        { tags: regex },
      ];
    }

    const records = await HealthRecord.find(filter).sort({ date: -1, createdAt: -1 });
    const recordsWithUrls = await attachMediaUrls(records);

    res.json({ success: true, data: recordsWithUrls });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/records/:id - get single record details
recordsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw AppError.badRequest('Invalid record ID');
    }

    const record = await HealthRecord.findOne({ _id: id, userId });
    if (!record) {
      throw AppError.notFound('Health record not found');
    }

    const [recordWithUrls] = await attachMediaUrls([record]);
    res.json({ success: true, data: recordWithUrls });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/records - create record
recordsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const {
      title,
      type,
      date,
      doctorName,
      clinicOrLab,
      mediaIds = [],
      fileUrls = [],
      fileNames = [],
      notes,
      isSensitive = false,
      biomarkers = [],
      medications = [],
      tags = [],
    } = req.body;

    if (!title || !type) {
      throw AppError.badRequest('Title and type are required');
    }

    const validMediaIds = (mediaIds as string[])
      .filter((m) => mongoose.Types.ObjectId.isValid(m))
      .map((m) => new mongoose.Types.ObjectId(m));

    const record = await HealthRecord.create({
      userId,
      title: title.trim(),
      type,
      date: date ? new Date(date) : new Date(),
      doctorName: doctorName ? doctorName.trim() : undefined,
      clinicOrLab: clinicOrLab ? clinicOrLab.trim() : undefined,
      mediaIds: validMediaIds,
      fileUrls,
      fileNames,
      notes,
      isSensitive: Boolean(isSensitive),
      biomarkers,
      medications,
      tags,
    });

    const [recordWithUrls] = await attachMediaUrls([record]);
    res.status(201).json({ success: true, data: recordWithUrls });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/records/:id - update record
recordsRouter.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw AppError.badRequest('Invalid record ID');
    }

    const record = await HealthRecord.findOne({ _id: id, userId });
    if (!record) {
      throw AppError.notFound('Health record not found');
    }

    const updates = { ...req.body };
    delete updates._id;
    delete updates.userId;

    if (updates.date) {
      updates.date = new Date(updates.date);
    }
    if (updates.mediaIds && Array.isArray(updates.mediaIds)) {
      updates.mediaIds = updates.mediaIds
        .filter((m: string) => mongoose.Types.ObjectId.isValid(m))
        .map((m: string) => new mongoose.Types.ObjectId(m));
    }

    Object.assign(record, updates);
    await record.save();

    const [recordWithUrls] = await attachMediaUrls([record]);
    res.json({ success: true, data: recordWithUrls });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/records/:id - delete record
recordsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw AppError.badRequest('Invalid record ID');
    }

    const result = await HealthRecord.findOneAndDelete({ _id: id, userId });
    if (!result) {
      throw AppError.notFound('Health record not found');
    }

    res.json({ success: true, message: 'Health record deleted successfully' });
  } catch (err) {
    next(err);
  }
});
