import { describe, expect, it } from 'vitest';
import ryuData from '../data/characters/ryu.json';
import { parseActiveWindowFrames, parseRecoveryTotalFrames, parseStartupFirstActiveFrame } from './frameTotals';
import { getActionRecoverFrame, getWakeupDriveReversalImpactFrame } from './wakeupDriveReversal';
import { calculateWakeupDriveImpactGuard, DRIVE_IMPACT } from './wakeupDriveImpact';

describe('wakeup drive impact guard timing', () => {
  it('uses DI startup separately from wakeup drive reversal', () => {
    expect(DRIVE_IMPACT).toEqual({ startup: 26, active: 2 });
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 29, recoverFrame: 50 }))
      .toEqual({ impactFrame: 55, recoverFrame: 50, canBlock: true, safetyMargin: 5 });
    expect(getWakeupDriveReversalImpactFrame(29)).toBe(46);
  });

  it('keeps HPHK startup at 26 and applies it as an elapsed-frame offset', () => {
    const driveImpact = ryuData.moves.find(move => move.input === 'HPHK')!;
    expect(parseStartupFirstActiveFrame(driveImpact.startup)).toBe(DRIVE_IMPACT.startup);
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 1, recoverFrame: 27 }))
      .toEqual({ impactFrame: 27, recoverFrame: 27, canBlock: true, safetyMargin: 0 });
  });

  it('allows guarding on the exact first impact frame, but not one frame later', () => {
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 28, recoverFrame: 54 }))
      .toMatchObject({ canBlock: true, safetyMargin: 0 });
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 28, recoverFrame: 55 }))
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
      .toMatchObject({ impactFrame: 55, canBlock: true, safetyMargin: 1 });
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 28, recoverFrame }))
      .toMatchObject({ impactFrame: 54, canBlock: true, safetyMargin: 0 });
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 27, recoverFrame }))
      .toMatchObject({ impactFrame: 53, canBlock: false, safetyMargin: -1 });
  });

  it.each([null, NaN, Infinity, 0, -1, 54.5])('leaves unknown or invalid recovery unconfirmed: %s', (recoverFrame) => {
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame: 29, recoverFrame }))
      .toEqual({ impactFrame: 55, recoverFrame: null, canBlock: null, safetyMargin: null });
  });

  it.each([NaN, Infinity, 0, -1, 29.5])('does not claim safety for invalid wakeup: %s', (opponentWakeupFrame) => {
    expect(calculateWakeupDriveImpactGuard({ opponentWakeupFrame, recoverFrame: 54 }))
      .toMatchObject({ impactFrame: null, canBlock: null, safetyMargin: null });
  });
});
