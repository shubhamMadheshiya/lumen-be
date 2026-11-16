import mongoose from 'mongoose';
import { deliverAiNote, reactToNewEntries } from '../services/aiNotify/run';
import { composeNote, URGENT_LINE } from '../services/aiNotify/compose';
import { runAssistant } from '../services/llm/assistant/assistant';
import { sendToUser } from '../services/push/pushService';
import { User } from '../models/User';
import { getOrCreatePolicy } from '../models/NotificationPolicy';
import { NotificationEvent } from '../models/NotificationEvent';
import { AiNotification } from '../models/AiNotification';
import { AiConversation } from '../models/AiConversation';

jest.mock('../services/llm/assistant/assistant', () => ({ runAssistant: jest.fn() }));
jest.mock('../services/push/pushService', () => ({ sendToUser: jest.fn() }));
jest.mock('../models/NotificationPolicy', () => ({ getOrCreatePolicy: jest.fn() }));

const ME = new mongoose.Types.ObjectId().toString();
const NOW = new Date('2026-11-16T13:30:00+05:30');
let prefs: Record<string, unknown>;
let policy: Record<string, unknown>;
const saved: Record<string, unknown>[] = [];
const save = jest.fn(async () => undefined);

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  saved.length = 0;
  prefs = { aiFullAccess: true, timezone: 'Asia/Kolkata' };
  policy = {
    masterEnabled: true, dailyBudget: 2, quietHours: { enabled: true, start: '22:00', end: '07:00' },
    flareMode: { active: false }, capabilities: { aiBriefing: true, aiNudge: true, aiCheckIn: true, aiLogReply: true, safety: false },
    aiTimes: { briefing: '08:00', nudge: '13:30', checkIn: '20:30' },
  };
  jest.spyOn(User, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ preferences: prefs }) }) } as never);
  (getOrCreatePolicy as jest.Mock).mockImplementation(async () => policy);
  jest.spyOn(NotificationEvent, 'countDocuments').mockResolvedValue(0 as never);
  jest.spyOn(NotificationEvent, 'updateOne').mockResolvedValue({} as never);
  jest.spyOn(AiNotification, 'exists').mockResolvedValue(null as never);
  jest.spyOn(AiNotification, 'countDocuments').mockResolvedValue(0 as never);
  jest.spyOn(AiNotification, 'create').mockImplementation((async (d: Record<string, unknown>) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...d, save };
    saved.push(doc);
    return doc;
  }) as never);
  jest.spyOn(AiConversation, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'conv1', ...d })) as never);
  jest.spyOn(AiConversation, 'deleteOne').mockResolvedValue({} as never);
  (runAssistant as jest.Mock).mockResolvedValue({ text: 'TITLE: Paani yaad rakhiye\nBODY: Aaj sirf 2 glass log hue hain. Ek glass abhi piyiye.\nOPEN: chat', provider: 'gemini', model: 'gemini-3.5-flash-lite' });
  (sendToUser as jest.Mock).mockResolvedValue({ ok: true, sent: 1 });
});

describe('deliverAiNote', () => {
  it('writes, saves with a chat, pushes on the AI channel and counts it against the budget', async () => {
    const res = await deliverAiNote(ME, 'nudge', { now: NOW });
    expect(res.status).toBe('saved');
    expect(runAssistant).toHaveBeenCalledWith(expect.objectContaining({ userId: ME, effort: 'low', history: [] }));
    expect(AiConversation.create).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'assistant', text: '**Paani yaad rakhiye**\n\nAaj sirf 2 glass log hue hain. Ek glass abhi piyiye.' })],
    }));
    expect(saved[0]).toMatchObject({ kind: 'nudge', slotKey: 'nudge:2026-11-16', dateKey: '2026-11-16', route: '/ai/conv1' });
    expect(sendToUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      title: 'Paani yaad rakhiye', channelId: 'lumen_ai_v1',
      data: expect.objectContaining({ type: 'INTEL_AI_NOTE', route: '/ai/conv1', conversationId: 'conv1' }),
    }));
    expect(saved[0].pushed).toBe(true);
    expect(NotificationEvent.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'ai:nudge:2026-11-16' }),
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ notificationType: 'AI_NOTE', status: 'TRIGGERED' }) }),
      { upsert: true },
    );
  });

  it('over the budget: written for the app but not pushed', async () => {
    (NotificationEvent.countDocuments as unknown as jest.Mock).mockResolvedValue(2);
    await deliverAiNote(ME, 'nudge', { now: NOW });
    expect(sendToUser).not.toHaveBeenCalled();
    expect(saved[0]).toMatchObject({ pushed: false, reason: 'budget' });
  });

  it('runs once per slot and only with Lumen AI on', async () => {
    (AiNotification.exists as unknown as jest.Mock).mockResolvedValue({ _id: 'x' });
    expect(await deliverAiNote(ME, 'nudge', { now: NOW })).toEqual({ status: 'exists' });
    prefs = { aiFullAccess: false };
    expect(await deliverAiNote(ME, 'nudge', { now: NOW })).toEqual({ status: 'off' });
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it('a SKIP from the model saves nothing', async () => {
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'SKIP', provider: 'gemini', model: 'm' });
    expect(await deliverAiNote(ME, 'nudge', { now: NOW })).toEqual({ status: 'skipped', reason: 'skip' });
    expect(AiNotification.create).not.toHaveBeenCalled();
  });

  it('a reply to a serious log ignores the budget, uses the heads-up channel and adds the 112 line when urgent', async () => {
    (NotificationEvent.countDocuments as unknown as jest.Mock).mockResolvedValue(9);
    const res = await deliverAiNote(ME, 'log_reply', {
      now: new Date('2026-11-16T23:30:00+05:30'), entryId: 'e1',
      logged: { when: 'now', summary: 'Chest pain: 9', flags: [{ level: 'now', title: 'Chest pain', message: 'Get help now.' }] },
    });
    expect(res.status).toBe('saved');
    const msg = (sendToUser as jest.Mock).mock.calls[0][1];
    expect(msg.channelId).toBe('lumen_heads_up_v1');
    expect(msg.body.startsWith(URGENT_LINE)).toBe(true);
    expect(saved[0]).toMatchObject({ kind: 'log_reply', slotKey: 'log_reply:e1' });
    // Safety-adjacent: not counted against the budget.
    expect(NotificationEvent.updateOne).not.toHaveBeenCalled();
  });

  it('stops at 3 log replies a day and 3 tests a day', async () => {
    (AiNotification.countDocuments as unknown as jest.Mock).mockResolvedValue(3);
    expect(await deliverAiNote(ME, 'log_reply', { now: NOW, entryId: 'e2' })).toEqual({ status: 'limit' });
    expect(await deliverAiNote(ME, 'briefing', { now: NOW, test: true })).toEqual({ status: 'limit' });
  });

  it('a test pushes regardless of the budget and quiet hours', async () => {
    (NotificationEvent.countDocuments as unknown as jest.Mock).mockResolvedValue(5);
    const res = await deliverAiNote(ME, 'briefing', { now: new Date('2026-11-16T23:00:00+05:30'), test: true });
    expect(res.status).toBe('saved');
    expect(sendToUser).toHaveBeenCalled();
    expect(saved[0]).toMatchObject({ kind: 'test' });
  });

  it('records why it was not pushed when the phone has no token', async () => {
    (sendToUser as jest.Mock).mockResolvedValue({ ok: false, reason: 'no_token' });
    await deliverAiNote(ME, 'nudge', { now: NOW });
    expect(saved[0]).toMatchObject({ pushed: false, reason: 'no_token' });
    expect(NotificationEvent.updateOne).not.toHaveBeenCalled();
  });
});

describe('composeNote', () => {
  it('treats an unformatted answer as unusable', async () => {
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'You slept well.', provider: 'gemini', model: 'm' });
    expect(await composeNote(ME, 'briefing', { today: '2026-11-16', time: '08:00' })).toEqual({ ok: false, reason: 'bad_format' });
  });

  it('passes a provider failure through', async () => {
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'busy', error: 'rate_limited', provider: 'gemini', model: 'm' });
    expect(await composeNote(ME, 'nudge', { today: '2026-11-16', time: '13:30' })).toEqual({ ok: false, reason: 'rate_limited' });
  });
});

describe('reactToNewEntries', () => {
  const flush = () => new Promise(r => setImmediate(r));
  const entry = (sev: number) => ({ _id: `e${sev}`, occurredAt: NOW, answers: [{ optionLabelSnapshot: 'Pain', values: [{ dataType: 'range', value: sev }] }] });

  it('replies to a severity of 8 or more, or any red flag, once per save', async () => {
    reactToNewEntries(ME, [entry(3), entry(9)], []);
    await flush(); await flush(); await flush();
    await new Promise(r => setTimeout(r, 20));
    expect(runAssistant).toHaveBeenCalledTimes(1);
    expect((runAssistant as jest.Mock).mock.calls[0][0].message).toContain('Pain: 9');
  });

  it('does nothing for ordinary entries', async () => {
    reactToNewEntries(ME, [entry(5)], []);
    await new Promise(r => setTimeout(r, 20));
    expect(runAssistant).not.toHaveBeenCalled();
  });
});
