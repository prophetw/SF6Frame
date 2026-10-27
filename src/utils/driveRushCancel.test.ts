import { describe, expect, it } from 'vitest';
import type { Move } from '../types';
import ryu from '../data/characters/ryu.json';
import { calculateDriveRushCancelPressure, getDriveRushCancelFrame } from './driveRushCancel';

function ryuMove(input: string): Move {
  const move = ryu.moves.find(move => move.input === input);
  if (!move) throw new Error(`Missing Ryu move: ${input}`);
  return move as Move;
}

const crMK = ryuMove('2MK');
const stLP = ryuMove('5LP');
const stHP = ryuMove('5HP');
const driveRush = ryuMove('MPMK or 66');

describe('Drive Rush Cancel pressure', () => {
  it('keeps Ryu 2MK → DRC → 5LP a true blockstring and ends at +3 on block', () => {
    const result = calculateDriveRushCancelPressure({ move1: crMK, move2: stLP, driveRush });
    expect(result.valid).toBe(true);
    expect(result.cancelFrame).toBe(3);
    expect(result.driveRushStartup).toBe(9);
    expect(result.blockstun).toBe(16);
    expect(result.gap).toBe(-1);
    expect(result.status).toContain('连防');
    expect(result.onBlockAdvantage).toBe(3);
  });

  it('shows the interruptible gap before Ryu 5HP, while ending at +2 if blocked', () => {
    const result = calculateDriveRushCancelPressure({ move1: crMK, move2: stHP, driveRush });
    expect(result.valid).toBe(true);
    expect(result.gap).toBe(5);
    expect(result.status).toBe('可被 4F 抢动打断');
    expect(result.onBlockAdvantage).toBe(2);
  });

  it('adds +4 to each blocked attack for burnout, without double-counting DRC', () => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stHP, driveRush, isOpponentBurnout: true,
    });
    expect(result.blockstun).toBe(20);
    expect(result.gap).toBe(1);
    expect(result.onBlockAdvantage).toBe(6);
  });

  it('increases the gap for delayed pressure without increasing the final block advantage', () => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stLP, driveRush, extraDelay: 2,
    });
    expect(result.gap).toBe(1);
    expect(result.status).toContain('帧陷阱');
    expect(result.onBlockAdvantage).toBe(3);
  });

  it.each([
    { blockstun: 14, gap: -1, status: '连防 (True Blockstring)' },
    { blockstun: 13, gap: 0, status: '帧陷阱 (Frame Trap)' },
    { blockstun: 11, gap: 2, status: '帧陷阱 (Frame Trap)' },
    { blockstun: 10, gap: 3, status: '4F 抢动可相杀' },
    { blockstun: 9, gap: 4, status: '可被 4F 抢动打断' },
  ])('classifies the reversal and 4F interruption boundaries at gap $gap', ({ blockstun, gap, status }) => {
    const result = calculateDriveRushCancelPressure({
      move1: { ...stLP, raw: { blockstun } }, move2: stLP, driveRush,
    });
    expect(result.gap).toBe(gap);
    expect(result.status).toBe(status);
  });

  it('uses explicit blockstun when provided, including numeric source strings', () => {
    const result = calculateDriveRushCancelPressure({
      move1: { ...crMK, raw: { blockstun: '18' } }, move2: stHP, driveRush,
    });
    expect(result.blockstun).toBe(18);
    expect(result.gap).toBe(3);
  });

  it('derives blockstun when raw data is absent', () => {
    const result = calculateDriveRushCancelPressure({ move1: { ...crMK, raw: undefined }, move2: stHP, driveRush });
    expect(result.blockstun).toBe(16);
    expect(result.gap).toBe(5);
  });

  it('does not mutate character data', () => {
    const before = JSON.stringify([crMK, stLP, driveRush]);
    calculateDriveRushCancelPressure({ move1: crMK, move2: stLP, driveRush, isOpponentBurnout: true });
    expect(JSON.stringify([crMK, stLP, driveRush])).toBe(before);
  });

  it('rejects a source that cannot drive rush cancel', () => {
    const result = calculateDriveRushCancelPressure({ move1: ryuMove('5HK'), move2: stLP, driveRush });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('支持绿冲取消');
  });

  it('does not substitute Parry Drive Rush for the 3-bar cancel', () => {
    const result = calculateDriveRushCancelPressure({ move1: crMK, move2: stLP, driveRush: ryuMove('MPMK~66') });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('裸绿冲');
  });

  it.each(['5MP~LK', '5HP~HK'])('does not treat target-combo follow-up %s as a standalone normal', input => {
    const targetCombo = ryuMove(input);
    expect(calculateDriveRushCancelPressure({ move1: crMK, move2: targetCombo, driveRush }).valid).toBe(false);
    expect(calculateDriveRushCancelPressure({ move1: targetCombo, move2: stLP, driveRush }).valid).toBe(false);
  });

  it.each([
    { ...stLP, startup: '-' },
    { ...stLP, startup: '4(8)' },
    { ...stLP, onBlock: '-' },
    { ...stLP, input: 'j.LP' },
    { ...stLP, category: 'throw' as const },
    { ...stLP, category: 'special' as const },
  ])('rejects unsupported follow-up data: $input / $startup / $onBlock / $category', move2 => {
    expect(calculateDriveRushCancelPressure({ move1: crMK, move2, driveRush }).valid).toBe(false);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid delay: %s', extraDelay => {
    const result = calculateDriveRushCancelPressure({ move1: crMK, move2: stLP, driveRush, extraDelay });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('额外延迟');
  });

  it('rejects missing and multi-hit source stun data rather than displaying a fabricated gap', () => {
    expect(calculateDriveRushCancelPressure({
      move1: { ...crMK, recovery: '-', raw: undefined }, move2: stLP, driveRush,
    }).valid).toBe(false);
    expect(calculateDriveRushCancelPressure({
      move1: { ...crMK, active: '2(3)2' }, move2: stLP, driveRush,
    }).valid).toBe(false);
  });
});

describe('earliest Drive Rush Cancel timing from source notes', () => {
  it('uses the first contact frame unless the move has a delay rule', () => {
    expect(getDriveRushCancelFrame(stLP)).toBe(1);
  });

  it('waits until the final active frame for Ryu 2MK', () => {
    expect(getDriveRushCancelFrame(crMK)).toBe(3);
  });

  it('honors a specified active frame', () => {
    expect(getDriveRushCancelFrame(ryuMove('5LK'))).toBe(2);
    expect(getDriveRushCancelFrame({ ...crMK, notes: 'DR cancel is delayed until after the 3rd active frame' })).toBe(3);
  });

  it('includes active frames before a recovery-frame cancel', () => {
    expect(getDriveRushCancelFrame({ ...crMK, notes: 'DR cancel is delayed until after 1st recovery frame' })).toBe(4);
  });

  it.each([
    'DR cancel is delayed until after 2nd~3rd recovery frame',
    'DR cancel is delayed until after 3rd recovery frame on 2nd hit',
    'DR cancel is delayed until a special condition',
  ])('rejects an ambiguous cancel condition: %s', notes => {
    expect(getDriveRushCancelFrame({ ...crMK, notes })).toBeNull();
  });
});
