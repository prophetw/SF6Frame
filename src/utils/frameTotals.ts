import type { Move } from '../types';

function normalizeFrameText(value: string): string {
  return value
    .replace(/[−–—]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[×✕✖]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasNoFrameData(value: string): boolean {
  const lowered = value.toLowerCase();
  return lowered === '-' || lowered === '--' || lowered === 'n/a';
}

function extractAllNumbers(value: string): number[] {
  const matches = value.match(/\d+/g);
  if (!matches) return [];
  return matches.map(n => parseInt(n, 10));
}

function parseExplicitTotal(value: string): number | null {
  const totalMatch = value.match(/(\d+)\s*total/i);
  if (!totalMatch || !totalMatch[1]) return null;
  return parseInt(totalMatch[1], 10);
}

function normalizeRanges(value: string): string {
  return value
    .replace(/(\d+)\s*~\s*(\d+)/g, '$1')
    .replace(/(\d+)\s*~\s*/g, '$1');
}

function evaluateFrameExpression(value: string): number | null {
  if (!value || hasNoFrameData(value)) return null;

  const explicitTotal = parseExplicitTotal(value);
  if (explicitTotal !== null) return explicitTotal;

  let normalized = normalizeRanges(value);

  // Resolve terms like "2x3" / "2*3" first, then sum remaining numbers.
  const multPattern = /(\d+)\s*[x*]\s*(\d+)/i;
  while (multPattern.test(normalized)) {
    normalized = normalized.replace(multPattern, (_, a: string, b: string) => {
      return String(parseInt(a, 10) * parseInt(b, 10));
    });
  }

  const numbers = extractAllNumbers(normalized);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, n) => sum + n, 0);
}

export function parseStartupFirstActiveFrame(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = normalizeFrameText(value);
  if (!normalized || hasNoFrameData(normalized)) return null;

  const numbers = extractAllNumbers(normalized);
  return numbers.length > 0 ? numbers[0] ?? null : null;
}

export function parseActiveWindowFrames(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = normalizeFrameText(value);
  return evaluateFrameExpression(normalized);
}

export function parseRecoveryTotalFrames(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = normalizeFrameText(value);
  if (!normalized || hasNoFrameData(normalized)) return null;

  // Use the last "(N)" variant as whiff/landing recovery when present.
  const parenthesized = Array.from(normalized.matchAll(/\((\d+)\)/g))
    .map(match => parseInt(match[1] ?? '', 10))
    .filter(n => !isNaN(n));
  if (parenthesized.length > 0) {
    return parenthesized[parenthesized.length - 1] ?? null;
  }

  return evaluateFrameExpression(normalized);
}

function parseStartupTotalOverride(value: string | number | undefined): number | null {
  if (value === undefined || value === null || typeof value === 'number') return null;

  const normalized = normalizeFrameText(value);
  if (!normalized || hasNoFrameData(normalized)) return null;

  const explicitTotal = parseExplicitTotal(normalized);
  if (explicitTotal !== null) return explicitTotal;

  // Fallback: values like "586~775 (total)" where "total" has no nearby number.
  if (/\btotal\b/i.test(normalized)) {
    const numbers = extractAllNumbers(normalized);
    if (numbers.length > 0) {
      return numbers[numbers.length - 1] ?? null;
    }
  }

  return null;
}

function parseRawTotal(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const normalized = normalizeFrameText(value);
  if (!normalized || hasNoFrameData(normalized)) return null;

  const explicitTotal = parseExplicitTotal(normalized);
  if (explicitTotal !== null) return explicitTotal;

  const parenthesized = Array.from(normalized.matchAll(/\((\d+)\)/g))
    .map(match => parseInt(match[1] ?? '', 10))
    .filter(n => !isNaN(n));
  if (parenthesized.length > 0) {
    return parenthesized[parenthesized.length - 1] ?? null;
  }

  const numbers = extractAllNumbers(normalized);
  return numbers.length > 0 ? numbers[0] ?? null : null;
}

export function calculateMoveTotalFrames(move: Pick<Move, 'startup' | 'active' | 'recovery' | 'raw'>): number | null {
  const startup = parseStartupFirstActiveFrame(move.startup);
  const activeWindow = parseActiveWindowFrames(move.active);
  const recovery = parseRecoveryTotalFrames(move.recovery);

  if (startup !== null && activeWindow !== null && recovery !== null) {
    return Math.max(0, startup - 1) + activeWindow + recovery;
  }

  const startupOverrideTotal = parseStartupTotalOverride(move.startup);
  if (startupOverrideTotal !== null) return startupOverrideTotal;

  return parseRawTotal(move.raw?.total);
}
