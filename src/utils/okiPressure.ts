import type { Move } from '../types';

export interface OkiKnockdownPreset extends Pick<Move, 'name' | 'nameZh' | 'input' | 'notes'> {
  advantages: [number, ...number[]];
}

function parseCounterKnockdown(value: string): OkiKnockdownPreset['advantages'] | undefined {
  const match = value.match(/^(?:HKD|KD)\s*\+(\d+)(?:\s*(?:[~～]\s*\+?(\d+)|\(\+(\d+)\)))?$/i);
  if (!match) return undefined;

  const first = Number(match[1]);
  if (!Number.isSafeInteger(first) || first <= 0) return undefined;

  if (match[2]) {
    const last = Number(match[2]);
    if (!Number.isSafeInteger(last) || last < first) return undefined;
    return [first, ...Array.from({ length: last - first }, (_, index) => first + index + 1)];
  }

  // A parenthesized value is a separate outcome. Frames between the two are unspecified.
  const variant = Number(match[3]);
  if (Number.isSafeInteger(variant) && variant > 0 && variant !== first) return [first, variant];
  return [first];
}

export function getOkiKnockdownPresets(move: Move): OkiKnockdownPreset[] {
  const { name, nameZh, input, knockdown, onHit, onCounterHit, onPunishCounter } = move;
  const presets: OkiKnockdownPreset[] = [];

  function add(advantages: OkiKnockdownPreset['advantages'], condition?: string, notes?: string) {
    const suffix = condition ? ` (${condition})` : '';
    presets.push({ name: name + suffix, nameZh: nameZh ? nameZh + suffix : undefined, input, advantages, notes });
  }

  if (knockdown && knockdown.type !== 'none') {
    const hitAdvantage = Number(String(onHit ?? '').match(/(?:KD|Crumple)\s*([+-]?\d+)/i)?.[1] ?? 0);
    add([knockdown.advantage || hitAdvantage]);
    for (const alt of knockdown.alternativeAdvantages ?? []) add([alt.advantage || hitAdvantage], alt.condition);
  }

  const counters = onCounterHit === onPunishCounter
    ? [['CH/PC', onCounterHit]] as const
    : [['CH', onCounterHit], ['PC', onPunishCounter]] as const;
  for (const [condition, value] of counters) {
    if (!value) continue;
    const advantages = parseCounterKnockdown(value);
    if (advantages) add(advantages, /^HKD\b/i.test(value) ? `${condition} · HKD` : condition, move.notes);
  }

  return presets;
}

export function formatOkiKnockdownAdvantages([first, ...others]: OkiKnockdownPreset['advantages']): string {
  if (others.length === 0) return `+${first}F`;
  const last = others[others.length - 1];
  return last === first + others.length ? `+${first}～+${last}F` : `+${first}F / +${last}F`;
}

export interface OkiFrameRange {
  start: number;
  end: number;
}

export interface OkiMemoryKnockdown {
  name: string;
  input: string;
  advantage: number;
}

export interface OkiMemoryGroup {
  advantage: number;
  wakeupFrame: number;
  moves: OkiMemoryKnockdown[];
}

function isFrameRange(range: OkiFrameRange): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start >= 1 && range.end >= range.start;
}

/** Wakeup is the first vulnerable frame, one frame after knockdown advantage. */
export function getSafePressureWakeupRange(params: {
  activeStart: number;
  activeEnd: number;
  opponentStartup: number;
  projectileContactRange?: OkiFrameRange;
}): OkiFrameRange | null {
  const { activeStart, activeEnd, opponentStartup, projectileContactRange } = params;
  if (!Number.isInteger(opponentStartup) || opponentStartup <= 1) return null;

  // Projectile routing uses a calibrated contact window instead of fixed active frames.
  // Keep that restriction; do not extrapolate travel time from the current contact frame.
  if (projectileContactRange) {
    return isFrameRange(projectileContactRange) ? { ...projectileContactRange } : null;
  }

  if (!isFrameRange({ start: activeStart, end: activeEnd })) return null;

  // A < W + R - 1 and W <= B. Equality with the opponent's hit is a trade.
  return { start: Math.max(1, activeStart - opponentStartup + 2), end: activeEnd };
}

export function getCompatibleKnockdownGroups(
  knockdowns: OkiMemoryKnockdown[],
  range: OkiFrameRange | null,
): OkiMemoryGroup[] {
  if (!range || !isFrameRange(range)) return [];

  const groups = new Map<number, OkiMemoryGroup>();
  const seen = new Set<string>();
  for (const move of knockdowns) {
    if (!Number.isInteger(move.advantage) || move.advantage <= 0) continue;
    const wakeupFrame = move.advantage + 1;
    if (wakeupFrame < range.start || wakeupFrame > range.end) continue;

    const key = JSON.stringify([move.advantage, move.name, move.input]);
    if (seen.has(key)) continue;
    seen.add(key);

    let group = groups.get(move.advantage);
    if (!group) {
      group = { advantage: move.advantage, wakeupFrame, moves: [] };
      groups.set(move.advantage, group);
    }
    group.moves.push(move);
  }

  return [...groups.values()].sort((a, b) => a.advantage - b.advantage);
}
