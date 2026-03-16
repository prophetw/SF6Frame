import { describe, expect, it } from 'vitest';
import type { FrameData, KeyMoveData, Move } from '../types';
import { buildKeyMoveData, generateKeyMoveData } from './keyMoves';

function buildMove(overrides: Partial<Move>): Move {
  return {
    name: 'Test Move',
    input: '5MP',
    damage: '800',
    startup: '6',
    active: '3',
    recovery: '15',
    onBlock: '-2',
    onHit: '+4',
    category: 'normal',
    ...overrides,
  };
}

function buildFrameData(moves: Move[]): FrameData {
  return {
    character: {
      id: 'test',
      name: 'Test',
    },
    stats: {
      health: 10000,
      forwardDash: 18,
      backDash: 22,
    },
    moves,
    lastUpdated: '2026-03-16',
  };
}

describe('keyMoves', () => {
  it('generates stable recommendations from frame data heuristics', () => {
    const frameData = buildFrameData([
      buildMove({
        name: 'Stand LP',
        input: '5LP',
        damage: '300',
        startup: '4',
        onBlock: '-1',
        onHit: '+4',
        cancels: ['Special', 'Super'],
      }),
      buildMove({
        name: 'Forward MP',
        input: '6MP',
        damage: '700',
        startup: '10',
        onBlock: '+2',
        onHit: '+6',
        category: 'unique',
      }),
      buildMove({
        name: 'Stand HP',
        input: '5HP',
        damage: '900',
        startup: '8',
        onBlock: '-2',
        onHit: '+5',
        cancels: ['Special', 'Super'],
      }),
      buildMove({
        name: 'Crouch MK',
        input: '2MK',
        damage: '600',
        startup: '7',
        onBlock: '-3',
        onHit: '+1',
      }),
      buildMove({
        name: 'Heavy Uppercut',
        input: '623HP',
        damage: '1400',
        startup: '6',
        active: '10',
        recovery: '30',
        onBlock: '-25',
        onHit: 'KD',
        category: 'special',
      }),
      buildMove({
        name: 'Crouch HP',
        input: '2HP',
        damage: '1000',
        startup: '10',
        onBlock: '-6',
        onHit: '+2',
      }),
    ]);

    const result = generateKeyMoveData(frameData);

    expect(result.source).toBe('generated');
    expect(result.keyMoves.map(move => move.moveInput)).toEqual(['5LP', '6MP', '5HP', '2MK', '623HP']);
  });

  it('prefers curated manual data when provided', () => {
    const frameData = buildFrameData([
      buildMove({
        name: 'Stand MP',
        input: '5MP',
      }),
    ]);
    const manualData: KeyMoveData = {
      characterId: 'someone-else',
      source: 'manual',
      keyMoves: [
        {
          role: '手工精选',
          moveInput: '5MP',
          reason: 'Manual note',
        },
      ],
      lastUpdated: '2026-03-16',
    };

    const result = buildKeyMoveData(frameData, manualData);

    expect(result.characterId).toBe('test');
    expect(result.source).toBe('manual');
    expect(result.keyMoves[0]?.role).toBe('手工精选');
  });
});
