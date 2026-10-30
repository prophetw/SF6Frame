import { describe, expect, it } from 'vitest';
import ryuData from '../data/characters/ryu.json';
import { calculateDriveRushAttackTiming } from './driveRush';
import { parseActiveWindowFrames, parseStartupFirstActiveFrame } from './frameTotals';
import { getCompatibleKnockdownGroups, getSafePressureWakeupRange } from './okiPressure';

describe('safe pressure wakeup range', () => {
  it('extends before the active frames while excluding the 4F trade boundary', () => {
    const range = getSafePressureWakeupRange({ activeStart: 31, activeEnd: 34, opponentStartup: 4 });
    expect(range).toEqual({ start: 29, end: 34 });

    // Check the inverse range against the existing forward overlap rule.
    for (let wakeup = 25; wakeup <= 37; wakeup++) {
      const firstOpponentActive = wakeup + 4 - 1;
      const pressureSucceeds = 34 >= wakeup && 31 < firstOpponentActive;
      expect(wakeup >= range!.start && wakeup <= range!.end).toBe(pressureSucceeds);
    }
  });

  it('recomputes the extension for the current opponent startup', () => {
    expect(getSafePressureWakeupRange({ activeStart: 31, activeEnd: 34, opponentStartup: 6 }))
      .toEqual({ start: 27, end: 34 });
    expect(getSafePressureWakeupRange({ activeStart: 31, activeEnd: 34, opponentStartup: 2 }))
      .toEqual({ start: 31, end: 34 });
  });

  it('uses Ryu drive rush overhead data for the 31~34F example', () => {
    const overhead = ryuData.moves.find(move => move.input === '6MP')!;
    const timing = calculateDriveRushAttackTiming({
      driveRushStartFrame: 0,
      moveStartup: parseStartupFirstActiveFrame(overhead.startup)!,
      activeLength: parseActiveWindowFrames(overhead.active)!,
    });
    expect([timing.firstActiveFrame, timing.lastActiveFrame]).toEqual([31, 34]);
    expect(getSafePressureWakeupRange({
      activeStart: timing.firstActiveFrame,
      activeEnd: timing.lastActiveFrame,
      opponentStartup: 4,
    })).toEqual({ start: 29, end: 34 });
  });

  it('has no pre-active pressure window against 1F startup', () => {
    expect(getSafePressureWakeupRange({ activeStart: 31, activeEnd: 34, opponentStartup: 1 })).toBeNull();
  });

  it('supports a single active frame and clamps to the first timeline frame', () => {
    expect(getSafePressureWakeupRange({ activeStart: 2, activeEnd: 2, opponentStartup: 4 }))
      .toEqual({ start: 1, end: 2 });
  });

  it.each([
    { activeStart: 0, activeEnd: 4, opponentStartup: 4 },
    { activeStart: 31, activeEnd: 30, opponentStartup: 4 },
    { activeStart: NaN, activeEnd: 34, opponentStartup: 4 },
    { activeStart: 31, activeEnd: Infinity, opponentStartup: 4 },
    { activeStart: 31, activeEnd: 34, opponentStartup: 0 },
    { activeStart: 31, activeEnd: 34, opponentStartup: 4.5 },
  ])('rejects invalid timing: %j', (params) => {
    expect(getSafePressureWakeupRange(params)).toBeNull();
  });

  it('keeps a projectile within its calibrated contact window', () => {
    expect(getSafePressureWakeupRange({
      activeStart: 42,
      activeEnd: 42,
      opponentStartup: 4,
      projectileContactRange: { start: 40, end: 44 },
    })).toEqual({ start: 40, end: 44 });
    expect(getSafePressureWakeupRange({
      activeStart: 42,
      activeEnd: 42,
      opponentStartup: 1,
      projectileContactRange: { start: 40, end: 44 },
    })).toBeNull();
  });
});

describe('route memory', () => {
  const knockdowns = [
    { name: 'too early', input: 'A', advantage: 27 },
    { name: 'sweep', input: '2HK', advantage: 28 },
    { name: 'custom combo', input: 'combo', advantage: 28 },
    { name: 'throw', input: 'LP+LK', advantage: 33 },
    { name: 'too late', input: 'B', advantage: 34 },
  ];

  it('groups equivalent knockdowns including custom routes using advantage + 1', () => {
    expect(getCompatibleKnockdownGroups([...knockdowns].reverse(), { start: 29, end: 34 }))
      .toEqual([
        { advantage: 28, wakeupFrame: 29, moves: [knockdowns[2], knockdowns[1]] },
        { advantage: 33, wakeupFrame: 34, moves: [knockdowns[3]] },
      ]);
  });

  it('deduplicates presets without dropping different routes with the same advantage', () => {
    const groups = getCompatibleKnockdownGroups([...knockdowns, ...knockdowns], { start: 29, end: 34 });
    expect(groups.map(group => group.moves.length)).toEqual([2, 1]);
  });

  it('does not recommend a route without a safe window or with invalid knockdowns', () => {
    expect(getCompatibleKnockdownGroups(knockdowns, null)).toEqual([]);
    expect(getCompatibleKnockdownGroups([
      { name: 'unknown', input: '', advantage: NaN },
      { name: 'invalid', input: '', advantage: 0 },
    ], { start: 1, end: 34 })).toEqual([]);
  });
});
