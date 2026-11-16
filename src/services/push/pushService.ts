/**
 * Expo push, over Expo's HTTP API (https://exp.host/--/api/v2/push/send). Expo forwards to FCM
 * (Android). The member accepted that Lumen AI notification text passes through Expo and Google.
 * Tokens that Expo reports as DeviceNotRegistered are deleted.
 */
import mongoose from 'mongoose';
import { config } from '../../config';
import { PushToken } from '../../models/PushToken';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const CHUNK = 100;
const RECEIPT_DELAY_MS = 30 * 60_000;

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Android notification channel; it must exist on the device. */
  channelId?: string;
}

export type PushResult = { ok: true; sent: number } | { ok: false; reason: 'no_token' | 'failed' };

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
let scheduleReceiptCheck: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms).unref?.(); };
/** For tests. */
export function setPushTransportForTesting(f: Fetch | null, schedule?: (fn: () => void, ms: number) => void): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
  scheduleReceiptCheck = schedule ?? ((fn, ms) => { setTimeout(fn, ms).unref?.(); });
}

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(config.expo.accessToken ? { Authorization: `Bearer ${config.expo.accessToken}` } : {}),
  };
}

async function dropTokens(tokens: string[]): Promise<void> {
  if (tokens.length) await PushToken.deleteMany({ token: { $in: tokens } });
}

async function checkReceipts(ids: Map<string, string>): Promise<void> {
  try {
    const res = await fetchImpl(RECEIPTS_URL, { method: 'POST', headers: headers(), body: JSON.stringify({ ids: [...ids.keys()] }) });
    if (!res.ok) return;
    const json = (await res.json()) as { data?: Record<string, { status: string; details?: { error?: string } }> };
    const dead = Object.entries(json.data ?? {})
      .filter(([, r]) => r.status === 'error' && r.details?.error === 'DeviceNotRegistered')
      .map(([id]) => ids.get(id)!)
      .filter(Boolean);
    await dropTokens(dead);
  } catch (err) {
    console.error('[push] receipt check failed:', (err as Error).message);
  }
}

export async function sendToUser(userId: string | mongoose.Types.ObjectId, msg: PushMessage): Promise<PushResult> {
  const tokens = (await PushToken.find({ userId }).select('token').lean()).map(t => t.token).filter(isExpoPushToken);
  if (!tokens.length) return { ok: false, reason: 'no_token' };

  const messages = tokens.map(to => ({
    to,
    title: msg.title,
    body: msg.body,
    data: msg.data ?? {},
    sound: 'default',
    priority: 'high',
    ...(msg.channelId ? { channelId: msg.channelId } : {}),
  }));

  let sent = 0;
  const dead: string[] = [];
  const receiptIds = new Map<string, string>();
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetchImpl(SEND_URL, { method: 'POST', headers: headers(), body: JSON.stringify(chunk) });
      if (!res.ok) {
        console.error('[push] send failed:', res.status);
        continue;
      }
      const json = (await res.json()) as { data?: Ticket[] };
      (json.data ?? []).forEach((ticket, j) => {
        const token = chunk[j]?.to;
        if (ticket.status === 'ok') {
          sent++;
          if (token) receiptIds.set(ticket.id, token);
        } else if (ticket.details?.error === 'DeviceNotRegistered' && token) {
          dead.push(token);
        } else {
          console.error('[push] ticket error:', ticket.message ?? ticket.details?.error);
        }
      });
    } catch (err) {
      console.error('[push] send error:', (err as Error).message);
    }
  }
  await dropTokens(dead);
  if (receiptIds.size) scheduleReceiptCheck(() => { checkReceipts(receiptIds).catch(() => undefined); }, RECEIPT_DELAY_MS);
  return sent > 0 ? { ok: true, sent } : { ok: false, reason: dead.length === tokens.length ? 'no_token' : 'failed' };
}
