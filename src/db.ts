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
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  console.log('[db] MongoDB disconnected');
}
