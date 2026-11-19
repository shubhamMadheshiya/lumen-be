import { Router, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { Media } from '../models/Media';
import { config } from '../config';
import { getUploadUrl, getDownloadUrl, deleteObject } from '../utils/s3';

export const mediaRouter = Router();
mediaRouter.use(authenticate);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'audio/m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_TO_EXT));

// POST /media/upload-url — get a pre-signed S3 PUT URL
mediaRouter.post('/upload-url', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { mimeType, sensitive = false, size } = req.body as {
      mimeType: string;
      sensitive?: boolean;
      size?: number;
    };

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw AppError.badRequest(`Unsupported media type: ${mimeType}`);
    }

    if (size && size > 20 * 1024 * 1024) {
      throw AppError.badRequest('File too large. Maximum size is 20 MB.');
    }

    const ext = MIME_TO_EXT[mimeType] || mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    const key = `users/${req.userId!}/${uuidv4()}.${ext}`;

    const uploadUrl = await getUploadUrl(key, mimeType, 300); // 5-minute window

    // Pre-create the Media document (will be confirmed after upload)
    const media = await Media.create({
      userId: new mongoose.Types.ObjectId(req.userId!),
      storageKey: key,
      mimeType,
      size: size ?? 0,
      sensitive,
    });

    res.json({
      success: true,
      data: {
        mediaId: media._id,
        uploadUrl,
        storageKey: key,
        expiresIn: 300,
      },
    });
  } catch (err) { next(err); }
});

// POST /media/confirm — finalize after successful upload
mediaRouter.post('/confirm', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { mediaId, width, height, blurhash, size } = req.body as {
      mediaId: string;
      width?: number;
      height?: number;
      blurhash?: string;
      size?: number;
    };

    const media = await Media.findOneAndUpdate(
      { _id: mediaId, userId: new mongoose.Types.ObjectId(req.userId!) },
      { width, height, blurhash, ...(size ? { size } : {}) },
      { new: true },
    );
    if (!media) throw AppError.notFound();

    res.json({ success: true, data: media });
  } catch (err) { next(err); }
});

// GET /media/:id/url — get a short-lived signed download URL
mediaRouter.get('/:id/url', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const media = await Media.findOne({
      _id: req.params.id,
      userId: new mongoose.Types.ObjectId(req.userId!),
    });
    if (!media) throw AppError.notFound();

    const url = await getDownloadUrl(media.storageKey);
    res.json({ success: true, data: { url, expiresIn: config.s3.mediaUrlExpirySeconds } });
  } catch (err) { next(err); }
});

// DELETE /media/:id
mediaRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const media = await Media.findOneAndDelete({
      _id: req.params.id,
      userId: new mongoose.Types.ObjectId(req.userId!),
    });
    if (!media) throw AppError.notFound();

    await deleteObject(media.storageKey).catch(() => {
      // S3 deletion failure is non-fatal — log but don't block
      console.error(`[media] Failed to delete S3 object: ${media.storageKey}`);
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});
