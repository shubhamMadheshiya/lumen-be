import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { authRouter } from '../routes/auth';
import { User } from '../models/User';

const app = express();
app.use(express.json());
app.use('/auth', authRouter);
app.use((err: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.statusCode || 500).json({ success: false, message: err.message });
});

const userId = new mongoose.Types.ObjectId();
const token = jwt.sign({ sub: userId.toString(), type: 'access' }, config.jwt.accessSecret);

describe('PATCH /auth/me preferences', () => {
  afterEach(() => jest.restoreAllMocks());

  it('saves a theme change for a member who never set AI voice settings (regression: 500)', async () => {
    // A real document, so Mongoose validation runs exactly as it would against the database.
    const doc = new User({ _id: userId, email: 'p@example.test', name: 'P', preferences: { timezone: 'Asia/Kolkata', aiFullAccess: true, aiModel: 'gemini-3.5-flash-lite' } });
    doc.set('preferences.aiVoice', undefined);
    jest.spyOn(User, 'findById').mockResolvedValue(doc as never);
    jest.spyOn(doc, 'save').mockImplementation(async function (this: typeof doc) { await this.validate(); return this; } as never);

    const res = await request(app).patch('/auth/me').set('Authorization', `Bearer ${token}`).send({ preferences: { theme: 'dark', aiModel: 'claude-opus-5-5' } });
    expect(res.status).toBe(200);
    expect(doc.preferences.theme).toBe('dark');
    // AI settings only change through /ai/settings.
    expect(doc.preferences.aiModel).toBe('gemini-3.5-flash-lite');
    expect(doc.preferences.aiFullAccess).toBe(true);
    expect(doc.preferences.timezone).toBe('Asia/Kolkata');
  });
});
