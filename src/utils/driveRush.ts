import type { Move } from '../types';
import { calculateMoveTotalFrames, parseStartupFirstActiveFrame } from './frameTotals';
import { isAirborneMove } from './moveFilters';

/**
 * Timing origin: Parry Drive Rush frame 1.
 *
 * SF6 rule: Parry Drive Rush can cancel into an attack from frame 10.
 * The oki calculator treats the earliest follow-up hit as frame 10 + move startup.
 */
export const PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME = 10;
export const DRIVE_RUSH_EFFECTIVE_STARTUP_OFFSET = PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME;
export const DRIVE_RUSH_FRAME_ADVANTAGE_BONUS = 4;

export function getFastestDriveRushHitFrame(moveStartup: number): number {
  return PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME + moveStartup;
}

export type DriveRushAttackTiming = {
  driveRushStartFrame: number;
  attackStartFrame: number;
  fastestHitFrame: number;
  firstActiveFrame: number;
  lastActiveFrame: number;
};

export function calculateDriveRushAttackTiming(params: {
  driveRushStartFrame: number;
  moveStartup: number;
  activeStartOffset?: number;
  activeLength?: number;
}): DriveRushAttackTiming {
  const activeStartOffset = params.activeStartOffset ?? 0;
  const activeLength = Math.max(1, params.activeLength ?? 1);
  const attackStartFrame = params.driveRushStartFrame + PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME;
  const fastestHitFrame = params.driveRushStartFrame + getFastestDriveRushHitFrame(params.moveStartup);
  const firstActiveFrame = fastestHitFrame + activeStartOffset;

  return {
    driveRushStartFrame: params.driveRushStartFrame,
    attackStartFrame,
    fastestHitFrame,
    firstActiveFrame,
    lastActiveFrame: firstActiveFrame + activeLength - 1,
  };
}

export function getDriveRushActionTotalFrames(move: Pick<Move, 'startup' | 'active' | 'recovery' | 'raw'>): number | null {
  const moveTotalFrames = calculateMoveTotalFrames(move);
  return moveTotalFrames === null ? null : DRIVE_RUSH_EFFECTIVE_STARTUP_OFFSET + moveTotalFrames;
}

export function getDriveRushMoveStartup(move: Pick<Move, 'startup'>): number | null {
  return parseStartupFirstActiveFrame(move.startup);
}

export function isDriveRushFollowUpMove(move: Move): boolean {
  if (move.category === 'throw') return false;
  if (isAirborneMove(move)) return false;

  const startup = getDriveRushMoveStartup(move);
  return startup !== null && startup > 0;
}
