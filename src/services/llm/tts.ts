/**
 * Lumen AI's spoken replies: Gemini text-to-speech. The app plays the WAV, and falls back to the
 * phone's own voice whenever this fails (no key, free-tier limit, network), so errors here are
 * normal outcomes, not exceptions.
 *
 * Measured 2026-11-16 with gemini-3.8-flash-lite-tts: ~1-3 s per sentence or two, returns
 * audio/wav, handles English, Hinglish and Devanagari Hindi. Older TTS models return raw 16-bit
 * PCM (audio/L16;rate=24000), which is wrapped in a WAV header here.
 *
 * The free tier allows only ~10 TTS requests per model per day, so several TTS models are tried
 * in turn (config.gemini.ttsModels); one that answers 429 is skipped until its quota resets.
 */
import { config } from '../../config';

export const TTS_VOICES = [
  { id: 'Kore', label: 'Kore', tone: 'Female · firm, clear' },
  { id: 'Aoede', label: 'Aoede', tone: 'Female · breezy' },
  { id: 'Leda', label: 'Leda', tone: 'Female · youthful' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Female · bright' },
  { id: 'Sulafat', label: 'Sulafat', tone: 'Female · warm' },
  { id: 'Puck', label: 'Puck', tone: 'Male · upbeat' },
  { id: 'Charon', label: 'Charon', tone: 'Male · informative' },
  { id: 'Orus', label: 'Orus', tone: 'Male · firm' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Male · lively' },
  { id: 'Achird', label: 'Achird', tone: 'Male · friendly' },
] as const;
export const DEFAULT_TTS_VOICE = 'Kore';
export const MAX_TTS_CHARS = 1200;
const TTS_TIMEOUT_MS = 20_000;

export type TtsResult =
  | { ok: true; mimeType: 'audio/wav'; base64: string }
  | { ok: false; error: 'not_configured' | 'rate_limited' | 'failed' | 'timeout' };

export function isKnownVoice(id: string): boolean {
  return TTS_VOICES.some(v => v.id === id);
}

/** A 44-byte RIFF/WAVE header in front of 16-bit little-endian mono PCM. */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** For tests. */
export function setTtsFetchForTesting(f: Fetch | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

/** Model → time (ms) until which it is out of free-tier quota. */
const exhaustedUntil = new Map<string, number>();
const DEFAULT_BACKOFF_MS = 60_000;

/** For tests. */
export function resetTtsQuotaForTesting(): void {
  exhaustedUntil.clear();
}

/** Google's RetryInfo ("51722s") from a 429 body, in ms. */
export function retryDelayMs(body: unknown): number {
  const details = (body as { error?: { details?: { retryDelay?: string }[] } })?.error?.details ?? [];
  const delay = details.map(d => d.retryDelay).find(Boolean);
  const seconds = delay ? Number(/^(\d+(?:\.\d+)?)s$/.exec(delay)?.[1]) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_BACKOFF_MS;
}

type Attempt = TtsResult | { ok: false; error: 'quota'; retryMs: number };

async function tryModel(model: string, text: string, voiceName: string): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
        signal: controller.signal,
      },
    );
    if (res.status === 429) {
      const body = await Promise.resolve().then(() => res.json()).catch(() => null);
      return { ok: false, error: 'quota', retryMs: retryDelayMs(body) };
    }
    if (!res.ok) {
      console.error(`[tts] ${model} failed:`, res.status);
      return { ok: false, error: 'failed' };
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
    const audio = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
    if (!audio?.data) return { ok: false, error: 'failed' };
    const mime = (audio.mimeType ?? '').toLowerCase();
    if (mime.includes('wav')) return { ok: true, mimeType: 'audio/wav', base64: audio.data };
    if (mime.includes('l16') || mime.includes('pcm')) {
      const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24_000);
      return { ok: true, mimeType: 'audio/wav', base64: pcmToWav(Buffer.from(audio.data, 'base64'), rate).toString('base64') };
    }
    console.error('[tts] unexpected audio type:', mime);
    return { ok: false, error: 'failed' };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return { ok: false, error: 'timeout' };
    console.error('[tts] Gemini TTS error:', (err as Error).message);
    return { ok: false, error: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeSpeech(text: string, voice?: string, now = () => Date.now()): Promise<TtsResult> {
  if (!config.gemini.apiKey) return { ok: false, error: 'not_configured' };
  const voiceName = voice && isKnownVoice(voice) ? voice : DEFAULT_TTS_VOICE;
  const input = text.slice(0, MAX_TTS_CHARS);
  let last: TtsResult = { ok: false, error: 'rate_limited' };
  for (const model of config.gemini.ttsModels) {
    if ((exhaustedUntil.get(model) ?? 0) > now()) continue;
    const attempt = await tryModel(model, input, voiceName);
    if (attempt.ok) return attempt;
    if (attempt.error === 'quota') {
      exhaustedUntil.set(model, now() + attempt.retryMs);
      last = { ok: false, error: 'rate_limited' };
      continue;
    }
    // A timeout or other failure: the next model probably won't do better right now.
    return attempt;
  }
  return last;
}
