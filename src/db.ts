import mongoose from 'mongoose';
import { config } from './config';

export async function connectDB(): Promise<void> {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log('[db] MongoDB connected');
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  console.log('[db] MongoDB disconnected');
}
