import { describe, expect, it } from 'vitest';
import type { Move } from '../types';
import {
  calculateDriveRushAttackTiming,
  getDriveRushActionTotalFrames,
  getFastestDriveRushHitFrame,
  isDriveRushFollowUpMove,
} from './driveRush';

const buildMove = (overrides: Partial<Move>): Move => ({
  name: 'Stand LP',
  input: '5LP',
  damage: '300',
  startup: '4',
  active: '3',
  recovery: '7',
  onBlock: '-1',
  onHit: '+4',
  category: 'normal',
  ...overrides,
});

describe('driveRush', () => {
  it('calculates fastest hit frame using inclusive startup counting', () => {
    expect(getFastestDriveRushHitFrame(4)).toBe(13);
    expect(getFastestDriveRushHitFrame(20)).toBe(29);
  });

  it('calculates drive rush follow-up timing from an existing prefix', () => {
    expect(calculateDriveRushAttackTiming({
      driveRushStartFrame: 19,
      moveStartup: 4,
      activeLength: 3,
    })).toEqual({
      driveRushStartFrame: 19,
      attackStartFrame: 29,
      fastestHitFrame: 32,
      firstActiveFrame: 32,
      lastActiveFrame: 34,
    });
  });

  it('adds the inclusive drive rush offset when used as a chain action', () => {
    expect(getDriveRushActionTotalFrames(buildMove({
      raw: { total: 13 },
    }))).toBe(22);
  });

  it('allows grounded non-throw moves as drive rush follow-ups', () => {
    expect(isDriveRushFollowUpMove(buildMove({
      name: 'Collarbone Breaker',
      input: '6MP',
      startup: '20',
      category: 'unique',
    }))).toBe(true);
  });

  it('does not treat throws or airborne moves as frame-10 drive rush follow-ups', () => {
    expect(isDriveRushFollowUpMove(buildMove({
      name: 'Forward Throw',
      input: '5LP+LK',
      category: 'throw',
    }))).toBe(false);

    expect(isDriveRushFollowUpMove(buildMove({
      name: 'Jump HP',
      input: 'j.HP',
    }))).toBe(false);
  });
});
