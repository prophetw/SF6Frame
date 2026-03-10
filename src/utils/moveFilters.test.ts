import { describe, expect, it } from 'vitest';
import type { Move } from '../types';
import { isAirborneMove } from './moveFilters';

const buildMove = (overrides: Partial<Move>): Move => ({
  name: 'Test Move',
  input: '5MP',
  damage: '800',
  startup: '5',
  active: '3',
  recovery: '15',
  onBlock: '-2',
  onHit: '+4',
  category: 'normal',
  ...overrides,
});

describe('moveFilters', () => {
  it('detects jump normals written with j. notation', () => {
    expect(isAirborneMove(buildMove({
      name: 'Yume Zakura',
      input: 'j.LPLK',
      recovery: '3 land',
      raw: {
        plnCmd: 'j.LPLK',
        sourceInput: 'j.LPLK',
      },
    }))).toBe(true);
  });

  it('detects jump follow-ups written with 8 notation', () => {
    expect(isAirborneMove(buildMove({
      name: 'Wheel Kick',
      input: '8HK',
    }))).toBe(true);
  });

  it('detects air-only specials without matching grounded moves', () => {
    expect(isAirborneMove(buildMove({
      name: 'Spinning Mixer',
      input: '236LP (Air Current)',
      recovery: '39+14 land',
      raw: {
        sourceInput: '236LP (Air Current)',
      },
    }))).toBe(true);
  });

  it('does not exclude grounded moves that happen to contain air in the name', () => {
    expect(isAirborneMove(buildMove({
      name: 'Air Slasher',
      input: '236LP',
      recovery: '29',
    }))).toBe(false);
  });
});
