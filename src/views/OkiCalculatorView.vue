<script setup lang="ts">
import { ref, computed } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData, type CharacterStats } from '../types';
import { calculateTradeAdvantage, parseHitstun, getEffectiveHitstun } from '../utils/trade';
import { buildOkiResultKeyBase, getUniqueOkiResultKey } from '../utils/okiResultKey';
import { getMoveDisplayName } from '../i18n';

const attackerCharId = ref<string>('');
const defenderCharId = ref<string>('ryu'); // Default defender
const selectedKnockdownMove = ref<Move | null>(null);
const selectedDefenderMove = ref<Move | null>(null); // New: Defender's move
const attackerFrameData = ref<FrameData | null>(null);
const defenderFrameData = ref<FrameData | null>(null);
const loading = ref(false);

// Custom knockdown advantage
// Custom knockdown advantage
const customKnockdownAdv = ref<number>(38);
const useCustomKnockdown = ref(false);

import { defaultCustomMoves } from '../data/defaultCustomMoves';

// NEW: Custom Knockdown Move Interface & State
export interface CustomMove {
  id: string; // unique timestamp
  characterId: string;
  name: string;
  input: string;
  frames: number;
}

const customMoves = ref<CustomMove[]>([]);
const newCustomMove = ref({
  name: '',
  input: '',
  frames: 40
});

// Load custom moves from localStorage and merge with defaults
function loadCustomMoves() {
  let storedMoves: CustomMove[] = [];
  const stored = localStorage.getItem('sf6_oki_custom_moves');
  if (stored) {
    try {
      storedMoves = JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse custom moves', e);
    }
  }

  // Merge: Defaults + Stored
  // Prioritize Stored if ID conflict? Actually, we want to union.
  // Use a Map to deduplicate by ID.
  const moveMap = new Map<string, CustomMove>();
  
  // 1. Add defaults
  defaultCustomMoves.forEach(m => moveMap.set(m.id, m));
  
  // 2. Add stored (overwrites defaults if IDs match, which effectively syncs updates if user edits a default and saves it)
  // Wait, if user EDITS a default move, it gets saved to LS with the SAME ID? 
  // currently saveCustomMove generates a NEW ID (Date.now()).
  // So editing isn't really supported, it's "Add new". 
  // If user deletes a default move, it will come back on reload unless we track "deleted IDs".
  // For now, simple union is fine.
  storedMoves.forEach(m => moveMap.set(m.id, m));

  customMoves.value = Array.from(moveMap.values());
}

// Filter moves by current character
const filteredCustomMoves = computed(() => {
    return customMoves.value.filter(m => m.characterId === attackerCharId.value);
});

// Convert CustomMove to compatible Move object for selection
function selectCustomMove(custom: CustomMove) {
    selectedKnockdownMove.value = {
        name: custom.name,
        input: custom.input,
        startup: '0', 
        active: '0',
        recovery: '0',
        onBlock: 0,
        onHit: 0,
        damage: '0',
        category: 'normal',
        type: 'normal', // Dummy
        knockdown: {
            type: 'hard',
            advantage: custom.frames
        }
    } as unknown as Move;
    useCustomKnockdown.value = false;
}

function saveCustomMove() {
  if (!newCustomMove.value.name || !newCustomMove.value.frames) return;
  
  const move: CustomMove = {
    id: Date.now().toString(),
    characterId: attackerCharId.value,
    name: newCustomMove.value.name,
    input: newCustomMove.value.input,
    frames: newCustomMove.value.frames
  };
  
  customMoves.value.push(move);
  // Persist
  localStorage.setItem('sf6_oki_custom_moves', JSON.stringify(customMoves.value));
  
  // Clear form
  newCustomMove.value = { name: '', input: '', frames: newCustomMove.value.frames };
}

function removeCustomMove(id: string) {
  customMoves.value = customMoves.value.filter(m => m.id !== id);
  localStorage.setItem('sf6_oki_custom_moves', JSON.stringify(customMoves.value));
}

// Load on mount
import { onMounted } from 'vue';
onMounted(() => {
    loadCustomMoves();
});


// Combo chain - list of actions
interface ComboAction {
  type: 'dash' | 'move';
  name: string;
  frames: number;
  active?: number;  // Only for moves
  move?: Move;
}

const comboChain = ref<ComboAction[]>([]);
const moveSearchQuery = ref('');
const autoMatchSearchQuery = ref(''); // New: Search query for auto match results

// Opponent's fastest reversal settings
const opponentReversalStartup = ref<number>(4);
// const opponentReversalActive = ref<number>(3); // Unused

// Use combo chain as prefix for auto calculation
const useChainAsPrefix = ref(false);

// Loop throw calculator inputs
// Loop throw calculator inputs
const throwStartup = ref<number>(5);
const throwActive = ref<number>(3);
const wakeupThrowInvul = ref<number>(1);
const opponentAbareStartup = ref<number>(4);

// Selected result for detail view
const selectedResultKey = ref<string | null>(null);
const selectedThrowResultKey = ref<string | null>(null);

// Effective knockdown advantage
// Effective knockdown advantage
// Helper to parse knockdown advantage from move
function parseKnockdownAdvantage(move: Move): number {
    if (!move) return 0;
    
    // Priority 1: Parse exact advantage from 'onHit' string
    if (move.onHit && typeof move.onHit === 'string') {
        const match = move.onHit.match(/(?:KD|HKD|Crumple)[^0-9]*(\d+)/i);
        if (match) {
            return parseInt(match[1] || '0', 10);
        }
    }
    
    // Priority 2: Use scraper's parsed object
    return move.knockdown?.advantage || 0;
}

// Effective knockdown advantage
const effectiveKnockdownAdv = computed(() => {
  if (useCustomKnockdown.value && customKnockdownAdv.value > 0) {
    return customKnockdownAdv.value;
  }
  
  return parseKnockdownAdvantage(selectedKnockdownMove.value as Move);
});

// Character stats (Attacker)
const stats = computed<CharacterStats | undefined>(() => attackerFrameData.value?.stats);

// Opponent wakeup window and reversal first active frame
const opponentWakeupFrame = computed(() => {
  // First vulnerable frame after knockdown invul
  return effectiveKnockdownAdv.value + 1;
});
const opponentFirstActiveFrame = computed(() => {
  // First active (damage) frame of the reversal
  return effectiveKnockdownAdv.value + opponentReversalStartup.value;
});
const opponentPreActiveEnd = computed(() => {
  return opponentFirstActiveFrame.value - 1;
});
const opponentPreActiveWindowValid = computed(() => {
  return opponentPreActiveEnd.value >= opponentWakeupFrame.value;
});

// Loop throw calculator
const normalizedThrowStartup = computed(() => Math.max(1, throwStartup.value || 1));
const normalizedThrowActive = computed(() => Math.max(1, throwActive.value || 1));
const normalizedThrowInvul = computed(() => Math.max(0, wakeupThrowInvul.value || 0));
const normalizedAbare = computed(() => Math.max(0, opponentAbareStartup.value || 0));

// 最早可投帧 = 击倒帧 + 起身投无敌帧 + 1
// 例：38帧击倒，1帧投保护 → 第39帧是起身第1帧(投保护)，第40帧才可被投
const earliestThrowableFrame = computed(() => {
  return effectiveKnockdownAdv.value + normalizedThrowInvul.value + 1;
});

// 最晚可投帧 = 最早可投帧 + (抢招发生帧 - 2)
// 若对方抢招为0 (原地不动/防御)，则窗口仅为1帧 (最早可投帧)
// 若对方抢招为4 (4F抢招)，则 39F起身，42F判定生效。
// 我们需要在 42F 之前完成投。即 41F 也是安全的。
// 41F = 40F + (4 - ?) -> 40 + (4 - 2) = 42? No.
// Case: KD 38. Invul 1. Wakeup 39. Earliest 40.
// Abare 4. Hit at 39 (start) + (4-1) = 42. (Actually simple: 38 + 4 = 42).
// Safe frames: < 42. So Max 41. (40, 41).
// Formula: KD(38) + Abare(4) = 42. Last Safe = 41.
// Earliest = KD(38) + Invul(1) + 1 = 40.
// So Latest = KD + Abare - 1.
// But wait, what if Abare is small or 0?
// If Abare=0, assume standard perfect meaty mode (Latest = Earliest).
const latestThrowableFrame = computed(() => {
  if (normalizedAbare.value <= 0) {
    return earliestThrowableFrame.value;
  }
  // Opponent hits at: KD + Abare
  // We must hit before: KD + Abare
  // So latest safe frame is: KD + Abare - 1
  // However, we must respect invul. So Max(Earliest, KD + Abare - 1)
  const safeEnd = effectiveKnockdownAdv.value + normalizedAbare.value - 1;
  return Math.max(earliestThrowableFrame.value, safeEnd);
});

// Max Delay (Late Meaty): Hit at Latest Frame with First Active
// Wait, logical correction:
// "Delay" is usually "Input Delay".
// If I press at T. Active starts at T + Startup.
// To hit at Frame F (Latest), I can press at F - Startup.
const throwDelayMax = computed(() => {
  return latestThrowableFrame.value - normalizedThrowStartup.value;
});

// Min Delay (Early Meaty): Hit at Earliest Frame with Last Active
// To hit at Frame E (Earliest) with Last Active (A):
// Active Window: [Start, Start + A - 1]
// We want Start + A - 1 >= E -> Start >= E - A + 1.
// Press time = Start - Startup.
// So Press >= E - A + 1 - Startup.
const throwDelayMin = computed(() => {
  return earliestThrowableFrame.value - normalizedThrowActive.value + 1 - normalizedThrowStartup.value;
});

const throwDelayMinClamped = computed(() => {
  return Math.max(0, throwDelayMin.value);
});

const throwFirstActiveMin = computed(() => {
  return earliestThrowableFrame.value - (normalizedThrowActive.value - 1);
});

const throwFirstActiveMax = computed(() => {
  return latestThrowableFrame.value;
});

// Knockdown moves
const knockdownMoves = computed<Move[]>(() => {
  if (!attackerFrameData.value) return [];
  return attackerFrameData.value.moves.filter((m: Move) => m.knockdown && m.knockdown.type !== 'none');
});

// ALL moves for selection (Attacker)
const allMoves = computed<Move[]>(() => {
  if (!attackerFrameData.value) return [];
  return attackerFrameData.value.moves.filter((m: Move) => {
    // Exclude jump moves as their frame data is incomplete (missing total frames)
    if (m.name.includes('Jump')) return false;

    const startup = parseInt(m.startup) || 0;
    // Exclude jump moves (starting with 8 or containing 8) as their frame data is often special/incorrect for oki
    if (m.input.includes('8') || m.name.includes('Jump')) return false;
    return startup > 0 && startup <= 50;
  });
});

// Defender Moves (for Reversal Selection)
const defenderMoves = computed<Move[]>(() => {
  if (!defenderFrameData.value) return [];
  return defenderFrameData.value.moves.filter((m: Move) => {
    const startup = parseInt(m.startup) || 0;
    return startup > 0;
  });
});

// Filtered moves for search (Attacker)
const filteredMoves = computed<Move[]>(() => {
  if (!attackerFrameData.value) return [];
  const queryRaw = moveSearchQuery.value.trim();
  const queryLower = queryRaw.toLowerCase();
  if (!queryRaw) return allMoves.value.slice(0, 15);
  return allMoves.value.filter((m: Move) =>
    m.name.toLowerCase().includes(queryLower) ||
    (m.nameZh && m.nameZh.includes(queryRaw)) ||
    m.input.toLowerCase().includes(queryLower)
  ).slice(0, 15);
});

// Logic for searchable defender move selector
const defenderMoveSearchQuery = ref('');
const showDefenderDropdown = ref(false);

const filteredDefenderMoves = computed<Move[]>(() => {
  if (!defenderMoves.value) return [];
  const queryRaw = defenderMoveSearchQuery.value.trim();
  const queryLower = queryRaw.toLowerCase();
  // If query matches current selection exactly, maybe show others? 
  // For now just partial match
  if (!queryRaw) return defenderMoves.value.slice(0, 30);

  return defenderMoves.value.filter((m: Move) =>
    m.name.toLowerCase().includes(queryLower) ||
    (m.nameZh && m.nameZh.includes(queryRaw)) ||
    (m.input && m.input.toLowerCase().includes(queryLower))
  ).slice(0, 30);
});

function selectDefenderMove(move: Move) {
  selectedDefenderMove.value = move;
  defenderMoveSearchQuery.value = getMoveDisplayName(move);
  showDefenderDropdown.value = false;
}

// Sync query with selected move (e.g. initial load)
watch(selectedDefenderMove, (newVal) => {
  if (newVal) {
    defenderMoveSearchQuery.value = getMoveDisplayName(newVal);
  }
});

function handleDefenderBlur() {
  setTimeout(() => showDefenderDropdown.value = false, 200);
}



// Helper to evaluate frame strings like "2,3", "5(5)3", "10+2", "2*3".
function evaluateFrameString(val: string | number | undefined): number {
  if (!val || val === '-') return 0;
  if (typeof val === 'number') return val;

  const text = String(val);

  // If explicit total is provided, prefer it.
  const totalMatch = text.match(/(\d+)\s*total/i);
  const totalValue = totalMatch?.[1];
  if (totalValue) return parseInt(totalValue, 10);

  // Normalize ranges like "13~17" by keeping the first value (min).
  let normalized = text.replace(/(\d+)\s*~\s*(\d+)/g, '$1');
  normalized = normalized.replace(/(\d+)\s*~\s*/g, '$1');

  const numbers = normalized.match(/-?\d+/g);
  if (!numbers) return 0;

  return numbers.reduce((sum, n) => sum + parseInt(n, 10), 0);
}

type ActiveSegmentInfo = {
  segments: number[];
  gaps: number[];
  totalActive: number; // sum of active segments only
  totalWindow: number; // active segments + gaps (window length)
  lastSegmentLength: number;
  lastSegmentStartOffset: number; // offset from first active frame
};

function parseActiveSegments(active: string | number | undefined): ActiveSegmentInfo {
  if (!active || active === '-') {
    return {
      segments: [1],
      gaps: [],
      totalActive: 1,
      totalWindow: 1,
      lastSegmentLength: 1,
      lastSegmentStartOffset: 0,
    };
  }

  if (typeof active === 'number') {
    const len = Math.max(1, active);
    return {
      segments: [len],
      gaps: [],
      totalActive: len,
      totalWindow: len,
      lastSegmentLength: len,
      lastSegmentStartOffset: 0,
    };
  }

  const text = String(active);
  const totalOverrideMatch = text.match(/(\d+)\s*total/i);
  const totalOverride = totalOverrideMatch && totalOverrideMatch[1] ? parseInt(totalOverrideMatch[1], 10) : undefined;

  // Remove "(... total ...)" so it doesn't get treated as a gap
  const sanitized = text.replace(/\([^)]*total[^)]*\)/gi, '');

  const tokens: { type: 'segment' | 'gap'; value: number }[] = [];
  let inParen = false;
  for (let i = 0; i < sanitized.length; ) {
    const ch = sanitized[i];
    if (ch === '(') {
      inParen = true;
      i += 1;
      continue;
    }
    if (ch === ')') {
      inParen = false;
      i += 1;
      continue;
    }

    const numMatch = sanitized.slice(i).match(/^-?\d+/);
    if (numMatch) {
      const value = parseInt(numMatch[0], 10);
      if (!isNaN(value)) {
        tokens.push({ type: inParen ? 'gap' : 'segment', value });
      }
      i += numMatch[0].length;
      continue;
    }
    i += 1;
  }

  const segments = tokens.filter(t => t.type === 'segment').map(t => t.value);
  const gaps = tokens.filter(t => t.type === 'gap').map(t => t.value);
  let totalActive = segments.reduce((sum, n) => sum + n, 0);
  if (totalOverride !== undefined) totalActive = totalOverride;
  if (totalActive <= 0) totalActive = 1;

  const totalWindowRaw = evaluateFrameString(text);
  const totalWindow = totalWindowRaw > 0 ? totalWindowRaw : totalActive;

  const lastSegmentLength = segments.length > 0 ? (segments[segments.length - 1] ?? 1) : totalActive;
  let lastSegmentStartOffset = 0;
  if (segments.length > 0) {
    let seenSegments = 0;
    for (const token of tokens) {
      if (token.type === 'segment') {
        seenSegments += 1;
        if (seenSegments === segments.length) break;
      }
      lastSegmentStartOffset += token.value;
    }
  }

  return {
    segments,
    gaps,
    totalActive,
    totalWindow,
    lastSegmentLength: Math.max(1, lastSegmentLength),
    lastSegmentStartOffset,
  };
}

// Parse total active frames (hit frames only, excludes gaps)
function parseTotalActiveFrames(active: string | undefined): number {
  const info = parseActiveSegments(active);
  return info.totalActive > 0 ? info.totalActive : 1;
}

// Parse active window length (includes gaps, for total duration)
function parseActiveWindowFrames(active: string | undefined): number {
  const info = parseActiveSegments(active);
  return info.totalWindow > 0 ? info.totalWindow : 1;
}

function parseTotalRecoveryFrames(recovery: string | undefined): number {
  // If format is like "13(15)", the value in parentheses is Whiff recovery.
  // For Oki calculation (Frame Kill), we want the Whiff recovery.
  if (recovery && typeof recovery === 'string') {
    const whiffMatch = recovery.match(/\((\d+)\)/);
    if (whiffMatch) {
      return parseInt(whiffMatch[1] || '0');
    }
  }
  return evaluateFrameString(recovery);
}

function getMoveTotalFrames(move: Move): number {
  // Use raw total if available (most accurate)
  if (move.raw && move.raw.total) {
    // raw.total can be number or string like "22(24)"
    const rawTotal = move.raw.total;
    if (typeof rawTotal === 'number') return rawTotal;
    if (typeof rawTotal === 'string') {
        const whiffMatch = rawTotal.match(/\((\d+)\)/);
        if (whiffMatch) {
             return parseInt(whiffMatch[1] || '0');
        }
        // Fallback for string without parenthesis (e.g., "40")
        const parsed = parseInt(rawTotal);
        if (!isNaN(parsed)) return parsed;
    }
  }

  const startup = parseInt(move.startup) || 0;
  const active = parseActiveWindowFrames(move.active);
  const recovery = parseTotalRecoveryFrames(move.recovery);
  // Startup in data is "First Active Frame" (e.g. 6 means hits on frame 6).
  // So actual startup duration is startup - 1.
  const startupFrames = Math.max(0, startup - 1);
  return startupFrames + active + recovery;
}

function getMoveDurationFrames(move: Move, startupOverride?: number): number {
  const startupRaw = startupOverride ?? (parseInt(move.startup) || 0);
  const startup = Math.max(1, startupRaw);
  const startupFrames = Math.max(0, startup - 1);
  const active = parseActiveWindowFrames(move.active);
  const recovery = parseTotalRecoveryFrames(move.recovery);
  return startupFrames + active + recovery;
}

function isGroundedMove(move: Move): boolean {
  const input = (move.input || '').toLowerCase().trim();
  const name = (move.name || '').toLowerCase();
  const rawName = (move.raw?.moveName || '').toLowerCase();
  if (input.startsWith('j') || input.includes('j.')) return false;
  if (name.includes('jump') || rawName.includes('jump')) return false;
  return true;
}

function isLightNormal(move: Move): boolean {
  if (move.category !== 'normal') return false;
  const input = (move.input || '').toUpperCase();
  if (input.includes('~')) return false;
  const name = (move.name || '').toLowerCase();
  const rawName = (move.raw?.moveName || '').toLowerCase();
  const nameZh = (move.nameZh || '');
  if (input.includes('LP') || input.includes('LK')) return true;
  if (name.includes('light') || rawName.includes('light')) return true;
  if (nameZh.includes('轻')) return true;
  return false;
}

function canChainCancel(sourceMove: Move, targetMove: Move): boolean {
  if (!sourceMove.cancels || sourceMove.cancels.length === 0) return false;
  const hasChain = sourceMove.cancels.some(t => {
    const tag = t.toUpperCase();
    return tag === 'CHAIN' || tag === 'CHN';
  });
  if (!hasChain) return false;
  return targetMove.category?.toLowerCase() === 'normal' && isGroundedMove(targetMove) && isLightNormal(targetMove);
}

function computeComboChainTiming(actions: ComboAction[]): { ourStart: number; ourEnd: number; totalDuration: number } | null {
  if (actions.length === 0) return null;

  let timeBefore = 0;
  let ourStart = 0;
  let ourEnd = 0;
  let hasLastMove = false;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;

    if (action.type === 'dash') {
      timeBefore += action.frames;
      continue;
    }

    if (action.type === 'move' && action.move) {
      const prevAction = i > 0 ? actions[i - 1] : undefined;
      const prevMove = prevAction?.type === 'move' ? prevAction.move : undefined;
      const chainedIn = !!(prevMove && canChainCancel(prevMove, action.move));

      const baseStartup = parseInt(action.move.startup) || action.frames || 0;
      const startup = chainedIn ? 1 : Math.max(1, baseStartup);
      const active = parseActiveWindowFrames(action.move.active);
      const activeStart = timeBefore + startup;
      const activeEnd = activeStart + active - 1;

      if (i === actions.length - 1) {
        ourStart = activeStart;
        ourEnd = activeEnd;
        hasLastMove = true;
      }

      let duration = getMoveDurationFrames(action.move, startup);

      const nextAction = actions[i + 1];
      const nextMove = nextAction?.type === 'move' ? nextAction.move : undefined;
      if (nextMove && canChainCancel(action.move, nextMove)) {
        duration = Math.max(0, duration - 1);
      }

      timeBefore += duration;
      continue;
    }

    // Fallback: unknown action, just add frames
    timeBefore += action.frames;
  }

  if (!hasLastMove) return null;
  return { ourStart, ourEnd, totalDuration: timeBefore };
}

// Calculate combo result
const comboResult = computed(() => {
  if (comboChain.value.length === 0 || effectiveKnockdownAdv.value <= 0) return null;

  const timing = computeComboChainTiming(comboChain.value);
  if (!timing) return null;
  const ourStart = timing.ourStart;
  const ourEnd = timing.ourEnd;

  const oppFirst = opponentFirstActiveFrame.value;
  const oppWindowStart = opponentWakeupFrame.value;
  const oppWindowEnd = opponentPreActiveEnd.value;
  const hasPreActiveWindow = oppWindowEnd >= oppWindowStart;
  // Success: our active window overlaps opponent's vulnerable startup window
  const overlapsPreActive =
    hasPreActiveWindow && ourEnd >= oppWindowStart && ourStart <= oppWindowEnd;
  const overlapsOppFirst = ourStart <= oppFirst && ourEnd >= oppFirst;
  const isSuccess = overlapsPreActive;
  const isTrade = overlapsOppFirst && !overlapsPreActive;
  const coversOpponent = isSuccess; // For backward compatibility

  let status = '';
  if (isSuccess) {
    status = '压制成功 ✓';
  } else if (isTrade) {
    status = '相杀';
  } else if (ourEnd < oppWindowStart) {
    status = '打击太早';
  } else {
    status = '打击太晚';
  }

  return {
    totalStartup: ourStart,
    ourStart,
    ourEnd,
    coversOpponent,
    status,
  };
});

// Extended Oki Result for auto list
interface ExtendedOkiResult {
  key: string;
  move: Move;
  prefix: string;
  prefixInput?: string;
  prefixFrames: number;
  ourActiveStart: number;
  ourActiveEnd: number;
  activeDisplayStartOffset?: number;
  activeDisplayLength?: number;
  activeHasGap?: boolean;
  activeHasMultipleSegments?: boolean;
  activeHitTotal?: number;
  meatyStartFrame?: number;
  meatyStartOffset?: number;
  meatyLength?: number;
  toleranceFrames?: number;
  coversOpponent: boolean;
  isTrade: boolean;
  calculatedOnBlock?: number | string;
  calculatedOnHit?: number | string;
  meatyBonus?: number;
  effectiveHitFrame?: number;
  tradeAdvantage?: number;
  tradeDetail?: string;
  tradeExplanation?: string;
  tags?: string[]; // New: e.g. 'Corner Only'
}

function parseFrameAdvantage(adv: string): number | null {
  if (!adv || adv === 'KD') return null;
  const match = adv.match(/^[+-]?\d+/);
  return match ? parseInt(match[0]) : null;
}

function isComboSequenceMove(move: Move): boolean {
  const input = move.input || '';
  const name = move.name || '';
  return input.includes('~') || name.includes('~');
}

// Calculate prefix frames from combo chain (use chain-aware timing)
const comboChainPrefixFrames = computed(() => {
  const timing = computeComboChainTiming(comboChain.value);
  return timing ? timing.totalDuration : 0;
});

// Build prefix name from combo chain
const comboChainPrefixName = computed(() => {
  if (comboChain.value.length === 0) return '';
  return comboChain.value
    .map((a: ComboAction) => (a.type === 'move' && a.move ? getMoveDisplayName(a.move) : a.name))
    .join(' + ');
});

const comboChainPrefixInput = computed(() => {
  if (comboChain.value.length === 0) return '';
  return comboChain.value.map((a: ComboAction) => {
    if (a.type === 'dash') return a.name;
    return a.move?.input || a.name;
  }).join(' + ');
});

// Prefix frames for throw (chain-aware, includes move recovery)
const comboChainThrowPrefixFrames = computed(() => {
  const timing = computeComboChainTiming(comboChain.value);
  return timing ? timing.totalDuration : 0;
});

// Toggle result detail
function toggleResultDetail(key: string) {
  if (selectedResultKey.value === key) {
    selectedResultKey.value = null;
  } else {
    selectedResultKey.value = key;
  }
}

// Toggle throw result detail
function toggleThrowResultDetail(key: string) {
  if (selectedThrowResultKey.value === key) {
    selectedThrowResultKey.value = null;
  } else {
    selectedThrowResultKey.value = key;
  }
}

// Sort State
const sortKey = ref<'block' | 'hit' | 'trade' | 'startup' | 'tolerance'>('block');
const sortOrder = ref<'asc' | 'desc'>('desc');

// Toggle Sort
function toggleSort(key: 'block' | 'hit' | 'trade' | 'startup' | 'tolerance') {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc';
  } else {
    sortKey.value = key;
    sortOrder.value = key === 'startup' ? 'asc' : 'desc'; // Default order by key
  }
}

// Auto results
const allOkiResults = computed<ExtendedOkiResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];

  const results: ExtendedOkiResult[] = [];
  const keyCounts = new Map<string, number>();
  const oppFirst = opponentFirstActiveFrame.value;
  const oppWindowStart = opponentWakeupFrame.value;
  const oppWindowEnd = opponentPreActiveEnd.value;
  const hasPreActiveWindow = oppWindowEnd >= oppWindowStart;

  const validFrameKills = allMoves.value.filter(m => {
    if (m.category === 'super' || m.category === 'throw') return false;
    if (isComboSequenceMove(m)) return false;
    const total = getMoveTotalFrames(m);
    // Heuristic: Frame kill should be faster than the knockdown advantage
    // Also exclude moves that are too long (e.g. taunts)
    return total > 0 && total < effectiveKnockdownAdv.value && total < 60;
  });

  let prefixes: { name: string; frames: number; input?: string; isCorner?: boolean }[];

  if (useChainAsPrefix.value && comboChain.value.length > 0) {
    // Use combo chain as the only prefix
    const basePrefix = {
      name: comboChainPrefixName.value,
      frames: comboChainPrefixFrames.value,
      input: comboChainPrefixInput.value,
      isCorner: false
    };
    prefixes = [basePrefix];

    for (const kill of validFrameKills) {
      const total = getMoveTotalFrames(kill);
      const combinedFrames = basePrefix.frames + total;
      prefixes.push({
        name: basePrefix.name ? `${basePrefix.name} + ${kill.name}` : kill.name,
        frames: combinedFrames,
        input: basePrefix.input ? `${basePrefix.input} + ${kill.input}` : kill.input,
        isCorner: true
      });
    }
  } else {
    // Default prefixes (Dashes)
    prefixes = [
      { name: '', frames: 0, isCorner: false },
      { name: '前冲', frames: stats.value.forwardDash, isCorner: false },
      { name: '前冲x2', frames: stats.value.forwardDash * 2, isCorner: false },
    ];

    // Add Frame Kill Moves (Single Move)
    // Filter moves that are suitable for frame kills (Total frames < advantage)
    // And generally not supers?
    for (const kill of validFrameKills) {
      const total = getMoveTotalFrames(kill);
      prefixes.push({
        name: kill.name,
        frames: total,
        input: kill.input,
        isCorner: true // Moves usually don't travel as far as dash, so imply corner
      });

      // Add Dash + Move (Common setup)
      const dashTotal = stats.value.forwardDash + total;
      if (dashTotal < effectiveKnockdownAdv.value) {
        prefixes.push({
          name: `前冲 + ${kill.name}`,
          frames: dashTotal,
          input: kill.input,
          isCorner: true
        });
      }
    }
  }

  for (const prefix of prefixes) {
    for (const move of allMoves.value) {
      if (isComboSequenceMove(move)) continue;
      const startup = parseInt(move.startup) || 0;
      const activeInfo = parseActiveSegments(move.active);
      const activeHasGap = activeInfo.gaps.length > 0;
      const activeHasMultipleSegments = activeInfo.segments.length > 1;
      const activeHitTotal = parseTotalActiveFrames(move.active);
      const activeDisplayStartOffset = activeHasGap ? activeInfo.lastSegmentStartOffset : 0;
      const activeDisplayLength = activeHasGap ? activeInfo.lastSegmentLength : activeHitTotal;
      const meatyStartOffset = activeHasMultipleSegments ? activeInfo.lastSegmentStartOffset : 0;
      const meatyLength = activeHasMultipleSegments ? activeInfo.lastSegmentLength : activeHitTotal;
      if (startup <= 0) continue;

      // Display/overlap window:
      // - If there is a gap, only show the last segment as the effective window.
      // - If no gap (e.g. "2,3"), treat as continuous 5F window.
      const ourStart = prefix.frames + startup + activeDisplayStartOffset;
      const ourEnd = ourStart + activeDisplayLength - 1;

      // Success: our active window overlaps opponent's vulnerable startup window
      const overlapsPreActive =
        hasPreActiveWindow && ourEnd >= oppWindowStart && ourStart <= oppWindowEnd;
      const overlapsOppFirst = ourStart <= oppFirst && ourEnd >= oppFirst;

      const isSuccessMatch = overlapsPreActive;
      const isTradeMatch = overlapsOppFirst && !overlapsPreActive;
      const toleranceFrames = isSuccessMatch ? Math.max(0, oppWindowEnd - ourStart) : undefined;

      if (isSuccessMatch || isTradeMatch) {
        // Calculate Meaty Bonus
        const meatyStartFrame = prefix.frames + startup + meatyStartOffset;
        const effectiveHitFrame = Math.max(meatyStartFrame, oppWindowStart);
        const canApplyMeaty = !move.noMeaty;
        const meatyBonus = canApplyMeaty ? (effectiveHitFrame - meatyStartFrame) : 0;

        let calcBlock: number | string | undefined;
        let calcHit: number | string | undefined;
        let tradeAdv: number | undefined;
        let tradeDet: string | undefined;
        let tradeExpl = '';

        const baseBlock = parseFrameAdvantage(move.onBlock);
        if (baseBlock !== null) {
          calcBlock = baseBlock + meatyBonus;
        } else {
          calcBlock = move.onBlock;
        }

        const baseHit = parseFrameAdvantage(move.onHit);
        if (baseHit !== null) {
          // User requested: "Successful pressure is basically Counter Hit".
          // So we add 2 frames for Counter Hit (since SF6 usually gives +2 for CH).
          const chBonus = (isSuccessMatch) ? 2 : 0;
          calcHit = baseHit + meatyBonus + chBonus;
        } else {
          calcHit = move.onHit;
        }

        // Calculate Trade Advantage
        if (isTradeMatch) {
          if (selectedDefenderMove.value && move.raw && selectedDefenderMove.value.raw) {
            const adv = calculateTradeAdvantage(move.raw, selectedDefenderMove.value.raw);
            tradeAdv = adv;
            tradeDet = `${adv > 0 ? '+' : ''}${adv}`;

            const effA = getEffectiveHitstun(move.raw);
            const effB = getEffectiveHitstun(selectedDefenderMove.value.raw);

            const labelA = effA.type === 'blockstun' ? `(Blockstun ${parseHitstun(move.raw.blockstun)} + 2CH)` : `(Hitstun ${parseHitstun(move.raw.hitstun)} + 2CH)`;
            const labelB = effB.type === 'blockstun' ? `(Blockstun ${parseHitstun(selectedDefenderMove.value.raw.blockstun)} + 2CH)` : `(Hitstun ${parseHitstun(selectedDefenderMove.value.raw.hitstun)} + 2CH)`;

            tradeExpl = `${getMoveDisplayName(move)} ${labelA} - ${getMoveDisplayName(selectedDefenderMove.value)} ${labelB} = ${adv}`;
          } else {
            tradeDet = '需选择招式';
          }
        }

        const baseKey = buildOkiResultKeyBase({
          prefixName: prefix.name,
          prefixFrames: prefix.frames,
          prefixInput: prefix.input,
          moveName: move.name,
          moveInput: move.input,
          ourActiveStart: ourStart,
          ourActiveEnd: ourEnd
        });
        const key = getUniqueOkiResultKey(baseKey, keyCounts);

        results.push({
          key,
          move,
          prefix: prefix.name,
          prefixInput: prefix.input,
          prefixFrames: prefix.frames,
          ourActiveStart: ourStart,
          ourActiveEnd: ourEnd,
          activeDisplayStartOffset,
          activeDisplayLength,
          activeHasGap,
          activeHasMultipleSegments,
          activeHitTotal,
          meatyStartFrame,
          meatyStartOffset,
          meatyLength,
          toleranceFrames,
          coversOpponent: isSuccessMatch,
          isTrade: isTradeMatch,
          calculatedOnBlock: calcBlock,
          calculatedOnHit: calcHit,
          meatyBonus,
          effectiveHitFrame,
          tradeAdvantage: tradeAdv,
          tradeDetail: tradeDet,
          tradeExplanation: tradeExpl,
          tags: prefix.isCorner ? ['版边(Corner)'] : []
        });
      }
    }
  }

  return results;
});

const okiResults = computed<ExtendedOkiResult[]>(() => {
  let filtered = allOkiResults.value;
  
  if (autoMatchSearchQuery.value) {
    const queryRaw = autoMatchSearchQuery.value.trim();
    const queryLower = queryRaw.toLowerCase();
    filtered = filtered.filter(result => {
      const fields = [
        result.prefix,
        result.prefixInput,
        result.move.name,
        result.move.nameZh,
        result.move.input,
        getMoveDisplayName(result.move)
      ].filter((val): val is string => typeof val === 'string' && val.length > 0);

      return fields.some(field => field.toLowerCase().includes(queryLower));
    });
  }

  const sorted = [...filtered].sort((a, b) => {
    let valA = 0;
    let valB = 0;

    switch (sortKey.value) {
      case 'block':
        valA = typeof a.calculatedOnBlock === 'number' ? a.calculatedOnBlock : -999;
        valB = typeof b.calculatedOnBlock === 'number' ? b.calculatedOnBlock : -999;
        break;
      case 'hit':
        valA = typeof a.calculatedOnHit === 'number' ? a.calculatedOnHit : -999;
        valB = typeof b.calculatedOnHit === 'number' ? b.calculatedOnHit : -999;
        break;
      case 'trade':
        valA = a.tradeAdvantage ?? -999;
        valB = b.tradeAdvantage ?? -999;
        break;
      case 'startup':
        valA = a.ourActiveStart;
        valB = b.ourActiveStart;
        break;
      case 'tolerance':
        valA = a.toleranceFrames ?? -999;
        valB = b.toleranceFrames ?? -999;
        break;
    }

    if (valA !== valB) {
      return sortOrder.value === 'desc' ? valB - valA : valA - valB;
    }

    return a.ourActiveStart - b.ourActiveStart;
  });

  return sorted.slice(0, 50);
});

// Throw filler moves (exclude throws, keep reasonable total frames)
const throwFillerMoves = computed<Move[]>(() => {
  if (!attackerFrameData.value) return [];
  return attackerFrameData.value.moves.filter((m: Move) => {
    if (m.category === 'throw') return false;
    // Exclude jump moves (starting with 8 or containing 8)
    if (m.input.includes('8') || m.name.includes('Jump')) return false;
    const startup = parseInt(m.startup) || 0;
    if (startup <= 0) return false;
    const totalFrames = getMoveTotalFrames(m);
    return totalFrames > 0 && totalFrames <= 90;
  });
});

interface ThrowComboResult {
  key: string;
  prefix: string;
  prefixFrames: number;
  filler?: Move;
  fillerName: string;
  fillerFrames: number;
  fillerStartup?: number;
  fillerActive?: number;
  fillerRecovery?: number;
  delay: number;
  firstActive: number;
  toleranceFrames: number;
}

const allThrowResults = computed<ThrowComboResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];
  if (throwDelayMax.value < 0) return [];

  let prefixes: { name: string; frames: number }[];
  if (useChainAsPrefix.value && comboChain.value.length > 0) {
    prefixes = [
      { name: comboChainPrefixName.value, frames: comboChainThrowPrefixFrames.value },
    ];
  } else {
    prefixes = [
      { name: '', frames: 0 },
      { name: '前冲', frames: stats.value.forwardDash },
      { name: '前冲x2', frames: stats.value.forwardDash * 2 },
    ];
  }

  const results: ThrowComboResult[] = [];
  const minDelay = throwDelayMinClamped.value;
  const maxDelay = throwDelayMax.value;
  const throwStart = normalizedThrowStartup.value;

  for (const prefix of prefixes) {
    const baseDelay = prefix.frames;
    if (baseDelay >= minDelay && baseDelay <= maxDelay) {
      const key = `${prefix.name}|direct|${prefix.frames}`;
      results.push({
        key,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        fillerName: '直接投',
        fillerFrames: 0,
        delay: baseDelay,
        firstActive: baseDelay + throwStart,
        toleranceFrames: Math.max(0, maxDelay - baseDelay),
      });
    }

    for (const move of throwFillerMoves.value) {
      const fillerStartup = parseInt(move.startup) || 0;
      const fillerActive = parseActiveWindowFrames(move.active);
      const fillerRecovery = parseTotalRecoveryFrames(move.recovery);
      // Use helper for correct total (handles raw.total and startup-1 logic)
      const fillerFrames = getMoveTotalFrames(move); 
      const delay = prefix.frames + fillerFrames;

      if (delay < minDelay || delay > maxDelay) continue;

      const key = `${prefix.name}|${prefix.frames}|${move.name}|${move.input}|${fillerFrames}`;
      results.push({
        key,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        filler: move,
        fillerName: getMoveDisplayName(move),
        fillerFrames,
        fillerStartup,
        fillerActive,
        fillerRecovery,
        delay,
        firstActive: delay + throwStart,
        toleranceFrames: Math.max(0, maxDelay - delay),
      });
    }
  }

  return results;
});

const throwSortKey = ref<'delay' | 'firstActive' | 'tolerance'>('delay');
const throwSortOrder = ref<'asc' | 'desc'>('asc');

function toggleThrowSort(key: 'delay' | 'firstActive' | 'tolerance') {
  if (throwSortKey.value === key) {
    throwSortOrder.value = throwSortOrder.value === 'desc' ? 'asc' : 'desc';
  } else {
    throwSortKey.value = key;
    throwSortOrder.value = key === 'tolerance' ? 'desc' : 'asc';
  }
}

const throwResults = computed(() => {
  const sorted = [...allThrowResults.value].sort((a, b) => {
    const valA = throwSortKey.value === 'delay'
      ? a.delay
      : throwSortKey.value === 'firstActive'
        ? a.firstActive
        : a.toleranceFrames;
    const valB = throwSortKey.value === 'delay'
      ? b.delay
      : throwSortKey.value === 'firstActive'
        ? b.firstActive
        : b.toleranceFrames;

    if (valA !== valB) {
      return throwSortOrder.value === 'desc' ? valB - valA : valA - valB;
    }

    // Secondary sort: Delay asc for stability
    return a.delay - b.delay;
  });

  return sorted.slice(0, 50);
});

// Actions
// Character data modules
const characterModules = import.meta.glob('../data/characters/*.json');

async function loadCharacterData(role: 'attacker' | 'defender', charId: string) {
  if (!charId) {
    if (role === 'attacker') attackerFrameData.value = null;
    else defenderFrameData.value = null;
    return;
  }

  loading.value = true;
  try {
    const path = `../data/characters/${charId}.json`;
    const loader = characterModules[path];

    if (!loader) {
      console.error(`Character data not found for: ${charId}`);
      if (role === 'attacker') attackerFrameData.value = null;
      else defenderFrameData.value = null;
      return;
    }

    const module = await loader() as { default: FrameData };
    if (role === 'attacker') {
      attackerFrameData.value = module.default;
      // Reset selection if character changes
      selectedKnockdownMove.value = null;
      useCustomKnockdown.value = false;
      comboChain.value = [];
    } else {
      defenderFrameData.value = module.default;
      selectedDefenderMove.value = null;
    }
  } catch (e) {
    console.error(`Failed to load character data for ${charId}:`, e);
    if (role === 'attacker') attackerFrameData.value = null;
    else defenderFrameData.value = null;
  } finally {
    loading.value = false;
  }
}

// Watchers
import { watch } from 'vue';

watch(attackerCharId, (newVal) => {
  loadCharacterData('attacker', newVal);
});

watch(defenderCharId, (newVal) => {
  loadCharacterData('defender', newVal);
}, { immediate: true });

// When defender move changes, update abare startup
watch(selectedDefenderMove, (newMove) => {
  if (newMove) {
    const startup = parseInt(newMove.startup) || 0;
    if (startup > 0) {
      opponentReversalStartup.value = startup;
    }
  }
});

function selectKnockdownMove(move: Move) {
  selectedKnockdownMove.value = move;
  useCustomKnockdown.value = false;
}

function enableCustomKnockdown() {
  useCustomKnockdown.value = true;
  selectedKnockdownMove.value = null;
}

function isSelectedKnockdown(move: { name: string; input: string }): boolean {
  if (useCustomKnockdown.value) return false;
  const selected = selectedKnockdownMove.value;
  if (!selected) return false;
  return selected.name === move.name && selected.input === move.input;
}

function addDash() {
  if (!stats.value) return;
  comboChain.value.push({
    type: 'dash',
    name: '前冲',
    frames: stats.value.forwardDash,
  });
}

function addMove(move: Move) {
  const startup = parseInt(move.startup) || 0;
  const active = parseActiveWindowFrames(move.active);
  comboChain.value.push({
    type: 'move',
    name: move.name,
    frames: startup,
    active: active,
    move: move,
  });
  moveSearchQuery.value = '';
}

function removeAction(index: number) {
  comboChain.value.splice(index, 1);
}

function clearCombo() {
  comboChain.value = [];
}

// Helpers for template
interface TimelineFrame {
  index: number;
  globalFrame: number;
  type: 'prefix' | 'startup' | 'active' | 'recovery' | 'down' | 'vulnerable' | 'hitstun' | 'blockstun' | 'neutral';
  isWakeup: boolean;
  isReversal: boolean;
  isVulnerable: boolean;
  isHit?: boolean;
  label?: number;
}

// Attacker Timeline
function generateTimelineFrames(
  result: ExtendedOkiResult,
  oppWakeupFrame: number,
  oppReversalFrame: number
): TimelineFrame[] {
  const frames: TimelineFrame[] = [];

  const prefixFrames = result.prefixFrames;
  const startup = parseInt(result.move.startup) || 0;
  const active = parseActiveWindowFrames(result.move.active);
  const recovery = parseTotalRecoveryFrames(result.move.recovery);

  const moveStartFrame = prefixFrames;

  // Calculate Attacker Duration
  // Prefix + Startup + Active + Recovery
  const total = moveStartFrame + startup + active + recovery;

  // Also consider Defender's interaction to extend timeline if needed? 
  // For Attacker Row, just show functionality.
  // Actually, we should align lengths across rows for grid perfection.
  // But let's let CSS handle alignment (width). 
  // We'll generate up to Attacker's End for now.

  const activeStart = prefixFrames + startup;
  const activeEnd = prefixFrames + startup + active - 1;


  for (let i = 1; i <= total; i++) {
    const globalFrame = i;

    let type: TimelineFrame['type'];

    if (i <= prefixFrames) {
      type = 'prefix';
    } else if (i < activeStart) {
      type = 'startup';
    } else if (i <= activeEnd) {
      type = 'active';
    } else {
      type = 'recovery';
    }

    // Markers (kept for reference, primarily on Defender/Interaction row)
    const isWakeup = (globalFrame === oppWakeupFrame);
    const isReversal = (globalFrame === oppReversalFrame);
    const isVulnerable = (globalFrame >= oppWakeupFrame && globalFrame < oppReversalFrame);

    let isHit = false;
    if (type === 'active') {
      if (result.effectiveHitFrame && globalFrame === result.effectiveHitFrame) {
        isHit = true;
      }
    }

    let label: number | undefined;
    // Show label for: 1, Prefix End, Startup End, Active End, Total
    if (i === 1) label = i;
    else if (i === prefixFrames && prefixFrames > 0) label = i;
    else if (i === activeStart && i !== 1) label = i;
    else if (i === activeEnd) label = i;
    else if (i === total) label = i;
    else if (isHit) label = i;

    frames.push({
      index: i,
      globalFrame,
      type,
      isWakeup,
      isReversal,
      isVulnerable,
      isHit,
      label
    });
  }

  return frames;
}

// Defender Timeline
function generateDefenderFrames(
  result: ExtendedOkiResult,
  oppWakeupFrame: number,
  mode: 'hit' | 'block'
): TimelineFrame[] {
  const frames: TimelineFrame[] = [];

  // Calculate durations
  const prefixFrames = result.prefixFrames;
  const startup = parseInt(result.move.startup) || 0;
  const active = parseActiveWindowFrames(result.move.active);
  const recovery = parseTotalRecoveryFrames(result.move.recovery);
  const attackerEnd = prefixFrames + startup + active + recovery;

  // Calculate Advantage & Stun End
  const advantage = mode === 'hit'
    ? (typeof result.calculatedOnHit === 'number' ? result.calculatedOnHit : 0)
    : (typeof result.calculatedOnBlock === 'number' ? result.calculatedOnBlock : 0);

  // Defender becomes free at: AttackerEnd + Advantage
  // Note: If advantage is negative, defender is free BEFORE attacker.
  // If advantage is positive, defender is free AFTER attacker.
  const defenderFreeFrame = attackerEnd + advantage + 1;

  // Max Frame to render: at least up to AttackerEnd, or DefenderFreeFrame if later.
  const totalRender = Math.max(attackerEnd, defenderFreeFrame - 1, oppWakeupFrame + 10);

  const impactFrame = result.effectiveHitFrame || 9999;

  for (let i = 1; i <= totalRender; i++) {
    const globalFrame = i;
    let type: TimelineFrame['type'] = 'neutral';

    if (i < oppWakeupFrame) {
      type = 'down';
    } else if (i < impactFrame) {
      type = 'vulnerable';
    } else if (i < defenderFreeFrame) {
      // Stun state
      type = mode === 'hit' ? 'hitstun' : 'blockstun';
    } else {
      type = 'neutral';
    }

    const isWakeup = (globalFrame === oppWakeupFrame);
    // Only show impact marker on defender row?
    const isHit = (globalFrame === impactFrame);

    let label: number | undefined;
    if (isWakeup || isHit || i === defenderFreeFrame - 1) label = i;

    frames.push({
      index: i,
      globalFrame,
      type,
      isWakeup,
      isReversal: false,
      isVulnerable: false,
      isHit,
      label
    });
  }

  return frames;
}

// Throw Timeline Generators
// Throw Timeline Generators
function generateThrowTimelineFrames(
  result: ThrowComboResult,
  oppWakeupFrame: number,
  throwStartup: number,
  throwActive: number
): TimelineFrame[] {
  const frames: TimelineFrame[] = [];

  const prefixFrames = result.prefixFrames;

  // Filler
  const fillerStartup = result.fillerStartup || 0;
  const fillerActive = result.fillerActive || 0;
  // Use the pre-calculated total frames which (correctly) includes raw.total overrides
  // If we just summed startup+active+recovery here, we might miss the raw.total override
  const fillerTotal = result.fillerFrames || 0;
  
  // Recalculate recovery for visual consistency (so blocks add up to total)
  // recovery = Total - Startup - Active
  // Note: Startup here is typically full duration for visual blocks? 
  // Wait, getMoveTotalFrames uses (startup-1).
  // So fillerTotal = (Start-1) + Active + Recovery.
  // Visuals: Startup blocks should be (Start-1)? 
  // Let's check logic below: "if (i < fillerActiveStart) type = 'startup'".
  // fillerActiveStart = prefix + fillerStartup.
  // If Start=20. fillerActiveStart = 20. i < 20 (1..19). 19 blocks.
  // Correct.
  // So Recovery = Total - (Startup - 1) - Active.
  // Recovery = 42 - 19 - 4 = 19.
  // fillerEffectiveStartup removed
  // fillerRecovery line removed

  // Calculate Filler Key Frames (Global)
  const fillerActiveStart = prefixFrames + fillerStartup;
  const fillerActiveEnd = fillerActiveStart + fillerActive - 1;
  const fillerEndFrame = prefixFrames + fillerTotal;

  // Throw
  // Start frame relative to start of sequence
  const throwStartFrame = prefixFrames + fillerTotal + 1;
  const throwActiveStart = throwStartFrame + throwStartup - 1;
  const throwActiveEnd = throwActiveStart + throwActive - 1;
  const throwRecoveryTotal = 20;
  const total = throwActiveEnd + throwRecoveryTotal;

  for (let i = 1; i <= total; i++) {
    const globalFrame = i;
    let type: TimelineFrame['type'];

    if (i <= prefixFrames) {
      type = 'prefix';
    } else if (i <= fillerEndFrame) {
      // Filler Logic
      if (i < fillerActiveStart) type = 'startup';
      else if (i <= fillerActiveEnd) type = 'active';
      else type = 'recovery';
    } else {
      // Throw Logic
      if (i < throwActiveStart) type = 'startup';
      else if (i <= throwActiveEnd) type = 'active';
      else type = 'recovery';
    }

    const isWakeup = (globalFrame === oppWakeupFrame);
    // Visualizing "Throwable" alignment
    // Effective Throw Frame: result.firstActive
    // Use throwActiveStart as the reference for "Hit"?
    // The result.firstActive should match throwActiveStart exactly if calculations align.
    const isThrowConnect = (globalFrame === result.firstActive);

    let label: number | undefined;
    if (i === 1) label = i;
    else if (i === prefixFrames && prefixFrames > 0) label = i;
    else if (isThrowConnect) label = i;

    frames.push({
      index: i,
      globalFrame,
      type,
      isWakeup,
      isReversal: false,
      isVulnerable: false,
      isHit: isThrowConnect,
      label
    });
  }

  return frames;
}

function generateThrowDefenderFrames(
  _result: ThrowComboResult,
  oppWakeupFrame: number,
  throwFirstActive: number
): TimelineFrame[] {
  const frames: TimelineFrame[] = [];

  // Render enough to show throw connect + some aftermath
  const total = Math.max(oppWakeupFrame + 20, throwFirstActive + 10);

  for (let i = 1; i <= total; i++) {
    const globalFrame = i;
    let type: TimelineFrame['type'] = 'neutral';

    if (i < oppWakeupFrame) {
      type = 'down';
    } else {
      // Wakeup onwards
      // Usually 1F throw invuln?
      // If 1F invuln, WakeupFrame is Invuln. Wakeup+1 is Throwable.
      // Let's assume Wakeup Frame is "Rising", often invincible to throws or strikes?
      // SF6: 1F Throw Invuln on wakeup.
      // So if Wakeup is Frame 30. Frame 30 is Invuln. Frame 31 is Throwable.
      if (i === oppWakeupFrame) {
        type = 'recovery'; // "Invuln" visual? neutral is fine.
      } else {
        type = 'vulnerable'; // Throwable
      }

      if (i >= throwFirstActive) {
        type = 'hitstun'; // Thrown!
      }
    }

    const isWakeup = (i === oppWakeupFrame);
    const isHit = (i === throwFirstActive);

    let label: number | undefined;
    if (isWakeup || isHit) label = i;

    frames.push({
      index: i,
      globalFrame,
      type,
      isWakeup,
      isReversal: false,
      isVulnerable: false,
      isHit,
      label
    });
  }

  return frames;
}

function isPositive(val: number | string | undefined): boolean {
  if (typeof val !== 'number') return false;
  return val >= 0;
}

function isNegative(val: number | string | undefined): boolean {
  if (typeof val !== 'number') return false;
  return val < 0;
}

function formatFrame(val: number | string | undefined): string {
  if (val === undefined || val === null) return '-';
  if (typeof val === 'number') {
    return val > 0 ? `+${val}` : `${val}`;
  }
  return String(val);
}

function formatTolerance(val: number | undefined): string {
  if (val === undefined || val === null) return '-';
  return `${val}F`;
}
</script>

<template>
  <div class="oki-view container" style="padding-bottom: 100px;">
    <h1 class="page-title">压起身计算器</h1>
    <p class="page-desc">组合链计算: 前冲 + 前冲 + 招式A + ...</p>

    <!-- Character Stats -->
    <div v-if="stats" class="stats-bar">
      <span class="stat-item">
        <span class="stat-label">前冲</span>
        <span class="stat-value">{{ stats.forwardDash }}F</span>
      </span>
      <span class="stat-item">
        <span class="stat-label">后冲</span>
        <span class="stat-value">{{ stats.backDash }}F</span>
      </span>
    </div>

    <!-- Step 1: Character -->
    <section class="oki-section">
      <h2 class="section-title">
        <span class="step-number">1</span>
        选择角色
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1">攻击方 (Attacker)</label>
          <select v-model="attackerCharId" class="character-select">
            <option value="">-- 选择角色 --</option>
            <option v-for="char in SF6_CHARACTERS" :key="char.id" :value="char.id">
              {{ char.name }} {{ char.nameJp ? `(${char.nameJp})` : '' }}
            </option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">防守方 (Defender)</label>
          <select v-model="defenderCharId" class="character-select">
            <option value="">-- 选择角色 --</option>
            <option v-for="char in SF6_CHARACTERS" :key="char.id" :value="char.id">
              {{ char.name }} {{ char.nameJp ? `(${char.nameJp})` : '' }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <div v-if="loading" class="loading-state">
      <p>加载中...</p>
    </div>

    <!-- Step 2: Knockdown -->
    <section v-else-if="attackerFrameData" class="oki-section">
      <h2 class="section-title">
        <span class="step-number">2</span>
        击倒数据
      </h2>

      <!-- Custom Moves Section -->
      <div class="custom-moves-section">
        <div class="custom-form">
            <h3 class="subsection-title">自定义招式</h3>
            <div class="form-row">
                <input type="text" v-model="newCustomMove.name" placeholder="名称 (e.g. 2MP)" class="input-sm" />
                <input type="text" v-model="newCustomMove.input" placeholder="指令 (e.g. 236P)" class="input-sm" />
                <div class="frames-input-group">
                    <input type="number" v-model.number="newCustomMove.frames" class="input-sm frame-input" />
                    <span class="unit">F</span>
                </div>
                <button class="btn-save" @click="saveCustomMove" :disabled="!newCustomMove.name || !newCustomMove.frames">保存</button>
            </div>
        </div>
        
        <div v-if="filteredCustomMoves.length > 0" class="custom-list">
             <div class="list-label">已保存:</div>
             <div class="saved-moves-grid">
                <div v-for="move in filteredCustomMoves" :key="move.id" 
                    :class="['knockdown-card', { active: isSelectedKnockdown(move) }]"
                    @click="selectCustomMove(move)"
                >
                    <span class="move-name">{{ getMoveDisplayName(move) }}</span>
                    <span class="move-input">{{ move.input }}</span>
                    <span class="move-advantage">+{{ move.frames }}F</span>
                    <button class="btn-delete" @click.stop="removeCustomMove(move.id)">×</button>
                </div>
             </div>
        </div>
      </div>

      <div class="section-divider">
        <span>预设数据 (Presets)</span>
      </div>

      <div class="custom-knockdown-row">
        <button :class="['custom-kd-btn', { active: useCustomKnockdown }]" @click="enableCustomKnockdown">
          快速自定义 (数字)
        </button>
        <div v-if="useCustomKnockdown" class="custom-kd-input">
          <span>击倒帧:</span>
          <input type="number" v-model.number="customKnockdownAdv" min="1" max="100" />
          <span>F</span>
        </div>
      </div>

      <div class="knockdown-grid">
        <button v-for="move in knockdownMoves" :key="`${move.name}-${move.input}`"
          :class="['knockdown-card', { active: isSelectedKnockdown(move) }]"
          @click="selectKnockdownMove(move)">
          <span class="move-name">{{ getMoveDisplayName(move) }}</span>
          <span class="move-input">{{ move.input }}</span>
          <span class="move-advantage" v-if="move.knockdown">+{{ parseKnockdownAdvantage(move) }}F</span>
        </button>
      </div>
    </section>

    <!-- Step 3: Combo Builder -->
    <section v-if="effectiveKnockdownAdv > 0 && attackerFrameData" class="oki-section results-section">
      <h2 class="section-title">
        <span class="step-number">3</span>
        组合链计算
      </h2>

      <!-- Opponent Info & Settings -->
      <div class="opponent-info" style="display:block">
        <div class="mb-2">
          <strong>对手反击判定第一帧 (Reversal Active):</strong>
          {{ effectiveKnockdownAdv }} (击倒) + {{ opponentReversalStartup }} (发生) =
          <strong class="frame-negative">{{ opponentFirstActiveFrame }}F</strong>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <!-- Manual / Auto Abare -->
          <div>
            <label class="block text-sm font-medium mb-1">
              对手抢招发生帧 (Startup) <span class="text-xs font-normal ml-1" style="color: var(--color-warning)">⚠
                计算相杀需要选择招式</span>
            </label>
            <div class="flex space-x-2">
              <input type="number" v-model.number="opponentReversalStartup" min="1" max="30" class="small-input p-1"
                style="width: 60px" />
              <div class="flex-1">
                <div class="move-search" style="min-width: 0">
                  <input type="text" v-model="defenderMoveSearchQuery" @focus="showDefenderDropdown = true"
                    @blur="handleDefenderBlur" @input="selectedDefenderMove = null" placeholder="选择或搜索对手招式..."
                    class="move-search-input p-1 text-xs" :disabled="!defenderFrameData" />
                  <div v-if="showDefenderDropdown && filteredDefenderMoves.length > 0" class="move-dropdown">
                    <button v-for="move in filteredDefenderMoves" :key="`${move.name}-${move.input}`" class="move-option text-xs"
                      @click="selectDefenderMove(move)">
                      <span class="truncate mr-2">{{ getMoveDisplayName(move) }}</span>
                      <span class="move-input text-xs">{{ move.input }}</span>
                      <span class="whitespace-nowrap text-gray-400">{{ move.startup }}F</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <p v-if="!defenderFrameData" class="text-xs text-gray-400 mt-1">请选择防守方角色以启用招式选择</p>
          </div>

          <div>
            <div class="mb-1">
              <strong>可命中窗口:</strong>
              <span v-if="opponentPreActiveWindowValid" class="opponent-window">
                {{ opponentWakeupFrame }}~{{ opponentPreActiveEnd }}F
              </span>
              <span v-else class="opponent-window">无</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Combo Chain Builder -->
      <div class="combo-builder">
        <div class="combo-builder-title">前置动作</div>
        <div class="combo-chain">
          <div v-for="(action, idx) in comboChain" :key="idx" class="chain-item">
            <span class="chain-name">{{ action.type === 'move' && action.move ? getMoveDisplayName(action.move) : action.name }}</span>
            <span class="chain-frames">{{ action.frames }}F</span>
            <button class="chain-remove" @click="removeAction(idx)">×</button>
            <span v-if="idx < comboChain.length - 1" class="chain-plus">+</span>
          </div>
          <span v-if="comboChain.length === 0" class="chain-empty">点击下方添加前置动作</span>
        </div>

        <div class="combo-actions">
          <button class="action-btn dash-btn" @click="addDash">
            + 前冲 ({{ stats?.forwardDash }}F)
          </button>
          <div class="move-search">
            <input type="text" v-model="moveSearchQuery" placeholder="搜索招式..." class="move-search-input" />
            <div v-if="moveSearchQuery" class="move-dropdown">
              <button v-for="move in filteredMoves" :key="`${move.name}-${move.input}`" class="move-option" @click="addMove(move)">
                <span>{{ getMoveDisplayName(move) }}</span>
                <span class="move-input">{{ move.input }}</span>
                <span>{{ move.startup }}F</span>
              </button>
            </div>
          </div>
          <button v-if="comboChain.length > 0" class="action-btn clear-btn" @click="clearCombo">
            清空
          </button>
        </div>
      </div>

      <!-- Combo Result -->
      <div v-if="comboResult" class="combo-result" :class="{ success: comboResult.coversOpponent }">
        <div class="result-row">
          <span class="result-label">打击帧范围:</span>
          <span class="result-value">{{ comboResult.ourStart }}~{{ comboResult.ourEnd }}F</span>
        </div>
        <div class="result-row">
          <span class="result-label">对手反击判定第一帧:</span>
          <span class="result-value enemy">{{ opponentFirstActiveFrame }}F</span>
        </div>
        <div class="result-row">
          <span class="result-label">可命中窗口:</span>
          <span class="result-value" v-if="opponentPreActiveWindowValid">
            {{ opponentWakeupFrame }}~{{ opponentPreActiveEnd }}F
          </span>
          <span class="result-value" v-else>无</span>
        </div>
        <div class="result-row">
          <span class="result-status" :class="{ success: comboResult.coversOpponent }">
            {{ comboResult.status }}
          </span>
        </div>
      </div>

      <!-- Auto Results -->
      <div class="results-header-row">
        <h3 class="results-title">
          自动匹配 (共 {{ allOkiResults.length }} 个结果，显示前 {{ okiResults.length }} 条)
          <div class="header-tip-icon">?</div>
        </h3>
        
        <div class="results-controls">
          <div class="filter-group">
             <input 
              type="text" 
              v-model="autoMatchSearchQuery" 
              placeholder="搜索招式..." 
              class="auto-match-search-input" 
            />
            <button v-if="comboChain.length > 0" 
              :class="['filter-toggle-btn', { active: useChainAsPrefix }]"
              @click="useChainAsPrefix = !useChainAsPrefix"
              :title="useChainAsPrefix ? '点击取消前置过滤' : '点击使用当前组合作为前置过滤'">
              <span class="icon">{{ useChainAsPrefix ? '★' : '☆' }}</span>
              {{ useChainAsPrefix ? '以前置过滤: ' + comboChainPrefixName : '使用当前组合为前置' }}
            </button>
          </div>
        </div>
      </div>
      <div class="auto-match-notes">
        <span class="note-item">排序规则：优先显示被防有利 (On Block) 的压制，其次为发生更快（发生F 更小）。</span>
        <span class="note-item">容错：当前招式“最晚可以延迟几帧”仍能压制（0 表示必须精准卡帧）。</span>
        <span class="note-item">仅显示前 50 条最优解。</span>
      </div>
      <!-- Removed separate text info as it's now in the button state -->

      <div v-if="okiResults.length > 0" class="results-table">
        <div class="result-header">
          <span>组合</span>
          <span class="sortable-header" @click="toggleSort('startup')">
            发生
            <span v-if="sortKey === 'startup'" class="sort-indicator">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
          <span>打击帧</span>
          <span class="sortable-header" @click="toggleSort('tolerance')">
            容错
            <span v-if="sortKey === 'tolerance'" class="sort-indicator">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
          <span class="sortable-header" @click="toggleSort('block')">
            被防
            <span v-if="sortKey === 'block'" class="sort-indicator">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
          <span class="sortable-header" @click="toggleSort('hit')">
            被击
            <span v-if="sortKey === 'hit'" class="sort-indicator">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
          <span class="sortable-header" @click="toggleSort('trade')">
            相杀
            <span v-if="sortKey === 'trade'" class="sort-indicator">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
        </div>
        <div v-for="result in okiResults" :key="result.key" :class="['result-row-auto', {
          expanded: selectedResultKey === result.key,
          success: result.coversOpponent,
          trade: result.isTrade
        }]" @click="toggleResultDetail(result.key)">
          <div class="result-combo">
            <span v-if="result.coversOpponent" class="success-badge">压制</span>
            <span v-if="result.isTrade" class="trade-badge">相杀</span>
            <span v-if="result.tags && result.tags.length > 0" class="tag-badge">{{ result.tags.join(', ') }}</span>
            <span v-if="result.prefix" class="combo-prefix">{{ result.prefix }}</span>
            <span v-if="result.prefix">+</span>
            <span>{{ getMoveDisplayName(result.move) }}</span>
            <span class="move-input">{{ result.move.input }}</span>
          </div>
          <span>{{ result.prefixFrames + parseInt(result.move.startup) }}F</span>
          <span>{{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F</span>
          <span>{{ formatTolerance(result.toleranceFrames) }}</span>
          <span
            :class="{ 'frame-positive': isPositive(result.calculatedOnBlock), 'frame-negative': isNegative(result.calculatedOnBlock) }">{{
              formatFrame(result.calculatedOnBlock) }}</span>
          <span
            :class="{ 'frame-positive': isPositive(result.calculatedOnHit), 'frame-negative': isNegative(result.calculatedOnHit) }">{{
              formatFrame(result.calculatedOnHit) }}</span>
          <span
            :class="{ 'frame-positive': isPositive(result.tradeAdvantage), 'frame-negative': isNegative(result.tradeAdvantage) }">{{
              result.tradeDetail || '-' }}</span>

          <!-- Expandable Detail -->
          <div v-if="selectedResultKey === result.key" class="result-detail" @click.stop>
            <div class="detail-title">帧数详情</div>
            <div class="detail-row">
              <span class="detail-label">前置动作:</span>
              <span>
                {{ result.prefix || '无' }}
                <span v-if="result.prefixInput"> ({{ result.prefixInput }})</span>
                = {{ result.prefixFrames }}F
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">招式发生:</span>
              <span>{{ getMoveDisplayName(result.move) }} ({{ result.move.input }}) = {{ result.move.startup }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">招式持续:</span>
              <span>{{ result.move.active }} (共{{ result.activeHitTotal ?? parseTotalActiveFrames(result.move.active) }}帧)</span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">计算:</span>
              <span>
                {{ result.prefixFrames }} + {{ result.move.startup }}
                <span v-if="result.activeDisplayStartOffset && result.activeDisplayStartOffset > 0">
                  + {{ result.activeDisplayStartOffset }}
                </span>
                = {{ result.ourActiveStart }}F
              </span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">
                {{ result.activeHasGap ? '最后段打击范围:' : '打击范围:' }}
              </span>
              <span class="frame-positive">{{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">对手反击判定第一帧:</span>
              <span class="frame-negative">{{ opponentFirstActiveFrame }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">可命中窗口:</span>
              <span v-if="opponentPreActiveWindowValid">{{ opponentWakeupFrame }}~{{ opponentPreActiveEnd }}F</span>
              <span v-else>无</span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">被防计算:</span>
              <span>
                {{ result.move.onBlock }} (原始)
                <span v-if="result.meatyBonus && result.meatyBonus > 0" class="meaty-bonus-highlight">
                  + {{ result.meatyBonus }} (Meaty: {{ result.effectiveHitFrame }}F击中 - {{ result.meatyStartFrame ?? result.ourActiveStart }}F发生)
                </span>
                = <span
                  :class="{ 'frame-positive': isPositive(result.calculatedOnBlock), 'frame-negative': isNegative(result.calculatedOnBlock) }">{{
                    formatFrame(result.calculatedOnBlock) }}</span>
              </span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">被击计算:</span>
              <span>
                {{ result.move.onHit }} (原始)
                <span v-if="result.meatyBonus && result.meatyBonus > 0" class="meaty-bonus-highlight">
                  + {{ result.meatyBonus }} (Meaty)
                </span>
                <span v-if="result.coversOpponent" class="meaty-bonus-highlight">
                  + 2 (打康)
                </span>
                = <span
                  :class="{ 'frame-positive': isPositive(result.calculatedOnHit), 'frame-negative': isNegative(result.calculatedOnHit) }">{{
                    formatFrame(result.calculatedOnHit) }}</span>
              </span>
            </div>
            <div class="detail-row" v-if="result.isTrade">
              <span class="detail-label">相杀有利 (Trade):</span>
              <span>{{ result.tradeDetail }}</span>
            </div>
            <div class="detail-row calc" style="width: 100%" v-if="result.isTrade && result.tradeExplanation">
              <span class="detail-label">相杀计算:</span>
              <span>{{ result.tradeExplanation }}</span>
            </div>
            <div class="detail-row result">
              <span class="detail-label">判定:</span>
              <span v-if="result.coversOpponent" class="success">
                ✓ 压制成功: {{ result.activeHasGap ? '最后段 ' : '' }}{{ result.ourActiveStart }}~{{ result.ourActiveEnd }} 与 {{ opponentWakeupFrame }}~{{
                  opponentPreActiveEnd }} 有重叠
              </span>
              <span v-else-if="result.isTrade" class="trade">
                ⚠ 相杀: 与对手判定第一帧重合 ({{ opponentFirstActiveFrame }}F)
              </span>
            </div>

            <!-- Timeline UI (Multi-Row View) -->
            <div class="timeline-wrapper">
              <div class="timeline-header">
                <div class="legend-row">
                  <span class="timeline-legend-item"><span class="legend-color prefix"></span>前置</span>
                  <span class="timeline-legend-item"><span class="legend-color startup"></span>发生</span>
                  <span class="timeline-legend-item"><span class="legend-color active"></span>持续</span>
                  <span class="timeline-legend-item"><span class="legend-color recovery"></span>硬直</span>
                </div>
                <div class="legend-row">
                  <span class="timeline-legend-item"><span class="legend-color down"></span>倒地</span>
                  <span class="timeline-legend-item"><span class="legend-color vulnerable"></span>可被击</span>
                  <span class="timeline-legend-item"><span class="legend-color hitstun"></span>被击硬直</span>
                  <span class="timeline-legend-item"><span class="legend-color blockstun"></span>被防硬直</span>
                </div>
              </div>

              <div class="timeline-scroll-container">
                <!-- Row 1: Attacker -->
                <div class="timeline-row-label">进攻方 (Self)</div>
                <div class="timeline-blocks-container">
                  <div v-for="frame in generateTimelineFrames(result, opponentWakeupFrame, opponentFirstActiveFrame)"
                    :key="frame.index" :class="['frame-block', frame.type, {
                      'is-hit': frame.isHit,
                      'is-vulnerable': frame.isVulnerable
                    }]">
                    <div class="frame-content">
                      <!-- Markers overlaid (Only Wakeup/Reversal reference on attacker row?) -->
                      <!-- Maybe keep clean, put markers on Defender row -->
                      <div v-if="frame.isWakeup" class="frame-marker wakeup ghost">▼</div>
                    </div>
                    <div class="frame-number" v-if="frame.label">{{ frame.label }}</div>
                  </div>
                </div>

                <!-- Row 2: Defender (Hit) -->
                <div class="timeline-row-label mt-4">对手 - 被击 (Hit)</div>
                <div class="timeline-blocks-container">
                  <div v-for="frame in generateDefenderFrames(result, opponentWakeupFrame, 'hit')"
                    :key="frame.globalFrame" :class="['frame-block', frame.type]">
                    <div class="frame-content">
                      <div v-if="frame.isWakeup" class="frame-marker wakeup">▼</div>
                      <div v-if="frame.isHit" class="frame-marker hit-marker">💥</div>
                    </div>
                    <!-- Only show distinct frame numbers if needed -->
                  </div>
                </div>

                <!-- Row 3: Defender (Block) -->
                <div class="timeline-row-label mt-2">对手 - 被防 (Block)</div>
                <div class="timeline-blocks-container">
                  <div v-for="frame in generateDefenderFrames(result, opponentWakeupFrame, 'block')"
                    :key="frame.globalFrame" :class="['frame-block', frame.type]">
                    <div class="frame-content">
                      <div v-if="frame.isWakeup" class="frame-marker wakeup">▼</div>
                      <div v-if="frame.isHit" class="frame-marker block-marker">🛡️</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>没有自动匹配的压制组合</p>
      </div>
    </section>

    <!-- Step 4: Loop Throw Calculator -->
    <section v-if="effectiveKnockdownAdv > 0" class="oki-section throw-section">
      <h2 class="section-title">
        <span class="step-number">4</span>
        循环投计算器
      </h2>
      <p class="section-desc">
        目标：让投的<strong>第一帧判定</strong>压在对手起身后、刚能被投的那一帧。
      </p>

      <div class="throw-summary">
        <div class="summary-item">
          <span class="summary-label">击倒优势 N</span>
          <span class="summary-value">{{ effectiveKnockdownAdv }}F</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">起身投无敌 I</span>
          <input type="number" v-model.number="wakeupThrowInvul" min="0" max="10" class="small-input" />
          <span class="summary-unit">F</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">投起手 T</span>
          <input type="number" v-model.number="throwStartup" min="1" max="20" class="small-input" />
          <span class="summary-unit">F</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">投判定 A</span>
          <input type="number" v-model.number="throwActive" min="1" max="6" class="small-input" />
          <span class="summary-unit">F</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">防守抢招</span>
          <input type="number" v-model.number="opponentAbareStartup" min="0" max="20" class="small-input" />
          <span class="summary-unit">F</span>
        </div>
      </div>

      <div class="throw-math">
        <div class="math-row">
          <span class="math-label">最早可被投帧:</span>
          <span class="math-value">{{ effectiveKnockdownAdv }} + {{ normalizedThrowInvul }} + 1 = {{
            earliestThrowableFrame }}F</span>
        </div>
        <div class="math-row" v-if="normalizedAbare > 0">
          <span class="math-label">最晚可被投帧:</span>
          <span class="math-value">{{ effectiveKnockdownAdv }} + {{ normalizedAbare }} - 1 = {{ latestThrowableFrame
            }}F</span>
        </div>
        <div class="math-row">
          <span class="math-label">理想按投延迟:</span>
          <span class="math-value">
            {{ throwDelayMin }}F ~ {{ throwDelayMax }}F
            <span v-if="throwDelayMax - (earliestThrowableFrame - normalizedThrowStartup) > 0" class="window-bonus">
              (放宽了 {{ throwDelayMax - (earliestThrowableFrame - normalizedThrowStartup) }}F)
            </span>
          </span>
        </div>
        <div class="math-row">
          <span class="math-label">第一帧判定允许范围:</span>
          <span class="math-value">
            {{ throwFirstActiveMin }}F ~ {{ throwFirstActiveMax }}F
            <span v-if="throwFirstActiveMax > earliestThrowableFrame" class="window-bonus">
              (放宽了 {{ throwFirstActiveMax - earliestThrowableFrame }}F)
            </span>
          </span>
        </div>
      </div>

      <div v-if="throwDelayMax < 0" class="throw-warning">
        当前击倒优势不足，无法在起身可投前完成投起手（需要负延迟）。
      </div>

      <div class="results-header-row throw-results-header">
        <h3 class="results-title">循环投组合 (共 {{ allThrowResults.length }} 个结果，显示前 {{ throwResults.length }} 条)</h3>
      </div>
      <div class="throw-mixup-tip">
        <span class="tip-icon">💡</span>
        <span>
          <strong>核心博弈</strong>：此处的“投”可以替换为 <strong>2LK (下轻脚)</strong>、<strong>5LP (站轻拳)</strong> 或者 <strong>垂直/前跳</strong>。
          <br>
          利用相同的延迟帧数，从“投”变为“打”或“跳”，触发街霸6核心猜拳机制 —— <strong>打投二择 (Strike/Throw Mixup)</strong>。
        </span>
      </div>
      <p v-if="useChainAsPrefix && comboChain.length > 0" class="prefix-info">
        前置: <strong>{{ comboChainPrefixName }} ({{ comboChainThrowPrefixFrames }}F)</strong> + 空挥 + 投
      </p>

      <div v-if="throwResults.length > 0" class="results-table">
        <div class="result-header throw-header">
          <span>组合</span>
          <span class="sortable-header" @click="toggleThrowSort('delay')">
            延迟S
            <span v-if="throwSortKey === 'delay'" class="sort-indicator">{{ throwSortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
          <span class="sortable-header" @click="toggleThrowSort('firstActive')">
            第一帧判定
            <span v-if="throwSortKey === 'firstActive'" class="sort-indicator">{{ throwSortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
          <span class="sortable-header" @click="toggleThrowSort('tolerance')">
            容错
            <span v-if="throwSortKey === 'tolerance'" class="sort-indicator">{{ throwSortOrder === 'desc' ? '↓' : '↑' }}</span>
          </span>
        </div>
        <div v-for="result in throwResults" :key="result.key"
          :class="['result-row-auto', 'throw-row', { expanded: selectedThrowResultKey === result.key }]"
          @click="toggleThrowResultDetail(result.key)">
          <div class="result-combo">
            <span v-if="result.prefix" class="combo-prefix">{{ result.prefix }}</span>
            <span v-if="result.prefix">+</span>
            <span v-if="result.fillerName !== '直接投'">{{ result.fillerName }}</span>
            <span v-if="result.filler && result.fillerName !== '直接投'" class="move-input">({{ result.filler.input }})</span>
            <span v-if="result.fillerName !== '直接投'">+</span>
            <span>投</span>
          </div>
          <span>{{ result.delay }}F</span>
          <span>{{ result.firstActive }}F</span>
          <span>{{ formatTolerance(result.toleranceFrames) }}</span>

          <div v-if="selectedThrowResultKey === result.key" class="result-detail" @click.stop>
            <div class="detail-title">帧数详情</div>
            <div class="detail-row">
              <span class="detail-label">前置动作:</span>
              <span>{{ result.prefix || '无' }} = {{ result.prefixFrames }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">空挥招式:</span>
              <span v-if="result.filler">
                {{ result.fillerName }}<span v-if="result.filler.input">({{ result.filler.input }})</span> = 
                <span v-if="result.filler.raw?.total">
                    {{ result.fillerFrames }}F (原始数据)
                </span>
                <span v-else>
                    {{ result.fillerStartup }} + {{ result.fillerActive }} + {{ result.fillerRecovery }} = {{ result.fillerFrames }}F
                </span>
              </span>
              <span v-else>无 = 0F</span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">延迟 S:</span>
              <span>{{ result.prefixFrames }} + {{ result.fillerFrames }} = {{ result.delay }}F</span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">第一帧:</span>
              <span>{{ result.delay }} + {{ normalizedThrowStartup }} = {{ result.firstActive }}F</span>
            </div>

            <!-- Loop Throw Timeline -->
            <div class="timeline-wrapper">
              <div class="timeline-header">
                <div class="legend-row">
                  <span class="timeline-legend-item"><span class="legend-color prefix"></span>前置</span>
                  <span class="timeline-legend-item"><span class="legend-color startup"></span>发生</span>
                  <span class="timeline-legend-item"><span class="legend-color active"></span>持续</span>
                  <span class="timeline-legend-item"><span class="legend-color recovery"></span>硬直/空挥</span>
                  <span class="timeline-legend-item"><span class="legend-color hitstun"></span>被投</span>
                </div>
                <div class="legend-row">
                  <span class="timeline-legend-item"><span class="legend-color down"></span>倒地</span>
                  <span class="timeline-legend-item"><span class="legend-icon opponent-wakeup">▼</span>起身</span>
                  <span class="timeline-legend-item"><span class="legend-icon">⚠️</span>投命中</span>
                </div>
              </div>

              <div class="timeline-scroll-container">
                <!-- Row 1: Attacker -->
                <div class="timeline-row-label">进攻方 (Self)</div>
                <div class="timeline-blocks-container">
                  <div
                    v-for="frame in generateThrowTimelineFrames(result, opponentWakeupFrame, normalizedThrowStartup, normalizedThrowActive)"
                    :key="frame.index" :class="['frame-block', frame.type, {
                      'is-hit': frame.isHit
                    }]">
                    <div class="frame-content">
                      <div v-if="frame.isWakeup" class="frame-marker wakeup ghost">▼</div>
                    </div>
                    <div class="frame-number" v-if="frame.label">{{ frame.label }}</div>
                  </div>
                </div>

                <!-- Row 2: Defender -->
                <div class="timeline-row-label mt-4">对手 (Defender)</div>
                <div class="timeline-blocks-container">
                  <div v-for="frame in generateThrowDefenderFrames(result, opponentWakeupFrame, result.firstActive)"
                    :key="frame.globalFrame" :class="['frame-block', frame.type]">
                    <div class="frame-content">
                      <div v-if="frame.isWakeup" class="frame-marker wakeup">▼</div>
                      <div v-if="frame.isHit" class="frame-marker hit-marker">⚠️</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="detail-row">
              <span class="detail-label">允许窗口:</span>
              <span>{{ throwDelayMin }}F ~ {{ throwDelayMax }}F</span>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="throwDelayMax >= 0" class="empty-state">
        <p>没有自动匹配的循环投组合</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-title {
  font-size: var(--font-size-3xl);
  background: var(--gradient-fire);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.page-desc {
  color: var(--color-text-muted);
  margin-bottom: var(--space-lg);
}

.stats-bar {
  display: flex;
  gap: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-lg);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.stat-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.stat-value {
  font-weight: 600;
  color: var(--color-accent);
  font-family: var(--font-mono);
}

.oki-section {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
}

.section-title {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  font-size: var(--font-size-lg);
}

.step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--gradient-fire);
  border-radius: 50%;
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: white;
}

.character-select {
  width: 100%;
  max-width: 300px;
  padding: var(--space-sm) var(--space-md);
}

/* Knockdown */
.custom-knockdown-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--color-border-light);
}

.custom-kd-btn {
  padding: var(--space-sm) var(--space-md);
  background: var(--color-bg-tertiary);
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: 600;
}

.custom-kd-btn:hover,
.custom-kd-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.custom-kd-input {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.custom-kd-input input,
.small-input {
  width: 60px;
  padding: var(--space-xs);
  text-align: center;
  font-family: var(--font-mono);
}

.knockdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--space-sm);
  /* max-height: 160px; REMOVED to show all moves */
  /* overflow-y: auto; REMOVED */
}

.knockdown-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  position: relative; /* For absolute delete button */
  min-height: 60px; /* Ensure uniform height */
  justify-content: center;
}

.knockdown-card:hover {
  border-color: var(--color-accent);
}

.knockdown-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-light);
}

.knockdown-card .move-name {
  font-weight: 600;
  font-size: var(--font-size-sm);
}

.knockdown-card .move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.knockdown-card .move-advantage {
  color: var(--color-positive);
  font-weight: 600;
}

/* Opponent Info */
.opponent-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-bottom: var(--space-md);
  padding: var(--space-sm);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
}

.opponent-window {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

/* Combo Builder */
.combo-builder {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
}

.combo-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-height: 40px;
  padding: var(--space-sm);
  background: var(--color-bg-card);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-md);
}

.chain-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: rgba(0, 212, 255, 0.15);
  border-radius: var(--radius-sm);
}

.chain-name {
  font-weight: 600;
}

.chain-frames {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.chain-remove {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0 4px;
}

.chain-remove:hover {
  color: var(--color-negative);
}

.chain-plus {
  color: var(--color-text-muted);
  font-weight: 600;
  margin: 0 var(--space-xs);
}

.chain-empty {
  color: var(--color-text-muted);
}

.combo-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.combo-builder-title {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-xs);
}

.action-btn {
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: 600;
}

.dash-btn {
  background: rgba(0, 212, 255, 0.2);
  border: 1px solid #00d4ff;
  color: #00d4ff;
}

.clear-btn {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.move-search {
  position: relative;
  flex: 1;
  min-width: 200px;
}

.move-search-input {
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
}

.move-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  z-index: 10;
}

.move-option {
  display: flex;
  width: 100%;
  justify-content: space-between;
  padding: var(--space-sm);
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-border-light);
  cursor: pointer;
  text-align: left;
  color: var(--color-text-muted);
}

.move-option:hover {
  background: var(--color-bg-tertiary);
}

.move-option:last-child {
  border-bottom: none;
}

/* Combo Result */
.combo-result {
  padding: var(--space-md);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
  border: 2px solid var(--color-border);
}

.combo-result.success {
  border-color: var(--color-positive);
  background: rgba(63, 185, 80, 0.1);
}

.combo-result .result-row {
  display: flex;
  gap: var(--space-md);
  margin-bottom: var(--space-xs);
}

.result-label {
  color: var(--color-text-muted);
}

.result-value {
  font-family: var(--font-mono);
  font-weight: 600;
}

.result-value.enemy {
  color: var(--color-negative);
}

.result-status {
  font-weight: 700;
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
}

.result-status.success {
  background: var(--color-positive);
  color: white;
}

/* Auto Results */
.results-section {
  border-color: var(--color-accent);
}

.section-desc {
  color: var(--color-text-muted);
  margin-bottom: var(--space-md);
}

.results-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: var(--space-lg) 0 var(--space-md);
}

.results-title {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  margin: 0;
  display: flex;
  align-items: center;
}

.header-tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 12px;
  margin-left: var(--space-sm);
  cursor: help;
  vertical-align: middle;
  flex-shrink: 0;
}

.header-tip-icon:hover {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.auto-match-notes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-md);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin: 0 0 var(--space-sm);
}

.auto-match-notes .note-item {
  padding: var(--space-xxs) var(--space-sm);
  background: rgba(0, 212, 255, 0.08);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
}

.prefix-btn {
  padding: var(--space-xs) var(--space-md);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
  color: var(--color-text-muted);
}

.prefix-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.prefix-btn.active {
  background: rgba(0, 212, 255, 0.15);
  border-color: #00d4ff;
  color: #00d4ff;
}

.prefix-info {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin: 0 0 var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  background: rgba(0, 212, 255, 0.1);
  border-radius: var(--radius-sm);
}

.results-table {
  overflow-x: auto;
}

.result-header,
.result-row-auto {
  display: grid;
  grid-template-columns: 2.5fr 1fr 1.2fr 0.7fr 0.8fr 0.8fr 1fr;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
  align-items: center;
  font-size: var(--font-size-sm);
}

.result-header {
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.result-row-auto {
  border-bottom: 1px solid var(--color-border-light);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.result-row-auto:hover {
  background: rgba(63, 185, 80, 0.1);
}

.result-row-auto.success {
  background: rgba(63, 185, 80, 0.08);
}

.result-row-auto.trade {
  background: rgba(210, 153, 34, 0.1);
}

.result-header.throw-header,
.result-row-auto.throw-row {
  grid-template-columns: 2.5fr 1fr 1fr 0.8fr;
}

.result-row-auto.expanded {
  background: rgba(63, 185, 80, 0.15);
  grid-template-columns: 1fr;
}

.result-row-auto.trade.expanded {
  background: rgba(210, 153, 34, 0.2);
}

.throw-results-header {
  margin-top: var(--space-lg);
}

.throw-row:hover {
  background: rgba(0, 212, 255, 0.08);
}

.throw-row.expanded {
  background: rgba(0, 212, 255, 0.12);
}

.trade-badge {
  background: rgba(210, 153, 34, 0.3);
  color: #d29922;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.success-badge {
  background: rgba(63, 185, 80, 0.3);
  color: var(--color-positive);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.tag-badge {
  background: rgba(147, 51, 234, 0.3);
  color: #d8b4fe;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

/* Result Detail Panel */
.result-detail {
  grid-column: 1 / -1;
  margin-top: var(--space-sm);
  padding: var(--space-md);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.detail-title {
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--color-border-light);
}

.detail-row {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-xs) 0;
  font-size: var(--font-size-sm);
}

.detail-row.calc {
  background: var(--color-bg-tertiary);
  padding: var(--space-xs) var(--space-sm);
  margin: var(--space-xs) 0;
  border-radius: var(--radius-sm);
}

.detail-row.result {
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--color-border-light);
}

.detail-label {
  color: var(--color-text-muted);
  min-width: 80px;
}

.detail-row .success {
  color: var(--color-positive);
  font-weight: 600;
}

.detail-row .trade {
  color: #d29922;
  font-weight: 600;
}

.detail-row .frame-positive {
  color: var(--color-positive);
  font-weight: 600;
}

.detail-row .frame-negative {
  color: var(--color-negative);
  font-weight: 600;
}

.result-combo {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
  flex-wrap: wrap;
}

.combo-prefix {
  background: rgba(0, 212, 255, 0.2);
  color: #00d4ff;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.loading-state,
.empty-state {
  text-align: center;
  padding: var(--space-xl);
  color: var(--color-text-muted);
}

/* Loop Throw */
.throw-section {
  border-color: var(--color-border);
}

.throw-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-md);
  padding: var(--space-md);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
}

.summary-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.summary-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.summary-value {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--color-accent);
}

.summary-unit {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.throw-math {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}

.math-row {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-xs) 0;
  font-size: var(--font-size-sm);
}

.math-label {
  min-width: 140px;
  color: var(--color-text-muted);
}

.math-value {
  font-family: var(--font-mono);
  font-weight: 600;
}

.window-bonus {
  color: #4caf50;
  font-size: 0.9em;
  margin-left: 8px;
  font-weight: normal;
}

.throw-warning {
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: rgba(214, 51, 132, 0.1);
  color: var(--color-negative);
  font-weight: 600;
}

@media (max-width: 640px) {
  .combo-actions {
    flex-direction: column;
  }

  .move-search {
    min-width: 100%;
  }
}

.meaty-bonus-highlight {
  color: #4ade80;
  font-weight: bold;
  margin: 0 4px;
}

/* Timeline UI Redesign */
.timeline-wrapper {
  margin-top: var(--space-md);
  padding: var(--space-md);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.timeline-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: var(--space-md);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.legend-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.timeline-row-label {
  font-size: 11px;
  font-weight: bold;
  color: var(--color-text-secondary);
  margin-bottom: 2px;
}

.mt-4 {
  margin-top: 16px;
}

.mt-2 {
  margin-top: 8px;
}

.timeline-scroll-container {
  overflow-x: auto;
  padding-bottom: 20px;
  /* Space for numbers */
}

.timeline-blocks-container {
  display: flex;
  align-items: flex-start;
  min-width: max-content;
  /* padding-top: 10px; */
  /* Removed to keep rows tight */
}

.frame-block {
  position: relative;
  width: 14px;
  height: 24px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  margin-right: 1px;
  flex-shrink: 0;
  /* Default background for safety */
  background: #333;
}

/* Colors */
.frame-block.prefix {
  background-color: #374151;
  /* Dark Gray */
  border-color: #4b5563;
}

.frame-block.startup {
  background-color: #9ca3af;
  /* Light Gray */
  border-color: #d1d5db;
  color: #000;
  /* Contrast if needed */
}

.frame-block.active {
  background-color: #dc2626;
  /* Red */
  border-color: #ef4444;
}

.frame-block.recovery {
  background-color: #2563eb;
  /* Blue */
  border-color: #3b82f6;
}

/* Defender States */
.frame-block.down {
  background-color: #000;
  border-color: #374151;
}

.frame-block.vulnerable {
  background-color: rgba(74, 222, 128, 0.2);
  border-color: var(--color-positive);
}

.frame-block.hitstun {
  background-color: #ca8a04;
  /* Yellow/Gold */
  border-color: #eab308;
}

.frame-block.blockstun {
  background-color: #9333ea;
  /* Purple */
  border-color: #a855f7;
}

.frame-block.neutral {
  background-color: #1f2937;
  border-color: #374151;
}

/* Legend Colors */
.legend-color {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.legend-color.prefix {
  background-color: #374151;
}

.legend-color.startup {
  background-color: #9ca3af;
}

.legend-color.active {
  background-color: #dc2626;
}

.legend-color.recovery {
  background-color: #2563eb;
}

.legend-color.down {
  background-color: #000;
}

.legend-color.vulnerable {
  background-color: rgba(74, 222, 128, 0.2);
  border-color: var(--color-positive);
}

.legend-color.hitstun {
  background-color: #ca8a04;
}

.legend-color.blockstun {
  background-color: #9333ea;
}

.frame-block.is-hit {
  /* Highlight the hit frame specifically? */
  background-color: #fca5a5;
  /* Lighter red */
  border-color: #fff;
  z-index: 2;
}

/* Vulnerable Window indication */
.frame-block.is-vulnerable {
  box-shadow: 0 4px 0 0 rgba(74, 222, 128, 0.5);
  /* Green underline-ish */
}

.frame-block.is-vulnerable::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-positive);
  opacity: 0.5;
}

/* Markers */
.frame-marker {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  line-height: 1;
  pointer-events: none;
}

.frame-marker.ghost {
  opacity: 0.3;
  /* Less visible on attacker row */
}

.frame-marker.hit-marker,
.frame-marker.block-marker {
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 14px;
  z-index: 5;
}

.frame-marker.wakeup {
  color: var(--color-positive);
  /* Green */
}

.frame-marker.reversal {
  color: #f59e0b;
  /* Orange */
  top: -12px;
  /* Stack or adjust if both exist? */
}

/* Logic for stacking markers if both active? */
.frame-block.is-wakeup.is-reversal .frame-marker.reversal {
  top: -20px;
  /* Shift up if overlapping */
}

.frame-number {
  position: absolute;
  bottom: -16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
}

/* Legend Colors */
.legend-icon.opponent-wakeup {
  color: var(--color-positive);
}

.legend-icon.opponent-reversal {
  color: #f59e0b;
}

.throw-mixup-tip {
  margin-bottom: var(--space-md);
  padding: var(--space-md);
  background: linear-gradient(to right, rgba(147, 51, 234, 0.15), rgba(59, 130, 246, 0.15));
  border: 1px solid rgba(147, 51, 234, 0.3);
  border-left: 4px solid #9333ea;
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  display: flex;
  gap: var(--space-md);
  align-items: flex-start;
  line-height: 1.6;
}

.throw-mixup-tip strong {
  color: #d8b4fe;
}

.throw-mixup-tip .tip-icon {
  font-size: 1.2em;
}

.sortable-header {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

.sortable-header:hover {
  color: var(--color-accent);
}

.sort-indicator {
  font-size: 0.8em;
  color: var(--color-accent);
}

.results-controls {
  flex: 1;
  margin-top: var(--space-sm);
}

.filter-group {
  display: flex;
  gap: var(--space-md);
  align-items: center;
  background: var(--color-bg-tertiary);
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

.auto-match-search-input {
  flex: 1; /* Take available space */
  min-width: 150px;
  padding: 8px 12px;
  border: none;
  background-color: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.auto-match-search-input:focus {
  outline: none;
}

.filter-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.filter-toggle-btn:hover {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border-color: var(--color-text-muted);
}

.filter-toggle-btn.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
  font-weight: 500;
  box-shadow: 0 0 10px rgba(var(--color-accent-rgb), 0.3);
}

.filter-toggle-btn .icon {
  font-size: 1.1em;
}

@media (max-width: 768px) {
  .results-header-row {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-sm);
  }
  
  .results-controls {
    width: 100%;
  }

  .filter-group {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-xs);
    padding: var(--space-sm);
  }
  
  .auto-match-search-input {
    width: 100%;
    border-bottom: 1px solid var(--color-border);
    border-radius: 0;
  }

  .filter-toggle-btn {
    justify-content: center;
    width: 100%;
  }
}
/* Custom Moves Section */
.custom-moves-section {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  border: 1px solid var(--color-border);
}

.custom-form {
  margin-bottom: var(--space-md);
}

.subsection-title {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: var(--space-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-row {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-wrap: wrap;
}

.input-sm {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
  flex: 1;
  min-width: 100px;
}

.frames-input-group {
  display: flex;
  align-items: center;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding-right: 8px;
  width: 100px;
}

.frames-input-group .frame-input {
  border: none;
  background: transparent;
  width: 100%;
  padding: 6px 4px 6px 10px;
  text-align: right;
  color: var(--color-text-primary);
}

.frames-input-group .unit {
  color: var(--color-text-secondary);
  font-size: 0.8em;
  font-weight: 600;
}

.btn-save {
  background: var(--color-primary);
  color: white;
  border: none;
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-save:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(1);
}

.list-label {
  font-size: 0.85em;
  color: var(--color-text-secondary);
  margin-bottom: var(--space-xs);
}

.saved-moves-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-sm);
}



.btn-delete {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid transparent;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.6;
  transition: all 0.2s;
  z-index: 2;
}

.btn-delete:hover {
  opacity: 1;
  color: var(--color-danger);
  background: rgba(var(--color-danger-rgb), 0.1);
}

.knockdown-card:hover .btn-delete {
  opacity: 1;
}

.section-divider {
  display: flex;
  align-items: center;
  margin: var(--space-lg) 0 var(--space-md);
  color: var(--color-text-primary);
  font-size: 0.9em;
}

.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.section-divider span {
  padding: 0 var(--space-md);
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
    align-items: stretch;
  }
  
  .frames-input-group {
    width: 100%;
  }
}
</style>
