import mongoose from 'mongoose';
import {
  generateWeeklyReview, isWeeklyReviewDue, lastFullWeek, runDueWeeklyReviews,
} from '../services/llm/assistant/weeklyReview';
import { runAssistant } from '../services/llm/assistant/assistant';
import { AiWeeklyReport } from '../models/AiWeeklyReport';
import { User } from '../models/User';

jest.mock('../services/llm/assistant/assistant', () => ({ runAssistant: jest.fn() }));
jest.mock('../models/AiWeeklyReport', () => ({ AiWeeklyReport: { findOne: jest.fn(), findOneAndUpdate: jest.fn() } }));
jest.mock('../models/User', () => ({ User: { findById: jest.fn(), find: jest.fn() } }));

const ME = new mongoose.Types.ObjectId().toString();
const prefs = { aiFullAccess: true, timezone: 'Asia/Kolkata', dayBoundaryHour: 4 };
const asUser = (p: object) => ({ select: () => ({ lean: async () => ({ _id: ME, preferences: p }) }) });

beforeEach(() => {
  jest.clearAllMocks();
  (User.findById as jest.Mock).mockReturnValue(asUser(prefs));
  (AiWeeklyReport.findOne as jest.Mock).mockResolvedValue(null);
  (AiWeeklyReport.findOneAndUpdate as jest.Mock).mockImplementation(async (_f, u) => ({ _id: 'r1', weekStart: 'x', ...u.$set }));
});

describe('weekly review timing', () => {
  it('reviews the Monday-to-Sunday week before the current one', () => {
    expect(lastFullWeek('2026-11-12')).toEqual({ weekStart: '2026-11-02', weekEnd: '2026-11-08' }); // Thursday
    expect(lastFullWeek('2026-11-09')).toEqual({ weekStart: '2026-11-02', weekEnd: '2026-11-08' }); // Monday
  });

  it("is due only on the member's own Monday", () => {
    // 2026-11-09 00:30 UTC is Monday 06:00 in Kolkata; Sunday 19:30 in New York
    const at = new Date('2026-11-09T00:30:00Z');
    expect(isWeeklyReviewDue({ timezone: 'Asia/Kolkata', dayBoundaryHour: 4 }, at)).toBe(true);
    expect(isWeeklyReviewDue({ timezone: 'America/New_York', dayBoundaryHour: 4 }, at)).toBe(false);
  });
});

describe('generateWeeklyReview', () => {
  it('does nothing without AI full access', async () => {
    (User.findById as jest.Mock).mockReturnValue(asUser({ ...prefs, aiFullAccess: false }));
    await expect(generateWeeklyReview(ME)).resolves.toEqual({ report: null, error: 'ai_full_access_off' });
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it('returns an existing review instead of writing a second one', async () => {
    (AiWeeklyReport.findOne as jest.Mock).mockResolvedValue({ _id: 'old' });
    const res = await generateWeeklyReview(ME, { weekStart: '2026-11-02' });
    expect(res.report).toEqual({ _id: 'old' });
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it('writes the review for the requested week (snapped to its Monday)', async () => {
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'A calmer week.', requests: 4, toolCalls: [] });
    const res = await generateWeeklyReview(ME, { weekStart: '2026-11-05' });
    expect((runAssistant as jest.Mock).mock.calls[0][0].message).toContain('2026-11-02 to 2026-11-08');
    expect(AiWeeklyReport.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ weekStart: '2026-11-02' }),
      { $set: { weekEnd: '2026-11-08', text: 'A calmer week.' } },
      expect.anything(),
    );
    expect(res.report).toBeTruthy();
  });

  it('does not save a failed review, so the next run tries again', async () => {
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'busy', requests: 1, toolCalls: [], error: 'rate_limited' });
    await expect(generateWeeklyReview(ME, { force: true })).resolves.toEqual({ report: null, error: 'rate_limited' });
    expect(AiWeeklyReport.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('runDueWeeklyReviews', () => {
  it('only looks at members with full access, and only in their due hour', async () => {
    (User.find as jest.Mock).mockReturnValue({ select: () => ({ lean: async () => [{ _id: ME, preferences: prefs }] }) });
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'ok', requests: 1, toolCalls: [] });
    const monday = new Date('2026-11-09T00:30:00Z');
    expect(await runDueWeeklyReviews(monday, () => false)).toBe(0);
    expect(await runDueWeeklyReviews(monday, () => true)).toBe(1);
    expect(User.find).toHaveBeenCalledWith({ 'preferences.aiFullAccess': true });
  });
});
