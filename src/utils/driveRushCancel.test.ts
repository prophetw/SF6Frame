import { describe, expect, it } from 'vitest';
import type { Move } from '../types';
import ryu from '../data/characters/ryu.json';
import { calculateDriveRushCancelPressure, getDriveRushCancelFrame, sortDriveRushComparisons, type DriveRushComparisonRow } from './driveRushCancel';
import type { CalculationType } from './gapCalculator';

function ryuMove(input: string): Move {
  const move = ryu.moves.find(move => move.input === input);
  if (!move) throw new Error(`Missing Ryu move: ${input}`);
  return move as Move;
}

const crMK = ryuMove('2MK');
const stLP = ryuMove('5LP');
const stHP = ryuMove('5HP');
const driveRush = ryuMove('MPMK or 66');

function comparisonRows(inputs: string[], type: CalculationType): DriveRushComparisonRow[] {
  return inputs.map((input, index) => {
    const move = ryuMove(input);
    return { move, index, result: calculateDriveRushCancelPressure({ move1: crMK, move2: move, driveRush, type, hitState: 'pc' }) };
  });
}

describe('Drive Rush Cancel comparison sorting', () => {
  it('puts successful hit routes first, larger windows next, near misses after them, and unknowns last', () => {
    const rows = comparisonRows(['6HP', '5HP', '4HK', '5HK', '5LP', '2HK', '6HK', '5MP', '2LP'], 'hit');
    const sorted = sortDriveRushComparisons(rows, 'hit');
    expect(sorted.map(row => row.move.input)).toEqual(['5LP', '2LP', '5MP', '5HP', '5HK', '6HK', '6HP', '4HK', '2HK']);
  });

  it('can prioritize hit advantage while keeping failures behind successful routes', () => {
    const rows = comparisonRows(['6HP', '5HP', '4HK', '5HK', '5LP', '6HK', '5MP'], 'hit');
    expect(sortDriveRushComparisons(rows, 'hit', 'advantage').map(row => row.move.input))
      .toEqual(['5HK', '5MP', '5LP', '5HP', '6HP', '6HK', '4HK']);
  });

  it('orders block pressure by safety and then smaller gaps', () => {
    const rows = comparisonRows(['5HP', '5HK', '5LP', '5LK', '2MK', '5MP', '4HK'], 'block');
    expect(sortDriveRushComparisons(rows, 'block').map(row => row.move.input))
      .toEqual(['5LP', '5LK', '5MP', '2MK', '5HP', '5HK', '4HK']);
  });

  it('keeps safer block categories ahead when prioritizing advantage', () => {
    const rows = comparisonRows(['5HP', '5HK', '5LP', '5LK', '2MK', '5MP', '4HK'], 'block');
    expect(sortDriveRushComparisons(rows, 'block', 'advantage').map(row => row.move.input))
      .toEqual(['5LP', '5MP', '5LK', '2MK', '5HK', '5HP', '4HK']);
  });

  it('supports faster-startup ordering without promoting unknown results', () => {
    const rows = comparisonRows(['4HK', '5HP', '6HP', '5MP', '5LP'], 'hit');
    expect(sortDriveRushComparisons(rows, 'hit', 'startup').map(row => row.move.input))
      .toEqual(['5LP', '5MP', '5HP', '6HP', '4HK']);
  });

  it('breaks equal-window ties by advantage and preserves original order for equal results', () => {
    const rows = comparisonRows(['5LK', '2LK', '2LP', '5LP'], 'hit');
    expect(sortDriveRushComparisons(rows, 'hit').map(row => row.move.input)).toEqual(['2LP', '5LP', '2LK', '5LK']);
  });

  it('sorts a copy and keeps missing results at the bottom', () => {
    const rows = comparisonRows(['5HP', '5LP'], 'hit');
    rows.unshift({ move: stLP, index: 99, result: null });
    const before = JSON.stringify(rows);
    const sorted = sortDriveRushComparisons(rows, 'hit');
    expect(sorted.map(row => row.index)).toEqual([1, 0, 99]);
    expect(JSON.stringify(rows)).toBe(before);
    expect(sorted).not.toBe(rows);
  });
});

describe('Drive Rush Cancel pressure', () => {
  it('keeps Ryu 2MK → DRC → 5LP a true blockstring and ends at +3 on block', () => {
    const result = calculateDriveRushCancelPressure({ move1: crMK, move2: stLP, driveRush });
    expect(result.valid).toBe(true);
    expect(result.cancelFrame).toBe(3);
    expect(result.driveRushStartup).toBe(9);
    expect(result.blockstun).toBe(16);
    expect(result.gap).toBe(-1);
    expect(result.status).toContain('连防');
    expect(result.followUpAdvantage).toBe(3);
  });

  it('shows the interruptible gap before Ryu 5HP, while ending at +2 if blocked', () => {
    const result = calculateDriveRushCancelPressure({ move1: crMK, move2: stHP, driveRush });
    expect(result.valid).toBe(true);
    expect(result.gap).toBe(5);
    expect(result.status).toBe('可被 4F 抢动打断');
    expect(result.followUpAdvantage).toBe(2);
  });

  it('adds +4 to each blocked attack for burnout, without double-counting DRC', () => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stHP, driveRush, isOpponentBurnout: true,
    });
    expect(result.blockstun).toBe(20);
    expect(result.gap).toBe(1);
    expect(result.followUpAdvantage).toBe(6);
  });

  it('increases the gap for delayed pressure without increasing the final block advantage', () => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stLP, driveRush, extraDelay: 2,
    });
    expect(result.gap).toBe(1);
    expect(result.status).toContain('帧陷阱');
    expect(result.followUpAdvantage).toBe(3);
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

describe('Drive Rush Cancel hit mode', () => {
  it.each([
    { input: '5LP', hitState: 'normal', window: 7, hitstun: 23 },
    { input: '5LP', hitState: 'ch', window: 9, hitstun: 25 },
    { input: '5LP', hitState: 'pc', window: 11, hitstun: 27 },
    { input: '5HP', hitState: 'normal', window: 1, hitstun: 23 },
    { input: '5HP', hitState: 'ch', window: 3, hitstun: 25 },
    { input: '5HP', hitState: 'pc', window: 5, hitstun: 27 },
  ] as const)('calculates Ryu 2MK ($hitState) → DRC → $input', ({ input, hitState, window, hitstun }) => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: ryuMove(input), driveRush, type: 'hit', hitState,
    });
    expect(result.valid).toBe(true);
    expect(result.hitstun).toBe(hitstun);
    expect(result.blockstun).toBeUndefined();
    expect(result.gap).toBe(window);
    expect(result.displayValue).toBe(`+${window}F`);
    expect(result.status).toContain('连招成立');
    // Counter bonuses belong to the starter; the follow-up gets only its own DR bonus.
    expect(result.followUpAdvantage).toBe(8);
    expect(result.followUpAdvantageFormula).toBe('4 + 4（绿冲）');
  });

  it('keeps the exact zero-surplus boundary as a successful combo', () => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stHP, driveRush, type: 'hit', extraDelay: 1,
    });
    expect(result.gap).toBe(0);
    expect(result.displayValue).toBe('+0F');
    expect(result.status).toContain('连招成立');
  });

  it('shows the deficit when delay breaks the combo', () => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stHP, driveRush, type: 'hit', extraDelay: 2,
    });
    expect(result.gap).toBe(-1);
    expect(result.displayValue).toBe('1F');
    expect(result.displayLabel).toContain('缺失');
    expect(result.status).toContain('连招失败');
  });

  it('does not apply burnout to hitstun or hit advantage, even with punish counter', () => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stHP, driveRush, type: 'hit', hitState: 'pc', isOpponentBurnout: true,
    });
    expect(result.hitstun).toBe(27);
    expect(result.gap).toBe(5);
    expect(result.followUpAdvantage).toBe(8);
    expect(result.formulaDesc).not.toContain('打白');
  });

  it.each(['ch', 'pc'] as const)('does not apply %s to block calculations', hitState => {
    const result = calculateDriveRushCancelPressure({
      move1: crMK, move2: stHP, driveRush, type: 'block', hitState, isOpponentBurnout: true,
    });
    expect(result.blockstun).toBe(20);
    expect(result.gap).toBe(1);
    expect(result.followUpAdvantage).toBe(6);
    expect(result.hitstun).toBeUndefined();
  });

  it('uses hit data without requiring block data', () => {
    const result = calculateDriveRushCancelPressure({
      move1: { ...crMK, onBlock: '-', raw: { hitstun: '23' } },
      move2: { ...stHP, onBlock: '-' }, driveRush, type: 'hit', hitState: 'ch',
    });
    expect(result.valid).toBe(true);
    expect(result.hitstun).toBe(25);
    expect(result.gap).toBe(3);
    expect(result.followUpAdvantage).toBe(8);
  });

  it('derives hitstun when raw data is absent', () => {
    const result = calculateDriveRushCancelPressure({
      move1: { ...crMK, raw: undefined }, move2: stHP, driveRush, type: 'hit',
    });
    expect(result.valid).toBe(true);
    expect(result.hitstun).toBe(23);
    expect(result.gap).toBe(1);
  });

  it('rejects missing or knockdown-only hit advantage instead of treating it as zero', () => {
    const missingSource = calculateDriveRushCancelPressure({
      move1: { ...crMK, onHit: '-', raw: undefined }, move2: stHP, driveRush, type: 'hit',
    });
    expect(missingSource.valid).toBe(false);
    expect(missingSource.error).toContain('命中硬直');
    for (const onHit of ['-', 'KD +36']) {
      const result = calculateDriveRushCancelPressure({ move1: crMK, move2: { ...stHP, onHit }, driveRush, type: 'hit' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('命中帧数');
    }
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
