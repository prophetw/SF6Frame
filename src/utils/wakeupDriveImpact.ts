export const DRIVE_IMPACT = {
  startup: 26,
  active: 2,
} as const;

export interface WakeupDriveImpactGuard {
  impactFrame: number | null;
  recoverFrame: number | null;
  canBlock: boolean | null;
  safetyMargin: number | null;
}

/** Compares the first guardable frame with a DI started on the first wakeup frame. */
export function calculateWakeupDriveImpactGuard(params: {
  opponentWakeupFrame: number;
  recoverFrame: number | null;
}): WakeupDriveImpactGuard {
  const wakeupValid = Number.isInteger(params.opponentWakeupFrame) && params.opponentWakeupFrame >= 1;
  const recoverValid = params.recoverFrame !== null
    && Number.isInteger(params.recoverFrame) && params.recoverFrame >= 1;
  const impactFrame = wakeupValid ? params.opponentWakeupFrame + DRIVE_IMPACT.startup - 1 : null;
  const recoverFrame = recoverValid ? params.recoverFrame : null;
  const safetyMargin = impactFrame !== null && recoverFrame !== null ? impactFrame - recoverFrame : null;

  return {
    impactFrame,
    recoverFrame,
    canBlock: safetyMargin !== null ? safetyMargin >= 0 : null,
    safetyMargin,
  };
}
