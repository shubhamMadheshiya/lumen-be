import mongoose from 'mongoose';
import { config } from './config';

export function formatMongoUri(rawUri: string): string {
  if (!rawUri) return rawUri;
  const uri = rawUri.trim().replace(/^["']|["']$/g, '');

  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)([^:]+):(.*)@([^@\/]+)(\/.*|\?.*)?$/);
  if (match) {
    const [, protocol, user, pass, host, rest = ''] = match;
    const encodedPassword = encodeURIComponent(decodeURIComponent(pass));
    return `${protocol}${user}:${encodedPassword}@${host}${rest}`;
  }

  return uri;
}

export async function connectDB(): Promise<void> {
  const uri = formatMongoUri(config.mongoUri);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log('[db] MongoDB connected');

  // Automatic migration: migrate any legacy 'auto_now' / 'auto' options to 'user_picks'
  try {
    const db = mongoose.connection.db;
    if (db) {
      const res = await db.collection('options').updateMany(
        { captureTime: { $in: ['auto_now', 'auto'] } },
        { $set: { captureTime: 'user_picks' } }
      );
      if (res.modifiedCount > 0) {
        console.log(`[db] Migrated ${res.modifiedCount} options to user_picks`);
      }
    }
  } catch (err) {
    console.warn('[db] captureTime migration skipped:', err);
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  console.log('[db] MongoDB disconnected');
}
