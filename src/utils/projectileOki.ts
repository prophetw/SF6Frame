import type { Move } from '../types';
import { parseRecoveryTotalFrames, parseStartupFirstActiveFrame } from './frameTotals';

const RYU_HADOKEN_INPUTS = new Set(['236LP', '236MP', '236HP', '236PP']);
const RYU_HADOKEN_CORNER_OKI_CONTACT_WINDOWS: Partial<Record<string, {
  minBlockFrameFromInput: number;
  maxBlockFrameFromInput: number;
}>> = {
  // Labbed corner LP Hadoken setups place the block around input+21F to input+25F.
  // Faster versions need separate travel-window calibration before entering auto routing.
  '236LP': {
    minBlockFrameFromInput: 21,
    maxBlockFrameFromInput: 25,
  },
};

export type RyuHadokenOkiData = {
  startup: number;
  recovery: number;
  totalFrames: number;
  pointBlankOnBlock: number;
  blockstun: number;
};

export type RyuHadokenOkiGuardCalculation = RyuHadokenOkiData & {
  blockFrameFromInput: number;
  guardAdvantage: number;
  contactDelayAfterStartup: number;
  contactWindow?: {
    minBlockFrameFromInput: number;
    maxBlockFrameFromInput: number;
  };
};

function normalizeInput(input: string | undefined): string {
  return (input ?? '').replace(/\s+/g, '').toUpperCase();
}

function parseNumericFrameAdvantage(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const match = value.trim().match(/^[+-]?\d+/);
  return match?.[0] ? parseInt(match[0], 10) : null;
}

export function isRyuHadokenOkiMove(characterId: string | undefined, move: Pick<Move, 'input'>): boolean {
  return characterId === 'ryu' && RYU_HADOKEN_INPUTS.has(normalizeInput(move.input));
}

export function getRyuHadokenOkiData(
  characterId: string | undefined,
  move: Pick<Move, 'input' | 'startup' | 'recovery' | 'onBlock'>,
): RyuHadokenOkiData | null {
  if (!isRyuHadokenOkiMove(characterId, move)) return null;

  const startup = parseStartupFirstActiveFrame(move.startup);
  const recovery = parseRecoveryTotalFrames(move.recovery);
  const pointBlankOnBlock = parseNumericFrameAdvantage(move.onBlock);

  if (startup === null || recovery === null || pointBlankOnBlock === null) return null;

  // Projectile rows do not have a conventional active duration in the local data.
  // Ryu's Hadoken table expresses body total as startup + recovery: LP/MP/HP = 47F, OD = 40F.
  const totalFrames = startup + recovery;
  const blockstun = totalFrames + pointBlankOnBlock - startup;

  return {
    startup,
    recovery,
    totalFrames,
    pointBlankOnBlock,
    blockstun,
  };
}

export function getRyuHadokenCornerOkiContactWindow(
  characterId: string | undefined,
  move: Pick<Move, 'input'>,
): { minBlockFrameFromInput: number; maxBlockFrameFromInput: number } | null {
  if (!isRyuHadokenOkiMove(characterId, move)) return null;
  return RYU_HADOKEN_CORNER_OKI_CONTACT_WINDOWS[normalizeInput(move.input)] ?? null;
}

export function calculateRyuHadokenOkiGuardAdvantage(params: {
  characterId: string | undefined;
  move: Pick<Move, 'input' | 'startup' | 'recovery' | 'onBlock'>;
  blockFrameFromInput: number;
}): RyuHadokenOkiGuardCalculation | null {
  const data = getRyuHadokenOkiData(params.characterId, params.move);
  if (!data) return null;

  const blockFrameFromInput = Math.trunc(params.blockFrameFromInput);
  if (!Number.isFinite(blockFrameFromInput) || blockFrameFromInput <= 0) return null;

  return {
    ...data,
    blockFrameFromInput,
    guardAdvantage: blockFrameFromInput + data.blockstun - data.totalFrames,
    contactDelayAfterStartup: blockFrameFromInput - data.startup,
  };
}

export function calculateRyuHadokenCornerOkiGuardAdvantage(params: {
  characterId: string | undefined;
  move: Pick<Move, 'input' | 'startup' | 'recovery' | 'onBlock'>;
  blockFrameFromInput: number;
}): RyuHadokenOkiGuardCalculation | null {
  const contactWindow = getRyuHadokenCornerOkiContactWindow(params.characterId, params.move);
  if (!contactWindow) return null;

  const calculation = calculateRyuHadokenOkiGuardAdvantage(params);
  if (!calculation) return null;

  if (
    calculation.blockFrameFromInput < contactWindow.minBlockFrameFromInput ||
    calculation.blockFrameFromInput > contactWindow.maxBlockFrameFromInput
  ) {
    return null;
  }

  return {
    ...calculation,
    contactWindow,
  };
}
