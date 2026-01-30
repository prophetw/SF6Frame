import { describe, it, expect } from 'vitest';
import { buildOkiResultKeyBase, getUniqueOkiResultKey } from './okiResultKey';

describe('okiResultKey', () => {
  it('should include inputs and frames in base key', () => {
    const baseA = buildOkiResultKeyBase({
      prefixName: '前冲 + 5MP',
      prefixFrames: 18,
      prefixInput: '5MP',
      moveName: 'Hadoken',
      moveInput: '236LP',
      ourActiveStart: 22,
      ourActiveEnd: 24
    });

    const baseB = buildOkiResultKeyBase({
      prefixName: '前冲 + 5MP',
      prefixFrames: 18,
      prefixInput: '5MP',
      moveName: 'Hadoken',
      moveInput: '236HP',
      ourActiveStart: 22,
      ourActiveEnd: 24
    });

    expect(baseA).not.toBe(baseB);
  });

  it('should disambiguate duplicate base keys', () => {
    const counts = new Map<string, number>();
    const base = buildOkiResultKeyBase({
      prefixName: '',
      prefixFrames: 0,
      moveName: 'Test Move',
      moveInput: '5MP',
      ourActiveStart: 5,
      ourActiveEnd: 7
    });

    expect(getUniqueOkiResultKey(base, counts)).toBe(base);
    expect(getUniqueOkiResultKey(base, counts)).toBe(`${base}|dup2`);
    expect(getUniqueOkiResultKey(base, counts)).toBe(`${base}|dup3`);
  });
});

