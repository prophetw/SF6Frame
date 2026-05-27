export const WAKEUP_DRIVE_REVERSAL = {
  startup: 18,
  impactOffset: 17,
  onBlock: -6,
  onBlockWhenBlockerBurnout: -2,
  invincibleStartOffset: 0,
  invincibleEndOffset: 16,
  driveCost: 2,
} as const;

export type RecoverFrameParams = {
  actionStartFrame: number;
  startup: number;
  active: number;
  recovery: number;
};

export function getActionRecoverFrame(params: RecoverFrameParams): number {
  return params.actionStartFrame + params.startup + params.active + params.recovery;
}

export function getWakeupDriveReversalImpactFrame(opponentWakeupFrame: number): number {
  return opponentWakeupFrame + WAKEUP_DRIVE_REVERSAL.impactOffset;
}

export function canBlockWakeupDriveReversal(params: {
  recoverFrame: number;
  opponentWakeupFrame: number;
}): boolean {
  return params.recoverFrame <= getWakeupDriveReversalImpactFrame(params.opponentWakeupFrame);
}

export function getSafeBaitLimitFrame(params: {
  opponentWakeupFrame: number;
  opponentMoveStartup: number;
}): number {
  return params.opponentWakeupFrame + params.opponentMoveStartup - 1;
}

export function isSafeBaitTotalFrames(params: {
  totalFrames: number;
  opponentWakeupFrame: number;
  opponentMoveStartup: number;
}): boolean {
  return params.totalFrames < params.opponentWakeupFrame + params.opponentMoveStartup;
}
