export const DEFAULT_INVINCIBLE_STARTUP = 5;
export const BAIT_EARLY_RECOVERY_FRAMES = 3;
export const BAIT_PREVIEW_COUNT = 5;

export interface WakeupInvincibleGuard {
  totalFrames: number | null;
  impactFrame: number | null;
  latestSafeTotalFrames: number | null;
  canBlock: boolean | null;
  safetyMargin: number | null;
  isRecommendedBait: boolean;
}

/**
 * Additive timing requested by the calculator: wakeup 29 + 5 = impact 34.
 * totalFrames is the LAST occupied frame, not the first guardable frame.
 * The route must finish strictly before impact; margin 0 is the last safe frame.
 */
export function calculateWakeupInvincibleGuard(params: {
  opponentWakeupFrame: number;
  totalFrames: number | null;
  invincibleStartup?: number;
}): WakeupInvincibleGuard {
  const startup = params.invincibleStartup ?? DEFAULT_INVINCIBLE_STARTUP;
  const validFrame = (value: number | null): value is number =>
    value !== null && Number.isInteger(value) && value >= 1;
  const impactFrame = validFrame(params.opponentWakeupFrame) && validFrame(startup)
    ? params.opponentWakeupFrame + startup : null;
  const totalFrames = validFrame(params.totalFrames) ? params.totalFrames : null;
  const latestSafeTotalFrames = impactFrame !== null ? impactFrame - 1 : null;
  const safetyMargin = latestSafeTotalFrames !== null && totalFrames !== null
    ? latestSafeTotalFrames - totalFrames : null;
  const canBlock = safetyMargin !== null ? safetyMargin >= 0 : null;

  return {
    totalFrames,
    impactFrame,
    latestSafeTotalFrames,
    canBlock,
    safetyMargin,
    isRecommendedBait: canBlock === true && totalFrames !== null
      && totalFrames >= params.opponentWakeupFrame - BAIT_EARLY_RECOVERY_FRAMES,
  };
}
