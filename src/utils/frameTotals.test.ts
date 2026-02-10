import { describe, expect, it } from 'vitest';
import type { Move } from '../types';
import {
  calculateMoveTotalFrames,
  parseActiveWindowFrames,
  parseRecoveryTotalFrames,
} from './frameTotals';

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

describe('frameTotals', () => {
  it('calculates multi-segment totals using startup-1 + active + recovery', () => {
    const move = buildMove({
      startup: '5',
      active: '5,13',
      recovery: '15+15 land',
      raw: { total: 24 }, // legacy incorrect raw total
    });

    expect(calculateMoveTotalFrames(move)).toBe(52);
  });

  it('uses explicit active total override when provided', () => {
    expect(parseActiveWindowFrames('4x6,7,3(34 total)')).toBe(34);
  });

  it('uses parenthesized whiff recovery when available', () => {
    expect(parseRecoveryTotalFrames('14(16)')).toBe(16);
  });

  it('parses additive landing recovery correctly', () => {
    expect(parseRecoveryTotalFrames('15+15 land')).toBe(30);
  });

  it('falls back to startup total text when active/recovery are unavailable', () => {
    const move = buildMove({
      startup: '586~775 (total)',
      active: '-',
      recovery: '-',
      raw: {},
    });

    expect(calculateMoveTotalFrames(move)).toBe(775);
  });
});
