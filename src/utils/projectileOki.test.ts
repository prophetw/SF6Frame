import { describe, expect, it } from 'vitest';
import type { Move } from '../types';
import {
  calculateRyuHadokenCornerOkiGuardAdvantage,
  calculateRyuHadokenOkiGuardAdvantage,
  getRyuHadokenCornerOkiContactWindow,
  getRyuHadokenOkiData,
  isRyuHadokenOkiMove,
} from './projectileOki';

const buildMove = (overrides: Partial<Move>): Move => ({
  name: 'Hadoken',
  input: '236LP',
  damage: '700',
  startup: '16',
  active: '-',
  recovery: '31',
  onBlock: '-5',
  onHit: '+2',
  category: 'special',
  ...overrides,
});

describe('projectileOki', () => {
  it('only enables the Ryu Hadoken variants used by oki routing', () => {
    expect(isRyuHadokenOkiMove('ryu', buildMove({ input: '236LP' }))).toBe(true);
    expect(isRyuHadokenOkiMove('ryu', buildMove({ input: '236MP' }))).toBe(true);
    expect(isRyuHadokenOkiMove('ryu', buildMove({ input: '236HP' }))).toBe(true);
    expect(isRyuHadokenOkiMove('ryu', buildMove({ input: '236PP' }))).toBe(true);
    expect(isRyuHadokenOkiMove('ken', buildMove({ input: '236LP' }))).toBe(false);
    expect(isRyuHadokenOkiMove('ryu', buildMove({ input: '236236P' }))).toBe(false);
  });

  it('derives normal Hadoken blockstun from point blank frame data', () => {
    const lp = getRyuHadokenOkiData('ryu', buildMove({ input: '236LP', startup: '16', recovery: '31', onBlock: '-5' }));
    const mp = getRyuHadokenOkiData('ryu', buildMove({ input: '236MP', startup: '14', recovery: '33', onBlock: '-7' }));
    const hp = getRyuHadokenOkiData('ryu', buildMove({ input: '236HP', startup: '12', recovery: '35', onBlock: '-9' }));

    expect(lp).toMatchObject({ totalFrames: 47, blockstun: 26 });
    expect(mp).toMatchObject({ totalFrames: 47, blockstun: 26 });
    expect(hp).toMatchObject({ totalFrames: 47, blockstun: 26 });
  });

  it('calculates normal Hadoken guard advantage from input-to-block frame', () => {
    const move = buildMove({ input: '236LP', startup: '16', recovery: '31', onBlock: '-5' });

    expect(calculateRyuHadokenOkiGuardAdvantage({ characterId: 'ryu', move, blockFrameFromInput: 16 })).toMatchObject({
      guardAdvantage: -5,
      contactDelayAfterStartup: 0,
    });
    expect(calculateRyuHadokenOkiGuardAdvantage({ characterId: 'ryu', move, blockFrameFromInput: 24 })).toMatchObject({
      guardAdvantage: 3,
      contactDelayAfterStartup: 8,
    });
    expect(calculateRyuHadokenOkiGuardAdvantage({ characterId: 'ryu', move, blockFrameFromInput: 25 })).toMatchObject({
      guardAdvantage: 4,
      contactDelayAfterStartup: 9,
    });
  });

  it('derives OD Hadoken guard advantage from local point blank data', () => {
    const move = buildMove({ input: '236PP', startup: '12', recovery: '28', onBlock: '-1' });

    expect(getRyuHadokenOkiData('ryu', move)).toMatchObject({
      totalFrames: 40,
      blockstun: 27,
    });
    expect(calculateRyuHadokenOkiGuardAdvantage({ characterId: 'ryu', move, blockFrameFromInput: 12 })).toMatchObject({
      guardAdvantage: -1,
      contactDelayAfterStartup: 0,
    });
    expect(calculateRyuHadokenOkiGuardAdvantage({ characterId: 'ryu', move, blockFrameFromInput: 22 })).toMatchObject({
      guardAdvantage: 9,
      contactDelayAfterStartup: 10,
    });
  });

  it('only auto-routes lab-backed corner LP Hadoken contact frames', () => {
    const lp = buildMove({ input: '236LP', startup: '16', recovery: '31', onBlock: '-5' });
    const mp = buildMove({ input: '236MP', startup: '14', recovery: '33', onBlock: '-7' });

    expect(getRyuHadokenCornerOkiContactWindow('ryu', lp)).toEqual({
      minBlockFrameFromInput: 21,
      maxBlockFrameFromInput: 25,
    });
    expect(getRyuHadokenCornerOkiContactWindow('ryu', mp)).toBeNull();

    expect(calculateRyuHadokenCornerOkiGuardAdvantage({ characterId: 'ryu', move: lp, blockFrameFromInput: 20 })).toBeNull();
    expect(calculateRyuHadokenCornerOkiGuardAdvantage({ characterId: 'ryu', move: lp, blockFrameFromInput: 21 })).toMatchObject({
      guardAdvantage: 0,
    });
    expect(calculateRyuHadokenCornerOkiGuardAdvantage({ characterId: 'ryu', move: lp, blockFrameFromInput: 25 })).toMatchObject({
      guardAdvantage: 4,
    });
    expect(calculateRyuHadokenCornerOkiGuardAdvantage({ characterId: 'ryu', move: lp, blockFrameFromInput: 26 })).toBeNull();
  });
});
