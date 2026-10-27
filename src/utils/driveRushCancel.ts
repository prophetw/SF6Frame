import type { Move } from '../types';
import { DRIVE_RUSH_FRAME_ADVANTAGE_BONUS, isDriveRushFollowUpMove } from './driveRush';
import { parseActiveWindowFrames } from './frameTotals';
import { calculateGap, calculateMoveStats, isCancelValid, isDriveRushCancelMove, type CalculationResult } from './gapCalculator';

export interface DriveRushCancelInput {
  move1: Move;
  move2: Move;
  driveRush: Move;
  extraDelay?: number;
  isOpponentBurnout?: boolean;
}

export interface DriveRushCancelResult extends CalculationResult {
  cancelFrame?: number;
  driveRushStartup?: number;
  onBlockAdvantage?: number;
  onBlockFormula?: string;
}

function numericFrame(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function isDriveRushCancelNormal(move: Move): boolean {
  // Target-combo/stance follow-ups need a preceding action and are not standalone DRC normals.
  return !/[~>]/.test(move.input)
    && (move.category === 'normal' || move.category === 'unique')
    && isDriveRushFollowUpMove(move);
}

/** Earliest cancel position in the gap calculator's contact-frame convention (first active = 1). */
export function getDriveRushCancelFrame(move: Move): number | null {
  const note = move.notes?.match(/DR cancel is delayed[^;.\n]*/i)?.[0];
  if (!note) return 1;

  // A multi-hit cancel requires knowing which hit was blocked; this mode uses a single contact.
  if (/\d+(?:st|nd|rd|th) hit/i.test(note)) return null;

  const active = parseActiveWindowFrames(move.active);
  if (active === null || active < 1) return null;
  if (/after active frames/i.test(note)) return active;

  const position = note.match(/after (?:the )?(\d+)(?:st|nd|rd|th) (active|recovery) frame/i);
  if (!position) return null;
  const frame = Number(position[1]);
  return position[2]?.toLowerCase() === 'recovery' ? active + frame : frame;
}

function invalidResult(error: string): DriveRushCancelResult {
  return {
    valid: false,
    gap: 0,
    displayLabel: '',
    displayValue: '',
    status: '',
    statusClass: '',
    description: '',
    formulaDesc: '',
    adv1: 0,
    startup2: 0,
    error,
  };
}

export function calculateDriveRushCancelPressure(input: DriveRushCancelInput): DriveRushCancelResult {
  const { move1, move2, driveRush, extraDelay = 0, isOpponentBurnout = false } = input;
  if (!isDriveRushCancelMove(driveRush)) return invalidResult('缺少绿冲取消数据，不能使用裸绿冲代替。');
  if (!isDriveRushCancelNormal(move1) || !isCancelValid(move1, driveRush)) {
    return invalidResult('首招必须是支持绿冲取消的地面普通技或指令普通技。');
  }
  if (!isDriveRushCancelNormal(move2)) {
    return invalidResult('后续招式必须是可获得绿冲加成的地面普通技或指令普通技。');
  }
  if (!Number.isSafeInteger(extraDelay) || extraDelay < 0) {
    return invalidResult('额外延迟必须是大于等于 0 的整数帧。');
  }

  const driveRushStartup = numericFrame(driveRush.startup);
  const startup = numericFrame(move2.startup);
  const onBlock = numericFrame(move2.onBlock);
  const cancelFrame = getDriveRushCancelFrame(move1);
  if (driveRushStartup === null || driveRushStartup < 1 || startup === null || startup < 1 || onBlock === null) {
    return invalidResult('缺少有效的发生帧或被防帧数；条件帧数暂不支持计算。');
  }
  if (cancelFrame === null) return invalidResult('首招的绿冲取消时机需要指定命中段或条件，暂不支持计算。');
  const active = numericFrame(move1.active);
  if (active === null || active < 1) return invalidResult('首招缺少有效的单段持续帧，暂不支持计算。');

  const rawBlockstun = numericFrame(move1.raw?.blockstun);
  if (rawBlockstun === null && [move1.active, move1.recovery, move1.onBlock].some(value => numericFrame(value) === null)) {
    return invalidResult('缺少首招的有效防御硬直，暂不支持计算。');
  }
  const blockstun = rawBlockstun ?? calculateMoveStats(move1).blockstun;
  if (!Number.isFinite(blockstun) || blockstun <= 0) return invalidResult('首招的防御硬直数据无效。');

  // DRC replaces recovery with its own startup; +4 applies to move2 after it is blocked.
  const result = calculateGap({
    // This transition goes through DRC, even if the two normals also support a rapid chain.
    move1: { ...move1, cancels: [], raw: { ...move1.raw, blockstun } },
    move2,
    type: 'block',
    mode: 'cancel',
    hitState: 'normal',
    cancelFrame: cancelFrame + driveRushStartup + extraDelay,
    isOpponentBurnout,
  });
  const burnoutBonus = isOpponentBurnout ? 4 : 0;
  const onBlockAdvantage = onBlock + DRIVE_RUSH_FRAME_ADVANTAGE_BONUS + burnoutBonus;

  // Gap counts the empty frame-meter blocks: 0 still allows a reversal on the contact frame.
  if (result.gap < 0) {
    result.status = '连防 (True Blockstring)';
    result.statusClass = 'status-safe';
    result.description = '后续招式在首招防御硬直结束前到达，对方无法在中间抢动或使用无敌技。';
  } else if (result.gap < 3) {
    result.status = '帧陷阱 (Frame Trap)';
    result.statusClass = 'status-trap';
    result.description = '对方的 4F 普通技来不及生效，但可以在首个可动帧启动无敌技。';
  } else if (result.gap === 3) {
    result.status = '4F 抢动可相杀';
    result.statusClass = 'status-warning';
    result.description = '对方的 4F 普通技可在同一帧生效，是否相杀还取决于距离与判定；无敌技可以插入。';
  } else {
    result.status = '可被 4F 抢动打断';
    result.statusClass = 'status-danger';
    result.description = '对方的 4F 普通技可先于后续招式生效，是否命中还取决于距离与判定。';
  }

  return {
    ...result,
    cancelFrame,
    driveRushStartup,
    onBlockAdvantage,
    onBlockFormula: `${onBlock} + ${DRIVE_RUSH_FRAME_ADVANTAGE_BONUS}（绿冲）${burnoutBonus ? ' + 4（对方燃尽）' : ''}`,
    formulaDesc: `${cancelFrame}（首招取消）+ ${driveRushStartup}（绿冲取消）+ ${extraDelay}（延迟）+ ${startup}（后续发生）- 1 - ${result.blockstun}（防御硬直）`,
    formulaNote: '按首个判定帧接触、双方均成功防御计算。Gap < 0 为连防；Gap = 0 无黑格，但对方可在接触帧启动无敌技。距离、打点与延迟可能改变实际结果。',
  };
}
