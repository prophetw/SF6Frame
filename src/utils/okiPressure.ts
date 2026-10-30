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
