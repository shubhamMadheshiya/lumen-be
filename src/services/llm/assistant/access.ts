/**
 * Rules for turning Lumen AI access on and off. Pure, so the PIN and free-tier gates are tested
 * without a database. Used by routes/ai.ts POST /access.
 */

export interface AccessState {
  fullAccess: boolean;
  photoAccess: boolean;
  freeTierAcknowledged: boolean;
  hasPhotoPin: boolean;
}

export interface AccessRequest {
  fullAccess?: boolean;
  photoAccess?: boolean;
  acknowledgeFreeTier?: boolean;
}

export type AccessDecision =
  | { ok: true; next: Omit<AccessState, 'hasPhotoPin'>; acknowledgedNow: boolean }
  | { ok: false; status: 400 | 403; code: 'ACK_REQUIRED' | 'AI_ACCESS_OFF' | 'PIN_REQUIRED' | 'PIN_WRONG'; message: string };

/**
 * `pinValid` is the result of checking the submitted PIN, or null when no PIN was submitted.
 * Turning photos on needs the PIN only when one is set; turning anything off never needs it.
 */
export function decideAccess(current: AccessState, req: AccessRequest, pinValid: boolean | null): AccessDecision {
  const acknowledgedNow = !!req.acknowledgeFreeTier && !current.freeTierAcknowledged;
  const next = {
    fullAccess: current.fullAccess,
    photoAccess: current.photoAccess,
    freeTierAcknowledged: current.freeTierAcknowledged || !!req.acknowledgeFreeTier,
  };

  if (req.fullAccess === true) {
    if (!next.freeTierAcknowledged) {
      return { ok: false, status: 400, code: 'ACK_REQUIRED', message: 'Please read and accept the Gemini free-tier notice first.' };
    }
    next.fullAccess = true;
  }
  if (req.fullAccess === false) {
    next.fullAccess = false;
    next.photoAccess = false;
  }

  if (req.photoAccess === true) {
    if (!next.fullAccess) {
      return { ok: false, status: 400, code: 'AI_ACCESS_OFF', message: 'Turn on Lumen AI full access first.' };
    }
    if (current.hasPhotoPin) {
      if (pinValid === null) return { ok: false, status: 403, code: 'PIN_REQUIRED', message: 'Enter your photo PIN to allow photos.' };
      if (!pinValid) return { ok: false, status: 403, code: 'PIN_WRONG', message: 'That PIN is not right.' };
    }
    next.photoAccess = true;
  }
  if (req.photoAccess === false) next.photoAccess = false;

  return { ok: true, next, acknowledgedNow };
}
