import type { Move } from '../types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

function hasJumpPrefix(value: string): boolean {
  return value.startsWith('j') || value.includes('j.');
}

function hasJumpDirectionInput(value: string): boolean {
  return /(^|[.~( ])(?:7|8|9)(?=[a-z])/.test(value);
}

function hasAirQualifier(value: string): boolean {
  return (
    value.includes('(air') ||
    value.includes('air current') ||
    value.includes('air ok')
  );
}

export function isAirborneMove(move: Move): boolean {
  const input = normalizeText(move.input);
  const name = normalizeText(move.name);
  const nameZh = normalizeText(move.nameZh);
  const active = normalizeText(move.active);
  const recovery = normalizeText(move.recovery);
  const rawMoveName = normalizeText(move.raw?.moveName);
  const rawSourceName = normalizeText(move.raw?.sourceName);
  const rawInput = normalizeText(move.raw?.plnCmd);
  const rawSourceInput = normalizeText(move.raw?.sourceInput);
  const rawCancelText = normalizeText(move.raw?.cancelText);
  const cancelText = Array.isArray(move.cancels)
    ? move.cancels.map(normalizeText).join(' ')
    : '';

  if ([input, rawInput, rawSourceInput].some(hasJumpPrefix)) return true;
  if ([input, rawInput, rawSourceInput].some(hasJumpDirectionInput)) return true;
  if ([name, rawMoveName, rawSourceName].some(value => value.includes('jump'))) return true;
  if (nameZh.includes('跳')) return true;

  if ([input, name, rawMoveName, rawSourceName, rawInput, rawSourceInput, rawCancelText, cancelText].some(hasAirQualifier)) {
    return true;
  }

  if (active.includes(' air')) return true;
  if (recovery.includes('land')) return true;

  return false;
}
