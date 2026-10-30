import { describe, expect, it } from 'vitest';
import ryuData from '../data/characters/ryu.json';
import { parseActiveWindowFrames, parseRecoveryTotalFrames, parseStartupFirstActiveFrame } from './frameTotals';
import { getActionRecoverFrame, getWakeupDriveReversalImpactFrame } from './wakeupDriveReversal';
import { calculateWakeupDriveImpactGuard, DRIVE_IMPACT } from './wakeupDriveImpact';

describe('wakeup drive impact guard timing', () => {
  it('uses DI startup separately from wakeup drive reversal', () => {
    expect(DRIVE_IMPACT).toEqual({ startup: 26, active: 2 });
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 29, recoverFrame: 50 }))
      .toEqual({ impactFrame: 54, recoverFrame: 50, canBlock: true, safetyMargin: 4 });
    expect(getWakeupDriveReversalImpactFrame(29)).toBe(46);
  });

  it('allows guarding on the exact first impact frame, but not one frame later', () => {
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 29, recoverFrame: 54 }))
      .toMatchObject({ canBlock: true, safetyMargin: 0 });
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 29, recoverFrame: 55 }))
      .toMatchObject({ canBlock: false, safetyMargin: -1 });
  });

  it('recomputes the boundary for Ryu drive rush 6MP as wakeup timing changes', () => {
    const overhead = ryuData.moves.find(move => move.input === '6MP')!;
    const recoverFrame = getActionRecoverFrame({
      actionStartFrame: 11,
      startup: parseStartupFirstActiveFrame(overhead.startup)!,
      active: parseActiveWindowFrames(overhead.active)!,
      recovery: parseRecoveryTotalFrames(overhead.recovery)!,
    });
    expect(recoverFrame).toBe(54);
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 29, recoverFrame }))
      .toMatchObject({ canBlock: true, safetyMargin: 0 });
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 28, recoverFrame }))
      .toMatchObject({ canBlock: false, safetyMargin: -1 });
  });

  it.each([null, NaN, Infinity, 0, -1, 54.5])('leaves unknown or invalid recovery unconfirmed: %s', (recoverFrame) => {
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 29, recoverFrame }))
      .toEqual({ impactFrame: 54, recoverFrame: null, canBlock: null, safetyMargin: null });
  });

  it.each([NaN, Infinity, 0, -1, 29.5])('does not claim safety for invalid wakeup: %s', (opponentWakeupFrame) => {
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame, recoverFrame: 54 }))
      .toMatchObject({ impactFrame: null, canBlock: null, safetyMargin: null });
  });
});
