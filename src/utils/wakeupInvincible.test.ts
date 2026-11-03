import { describe, expect, it } from 'vitest';
import ryuData from '../data/characters/ryu.json';
import { getDriveRushActionTotalFrames } from './driveRush';
import { calculateWakeupInvincibleGuard } from './wakeupInvincible';

describe('wakeup invincible guard and bait recommendations', () => {
  const guard = (totalFrames: number | null, opponentWakeupFrame = 29, invincibleStartup = 5) =>
    calculateWakeupInvincibleGuard({ totalFrames, opponentWakeupFrame, invincibleStartup });

  it('uses the agreed +28F knockdown example, including strict safety and margin', () => {
    expect(guard(31)).toMatchObject({ impactFrame: 34, latestSafeTotalFrames: 33, canBlock: true, safetyMargin: 2 });
    expect(guard(33)).toMatchObject({ canBlock: true, safetyMargin: 0 });
    expect(guard(34)).toMatchObject({ canBlock: false, safetyMargin: -1, isRecommendedBait: false });
  });

  it('recommends only recovery from 3F before wakeup through the last safe frame', () => {
    expect(guard(25)).toMatchObject({ canBlock: true, isRecommendedBait: false });
    for (let frame = 26; frame <= 33; frame++) expect(guard(frame).isRecommendedBait).toBe(true);
    // A large knockdown does not turn every fast move into a recommendation.
    expect(guard(31, 81)).toMatchObject({ canBlock: true, isRecommendedBait: false });
    expect(guard(78, 81).isRecommendedBait).toBe(true);
  });

  it('includes green rush and every prefix frame in the action total', () => {
    const jab = ryuData.moves.find(move => move.input === '5LP')!;
    const total = getDriveRushActionTotalFrames(jab)!;
    expect(total).toBe(24);
    expect(guard(total)).toMatchObject({ canBlock: true, isRecommendedBait: false });
    expect(guard(2 + total).isRecommendedBait).toBe(true);
    expect(guard(9 + total)).toMatchObject({ canBlock: true, safetyMargin: 0 });
    expect(guard(10 + total).canBlock).toBe(false);
  });

  it('can change invincible timing independently from ordinary startup', () => {
    expect(guard(34, 29, 6)).toMatchObject({ impactFrame: 35, canBlock: true, safetyMargin: 0 });
    expect(guard(34)).toMatchObject({ impactFrame: 34, canBlock: false });
  });

  it.each([null, NaN, Infinity, 0, -1, 31.5])('does not claim safety for unknown or invalid totals: %s', totalFrames => {
    expect(guard(totalFrames)).toMatchObject({ totalFrames: null, canBlock: null, safetyMargin: null, isRecommendedBait: false });
  });

  it.each([NaN, Infinity, 0, -1, 29.5])('rejects invalid wakeup or startup frames: %s', value => {
    expect(guard(31, value)).toMatchObject({ canBlock: null, isRecommendedBait: false });
    expect(guard(31, 29, value)).toMatchObject({ canBlock: null, isRecommendedBait: false });
  });
});
