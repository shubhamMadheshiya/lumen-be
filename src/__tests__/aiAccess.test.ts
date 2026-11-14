import { decideAccess, type AccessState } from '../services/llm/assistant/access';

const off: AccessState = { fullAccess: false, photoAccess: false, freeTierAcknowledged: false, hasPhotoPin: false };

describe('decideAccess', () => {
  it('refuses full access until the free-tier notice is accepted', () => {
    expect(decideAccess(off, { fullAccess: true }, null)).toMatchObject({ ok: false, code: 'ACK_REQUIRED' });
  });

  it('turns full access on when the notice is accepted in the same request, and records it once', () => {
    const d = decideAccess(off, { fullAccess: true, acknowledgeFreeTier: true }, null);
    expect(d).toMatchObject({ ok: true, acknowledgedNow: true, next: { fullAccess: true, photoAccess: false, freeTierAcknowledged: true } });
    const again = decideAccess({ ...off, freeTierAcknowledged: true }, { acknowledgeFreeTier: true }, null);
    expect(again).toMatchObject({ ok: true, acknowledgedNow: false });
  });

  it('does not allow photos without full access', () => {
    expect(decideAccess({ ...off, freeTierAcknowledged: true }, { photoAccess: true }, null)).toMatchObject({ ok: false, code: 'AI_ACCESS_OFF' });
  });

  it('allows photos without a PIN when the member has not set one', () => {
    const on = { ...off, fullAccess: true, freeTierAcknowledged: true };
    expect(decideAccess(on, { photoAccess: true }, null)).toMatchObject({ ok: true, next: { photoAccess: true } });
  });

  it('needs the right photo PIN to allow photos when one is set', () => {
    const on = { fullAccess: true, photoAccess: false, freeTierAcknowledged: true, hasPhotoPin: true };
    expect(decideAccess(on, { photoAccess: true }, null)).toMatchObject({ ok: false, status: 403, code: 'PIN_REQUIRED' });
    expect(decideAccess(on, { photoAccess: true }, false)).toMatchObject({ ok: false, status: 403, code: 'PIN_WRONG' });
    expect(decideAccess(on, { photoAccess: true }, true)).toMatchObject({ ok: true, next: { photoAccess: true } });
  });

  it('turning full access off also turns photos off, and never needs the PIN', () => {
    const allOn = { fullAccess: true, photoAccess: true, freeTierAcknowledged: true, hasPhotoPin: true };
    expect(decideAccess(allOn, { fullAccess: false }, null)).toMatchObject({ ok: true, next: { fullAccess: false, photoAccess: false } });
    expect(decideAccess(allOn, { photoAccess: false }, null)).toMatchObject({ ok: true, next: { fullAccess: true, photoAccess: false } });
  });
});
