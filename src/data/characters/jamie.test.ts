import { describe, expect, it } from 'vitest';
import jamie from './jamie.json';

const movesByInput = new Map(jamie.moves.map(move => [move.input, move]));

describe('Jamie Freeflow follow-up frame data', () => {
  it.each([
    ['236LP~6P~6P', 'KD +31'],
    ['236MP~6P~6P', 'KD +31'],
    ['236HP~6P~6P', 'KD +31'],
  ])('keeps %s at %s on hit', (input, expectedOnHit) => {
    const move = movesByInput.get(input);

    expect(move).toBeDefined();
    expect(move?.onHit).toBe(expectedOnHit);
    expect(move?.knockdown?.advantage).toBe(31);
  });

  it.each([
    '6MK~MK~P',
    '236LP~6K~6K',
    '236MP~6K~6K',
    '236HP~6K~6K',
  ])('keeps %s at -1F for the default knockdown', input => {
    const move = movesByInput.get(input);

    expect(move).toBeDefined();
    expect(move?.onHit).toMatch(/KD -1/);
    expect(move?.knockdown?.advantage).toBe(-1);
  });
});
