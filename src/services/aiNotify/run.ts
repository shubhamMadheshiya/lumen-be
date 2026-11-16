/**
 * Lumen AI notifications, end to end: gate → compose → save (with a chat the member can reply in)
 * → push → count it against the shared daily budget (a NotificationEvent, like the app's own).
 * Only for members with Lumen AI full access on. Never throws to callers.
 */
import mongoose from 'mongoose';
import { User } from '../../models/User';
import { getOrCreatePolicy, type INotificationPolicyDoc } from '../../models/NotificationPolicy';
import { NotificationEvent } from '../../models/NotificationEvent';
import { AiNotification, type AiNotificationKind, type IAiNotificationDoc } from '../../models/AiNotification';
import { AiConversation } from '../../models/AiConversation';
import { resolveTimeZone } from '../../utils/dayKey';
import { sendToUser } from '../push/pushService';
import { composeNote, type ComposeContext, type NoteOpen } from './compose';
import { writeJournalEntry } from '../notes/aiNoteActions';
import { gate, isSlotDue, localDateKey, localMinutes, startOfLocalDay, type AiKind, type GatePolicy } from './gate';

export const CHANNEL_AI = 'lumen_ai_v1';
export const CHANNEL_SAFETY = 'lumen_safety_v1';
export const CHANNEL_HEADS_UP = 'lumen_heads_up_v1';
export const MAX_LOG_REPLIES_PER_DAY = 3;
export const MAX_TESTS_PER_DAY = 3;
/** When yesterday's health journal entry is written (member's local time). */
export const JOURNAL_SLOT = '06:00';

const KIND_TITLE: Record<AiNotificationKind, string> = {
  briefing: 'Morning briefing',
  nudge: 'Lumen AI nudge',
  check_in: 'Evening check-in',
  log_reply: 'About what you logged',
  test: 'Test notification',
};

export type DeliverStatus =
  | { status: 'off' | 'exists' | 'limit' }
  | { status: 'skipped'; reason: string }
  | { status: 'saved'; notification: IAiNotificationDoc };

function toGatePolicy(p: INotificationPolicyDoc): GatePolicy {
  return {
    masterEnabled: p.masterEnabled,
    dailyBudget: p.dailyBudget,
    quietHours: p.quietHours,
    flareModeActive: !!p.flareMode?.active,
    capabilities: p.capabilities,
    mutedUntil: p.mutedUntil ?? null,
  };
}

/** Intelligent notifications already delivered today (app-side producers and these), excluding safety and medicines. */
export async function countSentToday(userId: mongoose.Types.ObjectId, now: Date, timeZone: string): Promise<number> {
  return NotificationEvent.countDocuments({
    userId,
    reminderId: { $exists: false },
    notificationType: { $nin: ['SAFETY', 'MEDICATION'] },
    scheduledFor: { $gte: startOfLocalDay(now, timeZone), $lte: now },
  });
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

function routeFor(open: NoteOpen, conversationId: string): string {
  if (open === 'log') return '/check-in';
  if (open === 'insights') return '/(tabs)/insights';
  return `/ai/${conversationId}`;
}

export interface DeliverOptions {
  now?: Date;
  /** log_reply: which entry, and what the safety check said. */
  entryId?: string;
  logged?: ComposeContext['logged'];
  /** "Send a test" from Settings: push regardless of the budget (still needs Lumen AI on). */
  test?: boolean;
}

export async function deliverAiNote(userIdStr: string, kind: AiKind, opts: DeliverOptions = {}): Promise<DeliverStatus> {
  const now = opts.now ?? new Date();
  const userId = new mongoose.Types.ObjectId(userIdStr);
  const user = await User.findById(userId).select('preferences').lean();
  if (!user?.preferences?.aiFullAccess) return { status: 'off' };
  const timeZone = resolveTimeZone(user.preferences.timezone);
  const dateKey = localDateKey(now, timeZone);
  const storedKind: AiNotificationKind = opts.test ? 'test' : kind;

  const slotKey = opts.test ? `test:${now.getTime()}` : kind === 'log_reply' ? `log_reply:${opts.entryId}` : `${kind}:${dateKey}`;
  if (await AiNotification.exists({ userId, slotKey })) return { status: 'exists' };
  if (opts.test || kind === 'log_reply') {
    const limit = opts.test ? MAX_TESTS_PER_DAY : MAX_LOG_REPLIES_PER_DAY;
    if ((await AiNotification.countDocuments({ userId, kind: storedKind, dateKey })) >= limit) return { status: 'limit' };
  }

  const policy = await getOrCreatePolicy(userId);
  const sentToday = await countSentToday(userId, now, timeZone);
  const decision = opts.test ? { push: true as const } : gate(kind, toGatePolicy(policy), { now, timeZone, sentToday });
  if (!decision.push && !decision.compose) return { status: 'skipped', reason: decision.reason };

  const composed = await composeNote(userIdStr, opts.test ? 'test' : kind, {
    today: dateKey,
    time: hhmm(localMinutes(now, timeZone)),
    logged: opts.logged,
  });
  if (!composed.ok) return { status: 'skipped', reason: composed.reason };
  const { note } = composed;

  const conversation = await AiConversation.create({
    userId,
    title: `${KIND_TITLE[storedKind]} · ${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`,
    messages: [{
      role: 'assistant', text: `**${note.title}**\n\n${note.body}`, mediaIds: [], createdAt: now,
      provider: composed.provider as 'gemini' | 'claude', llmModel: composed.model,
    }],
  });
  const conversationId = String(conversation._id);
  const route = routeFor(note.open, conversationId);

  let doc: IAiNotificationDoc;
  try {
    doc = await AiNotification.create({
      userId, kind: storedKind, slotKey, dateKey, title: note.title, body: note.body, route, conversationId,
      pushed: false, reason: decision.push ? undefined : decision.reason, provider: composed.provider, llmModel: composed.model,
    });
  } catch (err) {
    // Another run got there first (unique slot); keep just one.
    await AiConversation.deleteOne({ _id: conversation._id });
    if ((err as { code?: number }).code === 11000) return { status: 'exists' };
    throw err;
  }

  if (decision.push) {
    const channelId = kind === 'log_reply' ? (policy.capabilities.safety ? CHANNEL_SAFETY : CHANNEL_HEADS_UP) : CHANNEL_AI;
    const sent = await sendToUser(userId, {
      title: note.title,
      body: note.body,
      channelId,
      data: { type: 'INTEL_AI_NOTE', route, aiNotificationId: String(doc._id), kind: storedKind, conversationId },
    });
    if (sent.ok) {
      doc.pushed = true;
      await doc.save();
      // Counts against today's budget, exactly like the app's own intelligent notifications.
      if (kind !== 'log_reply' && !opts.test) {
        await NotificationEvent.updateOne(
          { userId, clientId: `ai:${slotKey}` },
          { $setOnInsert: { userId, clientId: `ai:${slotKey}`, notificationType: 'AI_NOTE', status: 'TRIGGERED', scheduledFor: now, triggeredAt: now } },
          { upsert: true },
        );
      }
    } else {
      doc.reason = sent.reason;
      await doc.save();
    }
  }
  return { status: 'saved', notification: doc };
}

/** Which scheduled kinds are due for this policy at `now` (member's local time). */
export function dueKinds(policy: Pick<INotificationPolicyDoc, 'aiTimes' | 'capabilities'>, now: Date, timeZone: string): AiKind[] {
  const times = policy.aiTimes ?? { briefing: '08:00', nudge: '13:30', checkIn: '20:30' };
  const slots: [AiKind, string, boolean][] = [
    ['briefing', times.briefing, policy.capabilities?.aiBriefing !== false],
    ['nudge', times.nudge, policy.capabilities?.aiNudge !== false],
    ['check_in', times.checkIn, policy.capabilities?.aiCheckIn !== false],
  ];
  return slots.filter(([, slot, on]) => on && isSlotDue(slot, now, timeZone)).map(([k]) => k);
}

/** Called every 15 minutes. Members one after another, to stay gentle on the free-tier rate limit. */
export async function runDueAiNotifications(now = new Date()): Promise<number> {
  const users = await User.find({ 'preferences.aiFullAccess': true }).select('preferences.timezone preferences.aiJournal').lean();
  let saved = 0;
  for (const u of users) {
    try {
      const policy = await getOrCreatePolicy(u._id as mongoose.Types.ObjectId);
      const kinds = dueKinds(policy, now, resolveTimeZone(u.preferences?.timezone));
      for (const kind of kinds) {
        const res = await deliverAiNote(String(u._id), kind, { now });
        if (res.status === 'saved') saved++;
      }
      // The daily health journal: yesterday's entry, early in the member's morning.
      const tz = resolveTimeZone(u.preferences?.timezone);
      if (u.preferences?.aiJournal !== false && isSlotDue(JOURNAL_SLOT, now, tz)) {
        await writeJournalEntry(String(u._id), localDateKey(new Date(now.getTime() - 86_400_000), tz));
      }
    } catch (err) {
      console.error(`[ai-notify] failed for ${u._id}:`, (err as Error).message);
    }
  }
  return saved;
}

// ── Reply to a serious log ───────────────────────────────────────────────────

export const SEVERE_AT = 8;

interface LoggedEntry {
  _id: unknown;
  occurredAt: Date | string;
  answers?: { optionLabelSnapshot?: string | null; values?: { dataType: string; value?: unknown; unit?: string | null; canonicalValue?: number | null }[] }[];
}

/** Highest 0-10 severity in the entry, if any. */
export function maxSeverity(e: LoggedEntry): number {
  const vals = (e.answers ?? []).flatMap(a => (a.values ?? []).filter(v => v.dataType === 'range'))
    .map(v => Number(v.canonicalValue ?? v.value)).filter(n => Number.isFinite(n) && n <= 10);
  return vals.length ? Math.max(...vals) : 0;
}

export function describeEntry(e: LoggedEntry): string {
  return (e.answers ?? []).map(a => {
    const vals = (a.values ?? []).map(v => `${v.value ?? v.canonicalValue ?? ''}${v.unit ? ` ${v.unit}` : ''}`.trim()).filter(Boolean);
    return [a.optionLabelSnapshot, vals.join(', ')].filter(Boolean).join(': ');
  }).filter(Boolean).join('; ').slice(0, 400) || 'an entry';
}

/**
 * After entries are saved: a reply for each one that Lumen's safety check flagged or that has a
 * severity of 8/10 or more. Runs after the response was sent; never blocks or fails a save.
 */
export function reactToNewEntries(
  userId: string,
  entries: LoggedEntry[],
  flags: { level: 'today' | 'now'; title: string; message: string }[],
): void {
  const serious = entries.filter(e => flags.length > 0 || maxSeverity(e) >= SEVERE_AT);
  if (!serious.length) return;
  setImmediate(() => {
    (async () => {
      // One reply per save: the most severe entry, with every flag from this save.
      const entry = serious.reduce((a, b) => (maxSeverity(b) > maxSeverity(a) ? b : a));
      await deliverAiNote(userId, 'log_reply', {
        entryId: String(entry._id),
        logged: { when: new Date(entry.occurredAt).toISOString(), summary: describeEntry(entry), flags },
      });
    })().catch(err => console.error('[ai-notify] log reply failed:', (err as Error).message));
  });
}
