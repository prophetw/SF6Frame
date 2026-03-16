import type { FrameData, KeyMove, KeyMoveData, Move } from '../types';
import { parseStartupFirstActiveFrame } from './frameTotals';

function parseSignedFrameValue(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = value.replace(/[−–—]/g, '-').trim();
  const match = normalized.match(/-?\d+/);
  if (!match || !match[0]) return null;

  const parsed = parseInt(match[0], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseDamageValue(value: string | undefined): number {
  if (!value) return 0;
  const numbers = value.match(/\d+/g);
  if (!numbers) return 0;
  return numbers.reduce((sum, part) => sum + parseInt(part, 10), 0);
}

function formatAdvantage(value: string | number | undefined): string {
  const parsed = parseSignedFrameValue(value);
  if (parsed === null) return '-';
  return parsed > 0 ? `+${parsed}` : String(parsed);
}

function hasCancels(move: Move): boolean {
  return Boolean(move.cancels && move.cancels.length > 0);
}

function hasKnockdown(move: Move): boolean {
  return Boolean(move.knockdown && move.knockdown.type !== 'none');
}

function byInputPriority(move: Move, priorities: string[]): number {
  const normalizedInput = move.input.toUpperCase();
  const foundIndex = priorities.findIndex(priority => normalizedInput.startsWith(priority));
  return foundIndex === -1 ? priorities.length : foundIndex;
}

function buildKeyMove(role: string, move: Move, reason: string, tags: string[]): KeyMove {
  return {
    role,
    moveInput: move.input,
    moveName: move.name,
    reason,
    tags,
  };
}

function rankMoves(moves: Move[], compare: (a: Move, b: Move) => number): Move[] {
  return [...moves].sort(compare);
}

function pickFirstUnused(moves: Move[], usedInputs: Set<string>): Move | null {
  return moves.find(move => !usedInputs.has(move.input)) ?? null;
}

function getBaseCandidates(frameData: FrameData): Move[] {
  return frameData.moves.filter(move => {
    if (move.category === 'throw') return false;
    return parseStartupFirstActiveFrame(move.startup) !== null;
  });
}

function buildGeneratedNotes(): string {
  return '以下核心招式由帧数据规则自动提炼，适合作为上手参考；具体站位和判定仍建议结合角色攻略与实战验证。';
}

export function generateKeyMoveData(frameData: FrameData): KeyMoveData {
  const candidates = getBaseCandidates(frameData);
  const usedInputs = new Set<string>();
  const keyMoves: KeyMove[] = [];

  const fastCheckMoves = rankMoves(
    candidates.filter(move => {
      const startup = parseStartupFirstActiveFrame(move.startup);
      const onBlock = parseSignedFrameValue(move.onBlock);
      return (move.category === 'normal' || move.category === 'unique')
        && startup !== null
        && startup <= 6
        && (onBlock ?? -99) >= -4;
    }),
    (a, b) => {
      const startupDiff = (parseStartupFirstActiveFrame(a.startup) ?? 99) - (parseStartupFirstActiveFrame(b.startup) ?? 99);
      if (startupDiff !== 0) return startupDiff;
      const cancelDiff = Number(hasCancels(b)) - Number(hasCancels(a));
      if (cancelDiff !== 0) return cancelDiff;
      return (parseSignedFrameValue(b.onHit) ?? -99) - (parseSignedFrameValue(a.onHit) ?? -99);
    },
  );

  const fastCheck = pickFirstUnused(fastCheckMoves, usedInputs);
  if (fastCheck) {
    usedInputs.add(fastCheck.input);
    keyMoves.push(buildKeyMove(
      '最快小技',
      fastCheck,
      `${parseStartupFirstActiveFrame(fastCheck.startup)}F 发生，防御 ${formatAdvantage(fastCheck.onBlock)}，适合近距离试探和打断节奏。`,
      ['近身', '起手'],
    ));
  }

  const plusFrameMoves = rankMoves(
    candidates.filter(move => (parseSignedFrameValue(move.onBlock) ?? -99) > 0),
    (a, b) => {
      const plusDiff = (parseSignedFrameValue(b.onBlock) ?? -99) - (parseSignedFrameValue(a.onBlock) ?? -99);
      if (plusDiff !== 0) return plusDiff;
      const startupDiff = (parseStartupFirstActiveFrame(a.startup) ?? 99) - (parseStartupFirstActiveFrame(b.startup) ?? 99);
      if (startupDiff !== 0) return startupDiff;
      return parseDamageValue(b.damage) - parseDamageValue(a.damage);
    },
  );

  const plusFrame = pickFirstUnused(plusFrameMoves, usedInputs);
  if (plusFrame) {
    usedInputs.add(plusFrame.input);
    keyMoves.push(buildKeyMove(
      '有利压制',
      plusFrame,
      `防御 ${formatAdvantage(plusFrame.onBlock)}、命中 ${formatAdvantage(plusFrame.onHit)}，是保持回合主动权的优先按钮。`,
      ['压制', '优势帧'],
    ));
  }

  const confirmMoves = rankMoves(
    candidates.filter(move => {
      const startup = parseStartupFirstActiveFrame(move.startup);
      return (move.category === 'normal' || move.category === 'unique')
        && startup !== null
        && startup <= 10
        && hasCancels(move);
    }),
    (a, b) => {
      const damageDiff = parseDamageValue(b.damage) - parseDamageValue(a.damage);
      if (damageDiff !== 0) return damageDiff;
      const hitDiff = (parseSignedFrameValue(b.onHit) ?? -99) - (parseSignedFrameValue(a.onHit) ?? -99);
      if (hitDiff !== 0) return hitDiff;
      return (parseStartupFirstActiveFrame(a.startup) ?? 99) - (parseStartupFirstActiveFrame(b.startup) ?? 99);
    },
  );

  const confirm = pickFirstUnused(confirmMoves, usedInputs);
  if (confirm) {
    usedInputs.add(confirm.input);
    keyMoves.push(buildKeyMove(
      '稳定确认',
      confirm,
      `${parseStartupFirstActiveFrame(confirm.startup)}F 发生且可取消，伤害 ${confirm.damage}，适合作为命中确认和差合转换的主力起手。`,
      ['确认', '可取消'],
    ));
  }

  const pokePriorities = ['2MK', '5MK', '2MP', '5MP', '5HP', '2HP', '5HK'];
  const pokeMoves = rankMoves(
    candidates.filter(move => {
      const startup = parseStartupFirstActiveFrame(move.startup);
      const onBlock = parseSignedFrameValue(move.onBlock);
      return (move.category === 'normal' || move.category === 'unique')
        && startup !== null
        && startup <= 12
        && (onBlock ?? -99) >= -7;
    }),
    (a, b) => {
      const priorityDiff = byInputPriority(a, pokePriorities) - byInputPriority(b, pokePriorities);
      if (priorityDiff !== 0) return priorityDiff;
      const startupDiff = (parseStartupFirstActiveFrame(a.startup) ?? 99) - (parseStartupFirstActiveFrame(b.startup) ?? 99);
      if (startupDiff !== 0) return startupDiff;
      return (parseSignedFrameValue(b.onHit) ?? -99) - (parseSignedFrameValue(a.onHit) ?? -99);
    },
  );

  const poke = pickFirstUnused(pokeMoves, usedInputs);
  if (poke) {
    usedInputs.add(poke.input);
    keyMoves.push(buildKeyMove(
      '中距离牵制',
      poke,
      `${parseStartupFirstActiveFrame(poke.startup)}F 发生，防御 ${formatAdvantage(poke.onBlock)}，适合作为地面试探与中距离摸奖按钮。`,
      ['牵制', '地面'],
    ));
  }

  const antiAirNamePattern = /upper|shoryu|dragon|somersault|flash kick|cannon spike|tensho|jackknife|headbutt|rising/i;
  const antiAirPriorities = ['623HP', '623MP', '623LP', '623HK', '623MK', '623LK', '2HP', '5HK', '4HK'];
  const antiAirMoves = rankMoves(
    candidates.filter(move => {
      return antiAirNamePattern.test(move.name) || move.input.startsWith('623') || antiAirPriorities.includes(move.input.toUpperCase());
    }),
    (a, b) => {
      const priorityDiff = byInputPriority(a, antiAirPriorities) - byInputPriority(b, antiAirPriorities);
      if (priorityDiff !== 0) return priorityDiff;
      const startupDiff = (parseStartupFirstActiveFrame(a.startup) ?? 99) - (parseStartupFirstActiveFrame(b.startup) ?? 99);
      if (startupDiff !== 0) return startupDiff;
      return parseDamageValue(b.damage) - parseDamageValue(a.damage);
    },
  );

  const antiAir = pickFirstUnused(antiAirMoves, usedInputs);
  if (antiAir) {
    usedInputs.add(antiAir.input);
    keyMoves.push(buildKeyMove(
      '主力对空',
      antiAir,
      `${parseStartupFirstActiveFrame(antiAir.startup)}F 发生，伤害 ${antiAir.damage}，可优先作为常规空中拦截选项。`,
      ['对空', antiAir.category === 'special' ? '必杀' : '通常技'],
    ));
  }

  const punishMoves = rankMoves(
    candidates.filter(move => {
      const startup = parseStartupFirstActiveFrame(move.startup);
      return startup !== null && startup <= 12;
    }),
    (a, b) => {
      const damageDiff = parseDamageValue(b.damage) - parseDamageValue(a.damage);
      if (damageDiff !== 0) return damageDiff;
      const knockdownDiff = Number(hasKnockdown(b)) - Number(hasKnockdown(a));
      if (knockdownDiff !== 0) return knockdownDiff;
      return (parseStartupFirstActiveFrame(a.startup) ?? 99) - (parseStartupFirstActiveFrame(b.startup) ?? 99);
    },
  );

  const punish = pickFirstUnused(punishMoves, usedInputs);
  if (punish) {
    usedInputs.add(punish.input);
    keyMoves.push(buildKeyMove(
      '高伤惩罚',
      punish,
      `在 12F 内的高回报候选里伤害更突出，适合确反和 Punish Counter 起手。`,
      ['确反', '高回报'],
    ));
  }

  return {
    characterId: frameData.character.id,
    keyMoves: keyMoves.slice(0, 5),
    source: 'generated',
    notes: buildGeneratedNotes(),
  };
}

export function buildKeyMoveData(frameData: FrameData, manualData?: KeyMoveData | null): KeyMoveData {
  if (manualData && manualData.keyMoves.length > 0) {
    return {
      ...manualData,
      characterId: frameData.character.id,
      source: 'manual',
    };
  }

  return generateKeyMoveData(frameData);
}
