/**
 * Ownership middleware.
 * After authenticate(), every Mongoose query must be scoped to req.userId.
 * This module provides helpers (not Express middleware) used inside controllers.
 */
import mongoose from 'mongoose';

/** Throws a 403 AppError if the given userId doesn't own the document. */
export function assertOwns(docUserId: string | mongoose.Types.ObjectId, requestUserId: string): void {
  if (docUserId.toString() !== requestUserId) {
    const err = new Error('Forbidden') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}

/** Returns a MongoDB filter that always scopes to the authenticated user. */
export function userFilter(userId: string): { userId: mongoose.Types.ObjectId } {
  return { userId: new mongoose.Types.ObjectId(userId) };
}
