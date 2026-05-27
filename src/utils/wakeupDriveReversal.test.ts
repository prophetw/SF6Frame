import { describe, expect, it } from 'vitest';
import {
  canBlockWakeupDriveReversal,
  getActionRecoverFrame,
  getSafeBaitLimitFrame,
  getWakeupDriveReversalImpactFrame,
  isSafeBaitTotalFrames,
  WAKEUP_DRIVE_REVERSAL,
} from './wakeupDriveReversal';

describe('wakeupDriveReversal', () => {
  it('uses frame 18 as wakeup drive reversal impact', () => {
    expect(WAKEUP_DRIVE_REVERSAL.startup).toBe(18);
    expect(WAKEUP_DRIVE_REVERSAL.impactOffset).toBe(17);
    expect(getWakeupDriveReversalImpactFrame(39)).toBe(56);
  });

  it('marks a short meaty as safe against wakeup drive reversal', () => {
    const recoverFrame = getActionRecoverFrame({
      actionStartFrame: -5,
      startup: 4,
      active: 2,
      recovery: 7,
    });

    expect(recoverFrame).toBe(8);
    expect(canBlockWakeupDriveReversal({
      recoverFrame,
      opponentWakeupFrame: 0,
    })).toBe(true);
  });

  it('rejects a meaty that has not recovered before drive reversal impact', () => {
    const recoverFrame = getActionRecoverFrame({
      actionStartFrame: -3,
      startup: 8,
      active: 3,
      recovery: 20,
    });

    expect(recoverFrame).toBe(28);
    expect(canBlockWakeupDriveReversal({
      recoverFrame,
      opponentWakeupFrame: 0,
    })).toBe(false);
  });

  it('treats safe bait as total frames before wakeup plus opponent startup', () => {
    expect(getSafeBaitLimitFrame({
      opponentWakeupFrame: 39,
      opponentMoveStartup: 18,
    })).toBe(56);

    expect(isSafeBaitTotalFrames({
      totalFrames: 56,
      opponentWakeupFrame: 39,
      opponentMoveStartup: 18,
    })).toBe(true);

    expect(isSafeBaitTotalFrames({
      totalFrames: 57,
      opponentWakeupFrame: 39,
      opponentMoveStartup: 18,
    })).toBe(false);
  });
});
