<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData, type CharacterStats } from '../types';
import { calculateTradeAdvantage, parseHitstun, getEffectiveHitstun } from '../utils/trade';
import { calculateMoveStats, parseFrameValue } from '../utils/gapCalculator';
import { buildOkiResultKeyBase, getUniqueOkiResultKey } from '../utils/okiResultKey';
import { calculateMoveTotalFrames as calculateUnifiedMoveTotalFrames } from '../utils/frameTotals';
import { isAirborneMove } from '../utils/moveFilters';
import {
  calculateDriveRushAttackTiming,
  DRIVE_RUSH_EFFECTIVE_STARTUP_OFFSET,
  DRIVE_RUSH_FRAME_ADVANTAGE_BONUS,
  getDriveRushMoveStartup,
  PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME,
  getFastestDriveRushHitFrame,
  isDriveRushFollowUpMove,
} from '../utils/driveRush';
import {
  canBlockWakeupDriveReversal,
  getActionRecoverFrame,
  getSafeBaitLimitFrame,
  getWakeupDriveReversalImpactFrame,
  isSafeBaitTotalFrames,
  WAKEUP_DRIVE_REVERSAL,
} from '../utils/wakeupDriveReversal';
import {
  calculateRyuHadokenCornerOkiGuardAdvantage,
  isRyuHadokenOkiMove,
  type RyuHadokenOkiGuardCalculation,
} from '../utils/projectileOki';
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
import { defaultExcludedMoves } from '../data/defaultExcludedMoves';

// NEW: Custom Knockdown Move Interface & State
export interface CustomMove {
  id: string; // unique timestamp
  characterId: string;
  name: string;
  input: string;
  frames: number;
}

// NEW: Excluded Move Interface for Oki Routing
export interface ExcludedMove {
  id: string;       // unique ID
  characterId: string;
  moveName: string; // move name (matches result.move.name)
  moveInput: string; // move input (matches result.move.input)
  note?: string;    // optional user note (e.g., "不能打蹲防")
}

// NEW: Preferred Move Interface for Oki Routing
export interface PreferredMove {
  id: string;       // unique ID
  characterId: string;
  moveName: string; // move name
  moveInput: string; // move input (e.g., "2MK")
  note?: string;    // optional user note
}

const customMoves = ref<CustomMove[]>([]);
const newCustomMove = ref({
  name: '',
  input: '',
  frames: 40
});

// Excluded moves for Oki Routing (personal preference: exclude certain last-hit moves)
const excludedMoves = ref<ExcludedMove[]>([]);
const newExcludedMoveInput = ref('');
const newExcludedMoveNote = ref('');

// Preferred moves for Oki Routing (personal preference: prioritize/filter certain moves)
const preferredMoves = ref<PreferredMove[]>([]);
const newPreferredMoveInput = ref('');
const newPreferredMoveNote = ref('');
const onlyShowPreferred = ref(false);

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

// Excluded moves management (Oki Routing last-move exclusion)
function loadExcludedMoves() {
  let storedMoves: ExcludedMove[] = [];
  const stored = localStorage.getItem('sf6_oki_excluded_moves');
  if (stored) {
    try {
      storedMoves = JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse excluded moves', e);
    }
  }

  const moveMap = new Map<string, ExcludedMove>();
  defaultExcludedMoves.forEach(m => moveMap.set(m.id, m));
  storedMoves.forEach(m => moveMap.set(m.id, m));
  excludedMoves.value = Array.from(moveMap.values());
}

function addExcludedMove(moveName: string, moveInput: string) {
  if (!moveName || !moveInput) return;
  // Deduplicate: don't add the same move twice for the same character
  const exists = excludedMoves.value.some(
    m => m.characterId === attackerCharId.value && m.moveName === moveName && m.moveInput === moveInput
  );
  if (exists) return;

  const move: ExcludedMove = {
    id: Date.now().toString(),
    characterId: attackerCharId.value,
    moveName,
    moveInput,
    note: newExcludedMoveNote.value || undefined,
  };

  excludedMoves.value.push(move);
  localStorage.setItem('sf6_oki_excluded_moves', JSON.stringify(excludedMoves.value));
  newExcludedMoveInput.value = '';
  newExcludedMoveNote.value = '';
}

function removeExcludedMove(id: string) {
  excludedMoves.value = excludedMoves.value.filter(m => m.id !== id);
  localStorage.setItem('sf6_oki_excluded_moves', JSON.stringify(excludedMoves.value));
}

// Preferred moves management (Oki Routing preferred moves prioritization/filtering)
function loadPreferredMoves() {
  let storedMoves: PreferredMove[] = [];
  const stored = localStorage.getItem('sf6_oki_preferred_moves');
  if (stored) {
    try {
      storedMoves = JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse preferred moves', e);
    }
  }

  const moveMap = new Map<string, PreferredMove>();
  storedMoves.forEach(m => moveMap.set(m.id, m));
  preferredMoves.value = Array.from(moveMap.values());
}

function addPreferredMove(moveName: string, moveInput: string) {
  if (!moveName || !moveInput) return;
  // Deduplicate: don't add the same move twice for the same character
  const exists = preferredMoves.value.some(
    m => m.characterId === attackerCharId.value && m.moveName === moveName && m.moveInput === moveInput
  );
  if (exists) return;

  const move: PreferredMove = {
    id: Date.now().toString(),
    characterId: attackerCharId.value,
    moveName,
    moveInput,
    note: newPreferredMoveNote.value || undefined,
  };

  preferredMoves.value.push(move);
  localStorage.setItem('sf6_oki_preferred_moves', JSON.stringify(preferredMoves.value));
  newPreferredMoveInput.value = '';
  newPreferredMoveNote.value = '';
}

function removePreferredMove(id: string) {
  preferredMoves.value = preferredMoves.value.filter(m => m.id !== id);
  localStorage.setItem('sf6_oki_preferred_moves', JSON.stringify(preferredMoves.value));
}

function getFilteredMovesForDropdown(query: string) {
  if (!query) return [];
  const q = query.toLowerCase();
  
  const moves = attackerFrameData.value?.moves.filter(m => {
    return (m.input || '').toLowerCase().includes(q) || 
           (m.name || '').toLowerCase().includes(q) || 
           (m.nameZh || '').toLowerCase().includes(q);
  }) || [];
  
  const results = moves.map(m => ({
    name: m.name,
    input: m.input,
    displayName: getMoveDisplayName(m),
  }));
  
  const drLabel = `+绿冲(${PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME}F)`;
  const drQueryTerms = ['+绿冲', '绿冲', 'dr', 'drive rush', 'drive_rush', '冲', '11f'];
  const isDrMatch = drQueryTerms.some(term => q.includes(term) || term.includes(q));
  
  if (isDrMatch) {
    results.unshift({
      name: drLabel,
      input: drLabel,
      displayName: drLabel,
    });
  }
  return results.slice(0, 10);
}

onMounted(() => {
    loadCustomMoves();
    loadExcludedMoves();
    loadPreferredMoves();
});


// Combo chain - list of actions
interface ComboAction {
  type: 'dash' | 'move' | 'driveRush';
  name: string;
  frames: number;
  active?: number;  // Only for moves
  move?: Move;
}

const comboChain = ref<ComboAction[]>([]);
const moveSearchQuery = ref('');
const autoMatchSearchQuery = ref(''); // New: Search query for auto match results
const knockdownSearchQuery = ref('');
const showAllKnockdownPresets = ref(false);
const showAllAutoResults = ref(false);
const showResultTimeline = ref(false);
const showThrowTimeline = ref(false);

// Opponent's fastest reversal settings
const opponentReversalStartup = ref<number>(4);
// const opponentReversalActive = ref<number>(3); // Unused

// Use combo chain as prefix for auto calculation (automatically filtered)

// Loop throw calculator inputs
// Loop throw calculator inputs
const throwStartup = ref<number>(5);
const throwActive = ref<number>(3);
const wakeupThrowInvul = ref<number>(1);
const opponentAbareStartup = ref<number>(4);
const throwExtraDelayFrames = ref<number>(0);
const altExtraDelayFrames = ref<number>(0);
const burstPressureOffset = ref<number>(1);
const frameTrapAdvantageTarget = ref<number>(-3);

const activeAltOkiTab = ref<'driveRush' | 'driveImpact' | 'frameTrap' | 'safeBait' | 'baitThrow'>('driveRush');
const showThrowSection = ref(false);
const showAltOkiSection = ref(false);

// Bait Throw inputs
const selectedBaitInitiator = ref<Move | null>(null);
const isBaitInitiatorDRC = ref<boolean>(false);
const selectedBaitAction = ref<'jump' | 'backdash'>('jump');
const defenderBaitReactionType = ref<'throw' | 'invincibleGrab'>('throw');
const defenderBaitCustomStartup = ref<number>(5);
const defenderBaitCustomWhiffRecovery = ref<number>(50);
const defenderBaitSearchQuery = ref('');
const showDefenderBaitDropdown = ref(false);
const selectedDefenderBaitMove = ref<Move | null>(null);
const baitInitiatorSearchQuery = ref('');
const showBaitInitiatorDropdown = ref(false);

const KNOCKDOWN_PRESET_PREVIEW_COUNT = 12;
const MOBILE_RESULT_PREVIEW_COUNT = 12;

function stepAltExtraDelay(val: number) {
  altExtraDelayFrames.value = Math.max(0, (altExtraDelayFrames.value || 0) + val);
}

function stepBurstPressureOffset(val: number) {
  burstPressureOffset.value = Math.max(1, (burstPressureOffset.value || 1) + val);
}

function stepFrameTrapAdvTarget(val: number) {
  frameTrapAdvantageTarget.value = (frameTrapAdvantageTarget.value || 0) + val;
}

function stepOpponentReversalStartup(val: number) {
  opponentReversalStartup.value = Math.max(1, (opponentReversalStartup.value || 1) + val);
}

function stepDefenderBaitCustomStartup(val: number) {
  defenderBaitCustomStartup.value = Math.max(1, (defenderBaitCustomStartup.value || 1) + val);
}

function stepDefenderBaitCustomWhiffRecovery(val: number) {
  defenderBaitCustomWhiffRecovery.value = Math.max(1, (defenderBaitCustomWhiffRecovery.value || 1) + val);
}

const BURST_STARTUP_FRAMES = 26;
const BURST_ACTIVE_FRAMES = 2;

// Selected result for detail view
const selectedResultKey = ref<string | null>(null);
const selectedThrowResultKey = ref<string | null>(null);
const selectedBurstResultKey = ref<string | null>(null);
const selectedFrameTrapResultKey = ref<string | null>(null);
const selectedDriveRushResultKey = ref<string | null>(null);
const selectedSafeBaitResultKey = ref<string | null>(null);

// Effective knockdown advantage
// Effective knockdown advantage
// Helper to parse knockdown advantage from move
function parseKnockdownAdvantage(move: Move): number {
    if (!move) return 0;
    
    // Priority 0: Exact advantage defined on knockdown object
    if (move.knockdown?.advantage) return move.knockdown.advantage;

    // Priority 1: Parse exact advantage from 'onHit' string
    if (move.onHit && typeof move.onHit === 'string') {
        const match = move.onHit.match(/(?:KD|HKD|Crumple)[^0-9]*(\d+)/i);
        if (match) {
            return parseInt(match[1] || '0', 10);
        }
    }
    
    return 0;
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
const normalizedOpponentReversalStartup = computed(() => Math.max(1, Math.trunc(opponentReversalStartup.value || 1)));
const opponentFirstActiveFrame = computed(() => {
  // First active (damage) frame of the reversal
  return effectiveKnockdownAdv.value + normalizedOpponentReversalStartup.value;
});
const opponentPreActiveEnd = computed(() => {
  return opponentFirstActiveFrame.value - 1;
});
const opponentPreActiveWindowValid = computed(() => {
  return opponentPreActiveEnd.value >= opponentWakeupFrame.value;
});
const wakeupDriveReversalImpactFrame = computed(() => {
  return getWakeupDriveReversalImpactFrame(opponentWakeupFrame.value);
});
const wakeupDriveReversalInvulStartFrame = computed(() => {
  return opponentWakeupFrame.value + WAKEUP_DRIVE_REVERSAL.invincibleStartOffset;
});
const wakeupDriveReversalInvulEndFrame = computed(() => {
  return opponentWakeupFrame.value + WAKEUP_DRIVE_REVERSAL.invincibleEndOffset;
});
const safeBaitStrictLimitFrame = computed(() => {
  return opponentWakeupFrame.value + normalizedOpponentReversalStartup.value;
});
const safeBaitMaxTotalFrame = computed(() => {
  return getSafeBaitLimitFrame({
    opponentWakeupFrame: opponentWakeupFrame.value,
    opponentMoveStartup: normalizedOpponentReversalStartup.value,
  });
});
const safeBaitTargetLabel = computed(() => {
  if (!selectedDefenderMove.value) return '当前对手招式';
  const input = selectedDefenderMove.value.input ? ` (${selectedDefenderMove.value.input})` : '';
  return `${getMoveDisplayName(selectedDefenderMove.value)}${input}`;
});

// Loop throw calculator
const normalizedThrowStartup = computed(() => Math.max(1, throwStartup.value || 1));
const normalizedThrowActive = computed(() => Math.max(1, throwActive.value || 1));
const normalizedThrowInvul = computed(() => Math.max(0, wakeupThrowInvul.value || 0));
const normalizedAbare = computed(() => Math.max(0, opponentAbareStartup.value || 0));
const normalizedThrowExtraDelay = computed(() => Math.max(0, Math.trunc(throwExtraDelayFrames.value || 0)));
const normalizedAltExtraDelay = computed(() => Math.max(0, Math.trunc(altExtraDelayFrames.value || 0)));
const normalizedBurstPressureOffset = computed(() => Math.max(1, Math.trunc(burstPressureOffset.value || 1)));
const normalizedFrameTrapAdvTarget = computed(() => Math.trunc(frameTrapAdvantageTarget.value || 0));

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
  const moves = attackerFrameData.value.moves.filter((m: Move) => m.knockdown && m.knockdown.type !== 'none');
  
  const expanded: Move[] = [];
  for (const m of moves) {
    expanded.push(m);
    if (m.knockdown?.alternativeAdvantages && m.knockdown.alternativeAdvantages.length > 0) {
      for (const alt of m.knockdown.alternativeAdvantages) {
        const altMove: Move = { ...m };
        altMove.name = `${m.name} (${alt.condition})`;
        if (altMove.nameZh) {
          altMove.nameZh = `${altMove.nameZh} (${alt.condition})`;
        }
        altMove.knockdown = { ...m.knockdown, advantage: alt.advantage };
        // Remove alternativeAdvantages from the clone so we don't recurse if we ever did
        delete altMove.knockdown.alternativeAdvantages;
        expanded.push(altMove);
      }
    }
  }
  return expanded;
});

const filteredKnockdownMoves = computed<Move[]>(() => {
  const queryRaw = knockdownSearchQuery.value.trim();
  if (!queryRaw) return knockdownMoves.value;

  const queryLower = queryRaw.toLowerCase();
  return knockdownMoves.value.filter((move) => {
    const fields = [
      move.name,
      move.nameZh,
      move.input,
      getMoveDisplayName(move),
      `${parseKnockdownAdvantage(move)}F`,
    ].filter((val): val is string => typeof val === 'string' && val.length > 0);

    return fields.some((field) => field.toLowerCase().includes(queryLower));
  });
});

const visibleKnockdownMoves = computed<Move[]>(() => {
  if (showAllKnockdownPresets.value || knockdownSearchQuery.value.trim()) {
    return filteredKnockdownMoves.value;
  }

  return filteredKnockdownMoves.value.slice(0, KNOCKDOWN_PRESET_PREVIEW_COUNT);
});

const hiddenKnockdownPresetCount = computed(() => {
  return Math.max(0, filteredKnockdownMoves.value.length - visibleKnockdownMoves.value.length);
});

const hasKnockdownPresetFilter = computed(() => knockdownSearchQuery.value.trim().length > 0);

// ALL moves for selection (Attacker)
const allMoves = computed<Move[]>(() => {
  if (!attackerFrameData.value) return [];
  return attackerFrameData.value.moves.filter((m: Move) => {
    if (isAirborneMove(m)) return false;
    const startup = parseInt(m.startup) || 0;
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
  return calculateUnifiedMoveTotalFrames(move) ?? 0;
}

function getActionDisplayName(action: ComboAction): string {
  if (action.type === 'driveRush' && action.move) {
    return `绿冲${getMoveDisplayName(action.move)}`;
  }
  if (action.type === 'move' && action.move) {
    return getMoveDisplayName(action.move);
  }
  return action.name;
}

type MoveRecoveryTiming = {
  activeWindowFrames: number;
  recoveryFrames: number;
  recoverFrame: number;
  safeAgainstWakeupDriveReversal: boolean;
  driveReversalSafetyMargin: number;
};

function getMoveRecoveryTiming(actionStartFrame: number, move: Move, startup: number): MoveRecoveryTiming {
  const activeWindowFrames = parseActiveWindowFrames(move.active);
  const recoveryFrames = parseTotalRecoveryFrames(move.recovery);
  const recoverFrame = getActionRecoverFrame({
    actionStartFrame,
    startup,
    active: activeWindowFrames,
    recovery: recoveryFrames,
  });
  const safeAgainstWakeupDriveReversal = canBlockWakeupDriveReversal({
    recoverFrame,
    opponentWakeupFrame: opponentWakeupFrame.value,
  });

  return {
    activeWindowFrames,
    recoveryFrames,
    recoverFrame,
    safeAgainstWakeupDriveReversal,
    driveReversalSafetyMargin: wakeupDriveReversalImpactFrame.value - recoverFrame,
  };
}

function getBodyTotalRecoveryTiming(actionStartFrame: number, totalFrames: number): MoveRecoveryTiming {
  const recoverFrame = actionStartFrame + totalFrames;
  const safeAgainstWakeupDriveReversal = canBlockWakeupDriveReversal({
    recoverFrame,
    opponentWakeupFrame: opponentWakeupFrame.value,
  });

  return {
    activeWindowFrames: 0,
    recoveryFrames: totalFrames,
    recoverFrame,
    safeAgainstWakeupDriveReversal,
    driveReversalSafetyMargin: wakeupDriveReversalImpactFrame.value - recoverFrame,
  };
}




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
  activeWindowFrames: number;
  recoveryFrames: number;
  recoverFrame: number;
  safeAgainstWakeupDriveReversal: boolean;
  driveReversalSafetyMargin: number;
  toleranceFrames?: number;
  coversOpponent: boolean;
  isTrade: boolean;
  calculatedOnBlock?: number | string;
  calculatedOnHit?: number | string;
  meatyBonus?: number;
  effectiveHitFrame?: number;
  projectileOki?: RyuHadokenOkiGuardCalculation;
  tradeAdvantage?: number;
  tradeDetail?: string;
  tradeExplanation?: string;
  tags?: string[]; // New: e.g. 'Corner Only'
  isDriveRush?: boolean;
  driveRushStartFrame?: number;
  driveRushAttackStartFrame?: number;
  driveRushFastestHitFrame?: number;
  driveRushAdvantageBonus?: number;
  sourcePrefixName?: string;
  sourcePrefixFrames?: number;
  // Chain Cancel
  isChainCancel?: boolean;
  chainCancelSequence?: string; // e.g. "2LP×2" or "2LP→5LP"
  chainCancelOffset?: number;   // first additional step offset (for same-move display)
  chainCancelSteps?: number;    // number of chained moves used as frame kill
  chainCancelMoveTotalFrames?: number; // first move total frames (for formula display)
  chainCancelMoveInputs?: string[];    // sequence of move inputs e.g. ["2LP","5LP","2LP"]
  chainCancelStepFrames?: number[];    // per-step frame contributions [totalFirst, ...offsets]
  isPreferred?: boolean;
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

function isChainCancelableMove(move: Move): boolean {
  if (!move.cancels) return false;
  return move.cancels.some(c => c.toUpperCase() === 'CHAIN' || c.toUpperCase() === 'CHN');
}

// Build prefix name from combo chain
const comboChainPrefixName = computed(() => {
  if (comboChain.value.length === 0) return '';
  return comboChain.value
    .map((a: ComboAction) => getActionDisplayName(a))
    .join(' + ');
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

function toggleBurstResultDetail(key: string) {
  if (selectedBurstResultKey.value === key) {
    selectedBurstResultKey.value = null;
  } else {
    selectedBurstResultKey.value = key;
  }
}

function toggleFrameTrapResultDetail(key: string) {
  if (selectedFrameTrapResultKey.value === key) {
    selectedFrameTrapResultKey.value = null;
  } else {
    selectedFrameTrapResultKey.value = key;
  }
}

function toggleDriveRushResultDetail(key: string) {
  if (selectedDriveRushResultKey.value === key) {
    selectedDriveRushResultKey.value = null;
  } else {
    selectedDriveRushResultKey.value = key;
  }
}

function toggleSafeBaitResultDetail(key: string) {
  if (selectedSafeBaitResultKey.value === key) {
    selectedSafeBaitResultKey.value = null;
  } else {
    selectedSafeBaitResultKey.value = key;
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

const driveRushFollowUpMoves = computed<Move[]>(() => {
  return allMoves.value.filter((move) => {
    if (isComboSequenceMove(move)) return false;
    return isDriveRushFollowUpMove(move);
  });
});

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

  // Default prefixes (Dashes)
  const prefixes: { name: string; frames: number; input?: string; isCorner?: boolean }[] = [
    { name: '', frames: 0, isCorner: false },
    { name: '前冲', frames: stats.value.forwardDash, isCorner: false },
    { name: '前冲x2', frames: stats.value.forwardDash * 2, isCorner: false },
  ];

  // Add Frame Kill Moves (Single Move)
  for (const kill of validFrameKills) {
    const total = getMoveTotalFrames(kill);
    prefixes.push({
      name: kill.name,
      frames: total,
      input: kill.input,
      isCorner: true
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

  // --- Chain Cancel Prefixes ---
  // Chain Cancel requires ≥2 chained moves (e.g. 5LP → 5LP).
  // Frame accounting:
  //   First move: totalFrames = startup + active - 1 + recovery
  //   Each additional step: chainOffset = active + recovery - 1  (LP moves)
  //                            chainOffset = active + recovery      (LK moves, no -1)
  //
  // Ryu examples:
  //   5LP (total=13, offset=3+6=9):    ×2=22  ×3=31
  //   2LP (total=14, offset=2+8=10):   ×2=24  ×3=34
  //   2LK (total=16, offset=2+10=12):  ×2=28  ×3=40  (LK uses full recovery)
  const chainCancelMoves = allMoves.value.filter(m => {
    if (!m.cancels) return false;
    return m.cancels.some(c => c.toUpperCase() === 'CHAIN' || c.toUpperCase() === 'CHN');
  });

  for (const chainMove of chainCancelMoves) {
    const tf = getMoveTotalFrames(chainMove);
    const active = parseActiveWindowFrames(chainMove.active);
    const recovery = parseTotalRecoveryFrames(chainMove.recovery);
    // LK moves use full recovery in chain cancel (no -1 truncation)
    const isLK = (chainMove.input || '').toUpperCase().includes('LK');
    const chainOffset = active + Math.max(0, isLK ? recovery : recovery - 1);
    if (tf <= 0 || chainOffset <= 0) continue;

    for (let steps = 2; steps <= 3; steps++) {
      const prefixFrames = tf + (steps - 1) * chainOffset;
      if (prefixFrames >= effectiveKnockdownAdv.value) continue;
      const seqLabel = `${chainMove.input}×${steps} (Chain Cancel)`;
      const moveInputs = Array(steps).fill(chainMove.input) as string[];
      const stepFrames = [tf, ...Array(steps - 1).fill(chainOffset)] as number[];

      prefixes.push({
        name: seqLabel,
        frames: prefixFrames,
        input: chainMove.input,
        isCorner: false,
        _isChainCancel: true,
        _chainCancelSteps: steps,
        _chainCancelOffset: chainOffset,
        _chainCancelMoveTotalFrames: tf,
        _chainCancelMoveInputs: moveInputs,
        _chainCancelStepFrames: stepFrames,
        _chainCancelSeq: seqLabel,
        _chainCancelMoveName: chainMove.input,
      } as any);

      const dashTotal = stats.value.forwardDash + prefixFrames;
      if (dashTotal < effectiveKnockdownAdv.value) {
        prefixes.push({
          name: `前冲 + ${seqLabel}`,
          frames: dashTotal,
          input: chainMove.input,
          isCorner: false,
          _isChainCancel: true,
          _chainCancelSteps: steps,
          _chainCancelOffset: chainOffset,
          _chainCancelMoveTotalFrames: tf,
          _chainCancelMoveInputs: moveInputs,
          _chainCancelStepFrames: stepFrames,
          _chainCancelSeq: seqLabel,
          _chainCancelMoveName: chainMove.input,
        } as any);
      }
    }
  }

  for (const prefix of prefixes) {
    for (const move of allMoves.value) {
      if (isComboSequenceMove(move)) continue;
      // After a chain cancel prefix, skip chain-cancelable oki moves.
      // Chain cancel prefixes already represent the optimal frame-kill sequence;
      // pairing them with another chain-cancelable move would double-count startup
      // (e.g. 2LP×2 + 2LP should just be 2LP×3 which is already a prefix).
      if ((prefix as any)._isChainCancel && isChainCancelableMove(move)) continue;
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
      const normalOurStart = prefix.frames + startup + activeDisplayStartOffset;
      const normalOurEnd = normalOurStart + activeDisplayLength - 1;
      const isRyuHadoken = isRyuHadokenOkiMove(attackerCharId.value, move);
      const projectileOkiCandidate = calculateRyuHadokenCornerOkiGuardAdvantage({
        characterId: attackerCharId.value,
        move,
        blockFrameFromInput: oppWindowStart - prefix.frames,
      });
      const projectileOki = projectileOkiCandidate && projectileOkiCandidate.contactDelayAfterStartup >= 0
        ? projectileOkiCandidate
        : null;
      if (isRyuHadoken && !projectileOki) continue;
      const ourStart = projectileOki ? oppWindowStart : normalOurStart;
      const ourEnd = projectileOki ? oppWindowStart : normalOurEnd;

      // Success: our active window overlaps opponent's vulnerable startup window
      const overlapsPreActive =
        hasPreActiveWindow && ourEnd >= oppWindowStart && ourStart <= oppWindowEnd;
      const overlapsOppFirst = ourStart <= oppFirst && ourEnd >= oppFirst;

      const isSuccessMatch = overlapsPreActive;
      const isTradeMatch = overlapsOppFirst && !overlapsPreActive;
      const toleranceFrames = isSuccessMatch ? Math.max(0, oppWindowEnd - ourStart) : undefined;

      if (isSuccessMatch || isTradeMatch) {
        // Calculate Meaty Bonus
        const meatyStartFrame = projectileOki
          ? prefix.frames + projectileOki.startup
          : prefix.frames + startup + meatyStartOffset;
        const effectiveHitFrame = projectileOki
          ? oppWindowStart
          : Math.max(meatyStartFrame, oppWindowStart);
        const canApplyMeaty = !move.noMeaty;
        const meatyBonus = projectileOki
          ? projectileOki.contactDelayAfterStartup
          : canApplyMeaty ? (effectiveHitFrame - meatyStartFrame) : 0;

        let calcBlock: number | string | undefined;
        let calcHit: number | string | undefined;
        let tradeAdv: number | undefined;
        let tradeDet: string | undefined;
        let tradeExpl = '';

        const baseBlock = parseFrameAdvantage(move.onBlock);
        if (projectileOki) {
          calcBlock = projectileOki.guardAdvantage;
        } else if (baseBlock !== null) {
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

        const recoveryTiming = projectileOki
          ? getBodyTotalRecoveryTiming(prefix.frames, projectileOki.totalFrames)
          : getMoveRecoveryTiming(prefix.frames, move, startup);
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
          activeWindowFrames: recoveryTiming.activeWindowFrames,
          recoveryFrames: recoveryTiming.recoveryFrames,
          recoverFrame: recoveryTiming.recoverFrame,
          safeAgainstWakeupDriveReversal: recoveryTiming.safeAgainstWakeupDriveReversal,
          driveReversalSafetyMargin: recoveryTiming.driveReversalSafetyMargin,
          toleranceFrames,
          coversOpponent: isSuccessMatch,
          isTrade: isTradeMatch,
          calculatedOnBlock: calcBlock,
          calculatedOnHit: calcHit,
          meatyBonus,
          effectiveHitFrame,
          projectileOki: projectileOki ?? undefined,
          tradeAdvantage: tradeAdv,
          tradeDetail: tradeDet,
          tradeExplanation: tradeExpl,
          tags: [
            ...(prefix.isCorner || projectileOki ? ['版边(Corner)'] : []),
            ...(projectileOki ? ['波动拳公式'] : []),
          ],
          isChainCancel: !!(prefix as any)._isChainCancel,
          chainCancelSequence: (prefix as any)._chainCancelSeq,
          chainCancelOffset: (prefix as any)._chainCancelOffset,
          chainCancelSteps: (prefix as any)._chainCancelSteps,
          chainCancelMoveTotalFrames: (prefix as any)._chainCancelMoveTotalFrames,
          chainCancelMoveInputs: (prefix as any)._chainCancelMoveInputs,
          chainCancelStepFrames: (prefix as any)._chainCancelStepFrames,
        });
      }
    }

    for (const move of driveRushFollowUpMoves.value) {
      const startup = getDriveRushMoveStartup(move) ?? 0;
      if (startup <= 0) continue;

      const activeInfo = parseActiveSegments(move.active);
      const activeHasGap = activeInfo.gaps.length > 0;
      const activeHasMultipleSegments = activeInfo.segments.length > 1;
      const activeHitTotal = parseTotalActiveFrames(move.active);
      const activeDisplayStartOffset = activeHasGap ? activeInfo.lastSegmentStartOffset : 0;
      const activeDisplayLength = activeHasGap ? activeInfo.lastSegmentLength : activeHitTotal;
      const meatyStartOffset = activeHasMultipleSegments ? activeInfo.lastSegmentStartOffset : 0;
      const meatyLength = activeHasMultipleSegments ? activeInfo.lastSegmentLength : activeHitTotal;

      const timing = calculateDriveRushAttackTiming({
        driveRushStartFrame: prefix.frames,
        moveStartup: startup,
        activeStartOffset: activeDisplayStartOffset,
        activeLength: activeDisplayLength,
      });
      const ourStart = timing.firstActiveFrame;
      const ourEnd = timing.lastActiveFrame;

      const overlapsPreActive =
        hasPreActiveWindow && ourEnd >= oppWindowStart && ourStart <= oppWindowEnd;
      const overlapsOppFirst = ourStart <= oppFirst && ourEnd >= oppFirst;

      const isSuccessMatch = overlapsPreActive;
      const isTradeMatch = overlapsOppFirst && !overlapsPreActive;
      const toleranceFrames = isSuccessMatch ? Math.max(0, oppWindowEnd - ourStart) : undefined;

      if (isSuccessMatch || isTradeMatch) {
        const meatyStartFrame = timing.fastestHitFrame + meatyStartOffset;
        const effectiveHitFrame = Math.max(meatyStartFrame, oppWindowStart);
        const canApplyMeaty = !move.noMeaty;
        const meatyBonus = canApplyMeaty ? (effectiveHitFrame - meatyStartFrame) : 0;
        const driveRushAdvantageBonus = getDriveRushAdvantageBonus(move);

        let calcBlock: number | string | undefined;
        let calcHit: number | string | undefined;
        let tradeAdv: number | undefined;
        let tradeDet: string | undefined;
        let tradeExpl = '';

        const baseBlock = parseFrameAdvantage(move.onBlock);
        if (baseBlock !== null) {
          calcBlock = baseBlock + driveRushAdvantageBonus + meatyBonus;
        } else {
          calcBlock = move.onBlock;
        }

        const baseHit = parseFrameAdvantage(move.onHit);
        if (baseHit !== null) {
          const chBonus = isSuccessMatch ? 2 : 0;
          calcHit = baseHit + driveRushAdvantageBonus + meatyBonus + chBonus;
        } else {
          calcHit = move.onHit;
        }

        if (isTradeMatch) {
          if (selectedDefenderMove.value && move.raw && selectedDefenderMove.value.raw) {
            const adv = calculateTradeAdvantage(move.raw, selectedDefenderMove.value.raw);
            tradeAdv = adv;
            tradeDet = `${adv > 0 ? '+' : ''}${adv}`;

            const effA = getEffectiveHitstun(move.raw);
            const effB = getEffectiveHitstun(selectedDefenderMove.value.raw);

            const labelA = effA.type === 'blockstun' ? `(Blockstun ${parseHitstun(move.raw.blockstun)} + 2CH)` : `(Hitstun ${parseHitstun(move.raw.hitstun)} + 2CH)`;
            const labelB = effB.type === 'blockstun' ? `(Blockstun ${parseHitstun(selectedDefenderMove.value.raw.blockstun)} + 2CH)` : `(Hitstun ${parseHitstun(selectedDefenderMove.value.raw.hitstun)} + 2CH)`;

            tradeExpl = `绿冲${getMoveDisplayName(move)} ${labelA} - ${getMoveDisplayName(selectedDefenderMove.value)} ${labelB} = ${adv}`;
          } else {
            tradeDet = '需选择招式';
          }
        }

        const driveRushPrefixName = prefix.name ? `${prefix.name} + 绿冲` : '绿冲';
        const driveRushPrefixInput = prefix.input ? `${prefix.input} + DR` : 'DR';
        const effectivePrefixFrames = prefix.frames + DRIVE_RUSH_EFFECTIVE_STARTUP_OFFSET;
        const recoveryTiming = getMoveRecoveryTiming(effectivePrefixFrames, move, startup);
        const baseKey = buildOkiResultKeyBase({
          prefixName: driveRushPrefixName,
          prefixFrames: effectivePrefixFrames,
          prefixInput: driveRushPrefixInput,
          moveName: move.name,
          moveInput: move.input,
          ourActiveStart: ourStart,
          ourActiveEnd: ourEnd
        });
        const key = getUniqueOkiResultKey(baseKey, keyCounts);

        results.push({
          key,
          move,
          prefix: driveRushPrefixName,
          prefixInput: driveRushPrefixInput,
          prefixFrames: effectivePrefixFrames,
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
          activeWindowFrames: recoveryTiming.activeWindowFrames,
          recoveryFrames: recoveryTiming.recoveryFrames,
          recoverFrame: recoveryTiming.recoverFrame,
          safeAgainstWakeupDriveReversal: recoveryTiming.safeAgainstWakeupDriveReversal,
          driveReversalSafetyMargin: recoveryTiming.driveReversalSafetyMargin,
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
          tags: prefix.isCorner ? ['版边(Corner)'] : [],
          isDriveRush: true,
          driveRushStartFrame: prefix.frames,
          driveRushAttackStartFrame: timing.attackStartFrame,
          driveRushFastestHitFrame: timing.fastestHitFrame,
          driveRushAdvantageBonus,
          sourcePrefixName: prefix.name,
          sourcePrefixFrames: prefix.frames,
        });
      }
    }
  }

  return results;
});

const okiResults = computed<ExtendedOkiResult[]>(() => {
  let filtered = allOkiResults.value;

  if (comboChain.value.length > 0) {
    filtered = filtered.filter(result => {
      const fullText = `${result.prefix || ''} + ${getMoveDisplayName(result.move) || ''} + ${result.move.name || ''} + ${result.move.nameZh || ''}`.toLowerCase();
      return comboChain.value.every(action => {
        const actionName = action.name.toLowerCase();
        return fullText.includes(actionName);
      });
    });
  }

  // Exclude moves based on user preferences (personal preference: skip certain last-hit moves)
  const excludesForChar = excludedMoves.value.filter(m => m.characterId === attackerCharId.value);
  if (excludesForChar.length > 0) {
    filtered = filtered.filter(result => {
      const moveName = result.move.name || '';
      const moveInput = result.move.input || '';
      return !excludesForChar.some(exc => {
        if (exc.moveName === moveName || exc.moveInput === moveInput) {
          return true;
        }
        const isDrExc = exc.moveName.includes('绿冲') || exc.moveInput.includes('绿冲') || exc.moveInput.toLowerCase() === 'dr';
        if (isDrExc && result.isDriveRush) {
          return true;
        }
        return false;
      });
    });
  }

  // Determine if each result contains any preferred moves
  const preferredForChar = preferredMoves.value.filter(m => m.characterId === attackerCharId.value);
  let resultsWithPref = filtered.map(result => {
    const isPreferred = preferredForChar.length > 0 && preferredForChar.some(pref => {
      const prefInputLower = pref.moveInput.toLowerCase();
      const prefNameLower = pref.moveName.toLowerCase();
      
      const isDrPref = prefNameLower.includes('绿冲') || prefInputLower.includes('绿冲') || prefInputLower === 'dr';
      if (isDrPref && result.isDriveRush) {
        return true;
      }

      // Check final move input or name
      if (result.move.input.toLowerCase() === prefInputLower || result.move.name.toLowerCase() === prefNameLower) {
        return true;
      }
      // Check prefix input (contains the input, e.g. "2MK")
      if (result.prefixInput && result.prefixInput.toLowerCase().includes(prefInputLower)) {
        return true;
      }
      // Check prefix display name (contains the name)
      if (result.prefix && result.prefix.toLowerCase().includes(prefNameLower)) {
        return true;
      }
      return false;
    });

    return {
      ...result,
      isPreferred
    };
  });

  // If onlyShowPreferred is checked, filter to only keep those containing preferred moves
  if (preferredForChar.length > 0 && onlyShowPreferred.value) {
    resultsWithPref = resultsWithPref.filter(r => r.isPreferred);
  }

  if (autoMatchSearchQuery.value) {
    const queryRaw = autoMatchSearchQuery.value.trim();
    const queryLower = queryRaw.toLowerCase();
    resultsWithPref = resultsWithPref.filter(result => {
      const fields = [
        result.prefix,
        result.prefixInput,
        result.move.name,
        result.move.nameZh,
        result.move.input,
        getMoveDisplayName(result.move),
        ...(result.isDriveRush ? [
          `+绿冲(${PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME}f)`,
          `+绿冲`,
          `绿冲(${PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME}f)`,
          `绿冲`,
          `+dr`,
          `dr`
        ] : [])
      ].filter((val): val is string => typeof val === 'string' && val.length > 0);

      return fields.some(field => field.toLowerCase().includes(queryLower));
    });
  }

  const sorted = [...resultsWithPref].sort((a, b) => {
    // 1. Prioritize preferred moves to the top if not strictly filtering
    if (preferredForChar.length > 0 && !onlyShowPreferred.value) {
      if (a.isPreferred !== b.isPreferred) {
        return a.isPreferred ? -1 : 1;
      }
    }

    // 2. Secondary sort based on sortKey
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

const visibleOkiResults = computed<ExtendedOkiResult[]>(() => {
  if (showAllAutoResults.value) return okiResults.value;
  return okiResults.value.slice(0, MOBILE_RESULT_PREVIEW_COUNT);
});

const hiddenOkiResultCount = computed(() => {
  return Math.max(0, okiResults.value.length - visibleOkiResults.value.length);
});

// Throw filler moves (exclude throws, keep reasonable total frames)
const throwFillerMoves = computed<Move[]>(() => {
  if (!attackerFrameData.value) return [];
  return attackerFrameData.value.moves.filter((m: Move) => {
    if (m.category === 'throw') return false;
    if (isAirborneMove(m)) return false;
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
  baseDelay: number;
  extraDelayFrames: number;
  delay: number;
  firstActive: number;
  toleranceFrames: number;
}

const allThrowResults = computed<ThrowComboResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];
  if (throwDelayMax.value < 0) return [];

  const prefixes: { name: string; frames: number }[] = [
    { name: '', frames: 0 },
    { name: '前冲', frames: stats.value.forwardDash },
    { name: '前冲x2', frames: stats.value.forwardDash * 2 },
  ];

  const results: ThrowComboResult[] = [];
  const minDelay = throwDelayMinClamped.value;
  const maxDelay = throwDelayMax.value;
  const throwStart = normalizedThrowStartup.value;
  const extraDelay = normalizedThrowExtraDelay.value;

  for (const prefix of prefixes) {
    const baseDelay = prefix.frames;
    const actualDelay = baseDelay + extraDelay;
    if (actualDelay >= minDelay && actualDelay <= maxDelay) {
      const key = `${prefix.name}|direct|${prefix.frames}`;
      results.push({
        key,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        fillerName: '直接投',
        fillerFrames: 0,
        baseDelay,
        extraDelayFrames: extraDelay,
        delay: actualDelay,
        firstActive: actualDelay + throwStart,
        toleranceFrames: Math.max(0, maxDelay - actualDelay),
      });
    }

    for (const move of throwFillerMoves.value) {
      const fillerStartup = parseInt(move.startup) || 0;
      const fillerActive = parseActiveWindowFrames(move.active);
      const fillerRecovery = parseTotalRecoveryFrames(move.recovery);
      // Use helper for correct total (handles raw.total and startup-1 logic)
      const fillerFrames = getMoveTotalFrames(move); 
      const baseDelay = prefix.frames + fillerFrames;
      const delay = baseDelay + extraDelay;

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
        baseDelay,
        extraDelayFrames: extraDelay,
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
  let filtered = allThrowResults.value;
  if (comboChain.value.length > 0) {
    filtered = filtered.filter(result => {
      const fullText = `${result.prefix || ''} + ${result.fillerName || ''} + 投`.toLowerCase();
      return comboChain.value.every(action => {
        const actionName = action.name.toLowerCase();
        return fullText.includes(actionName);
      });
    });
  }

  const sorted = [...filtered].sort((a, b) => {
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

const visibleThrowResults = computed(() => {
  return throwResults.value.slice(0, MOBILE_RESULT_PREVIEW_COUNT);
});

type AltPrefixOption = {
  name: string;
  frames: number;
};

function getAltPrefixes(): AltPrefixOption[] {
  if (!stats.value) return [];
  return [
    { name: '', frames: 0 },
    { name: '前冲', frames: stats.value.forwardDash },
    { name: '前冲x2', frames: stats.value.forwardDash * 2 },
  ];
}

interface BurstPressureResult {
  key: string;
  prefix: string;
  prefixFrames: number;
  filler?: Move;
  fillerName: string;
  fillerFrames: number;
  fillerStartup?: number;
  fillerActive?: number;
  fillerRecovery?: number;
  baseDelay: number;
  extraDelayFrames: number;
  delay: number;
  firstActive: number;
  lastActive: number;
  wakeupOffset: number;
}

const burstTargetFirstActiveFrame = computed(() => {
  return opponentWakeupFrame.value + normalizedBurstPressureOffset.value - 1;
});

const burstTargetLastActiveFrame = computed(() => {
  return burstTargetFirstActiveFrame.value + BURST_ACTIVE_FRAMES - 1;
});

const burstRequiredDelay = computed(() => {
  return burstTargetFirstActiveFrame.value - BURST_STARTUP_FRAMES;
});



const allBurstPressureResults = computed<BurstPressureResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];
  if (burstRequiredDelay.value < 0) return [];

  const results: BurstPressureResult[] = [];
  const prefixes = getAltPrefixes();
  const targetDelay = burstRequiredDelay.value;
  const extraDelay = normalizedAltExtraDelay.value;

  for (const prefix of prefixes) {
    const baseDelay = prefix.frames;
    const directDelay = baseDelay + extraDelay;
    if (directDelay === targetDelay) {
      const firstActive = directDelay + BURST_STARTUP_FRAMES;
      results.push({
        key: `${prefix.name}|direct|${prefix.frames}`,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        fillerName: '直接迸放',
        fillerFrames: 0,
        baseDelay,
        extraDelayFrames: extraDelay,
        delay: directDelay,
        firstActive,
        lastActive: firstActive + BURST_ACTIVE_FRAMES - 1,
        wakeupOffset: firstActive - opponentWakeupFrame.value + 1,
      });
    }

    for (const move of throwFillerMoves.value) {
      const fillerStartup = parseInt(move.startup) || 0;
      const fillerActive = parseActiveWindowFrames(move.active);
      const fillerRecovery = parseTotalRecoveryFrames(move.recovery);
      const fillerFrames = getMoveTotalFrames(move);
      if (fillerFrames <= 0) continue;
      const baseDelay = prefix.frames + fillerFrames;
      const delay = baseDelay + extraDelay;
      if (delay !== targetDelay) continue;

      const firstActive = delay + BURST_STARTUP_FRAMES;
      results.push({
        key: `${prefix.name}|${prefix.frames}|${move.name}|${move.input}|${fillerFrames}`,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        filler: move,
        fillerName: getMoveDisplayName(move),
        fillerFrames,
        fillerStartup,
        fillerActive,
        fillerRecovery,
        baseDelay,
        extraDelayFrames: extraDelay,
        delay,
        firstActive,
        lastActive: firstActive + BURST_ACTIVE_FRAMES - 1,
        wakeupOffset: firstActive - opponentWakeupFrame.value + 1,
      });
    }
  }

  let filtered = results;
  if (comboChain.value.length > 0) {
    filtered = filtered.filter(result => {
      const fullText = `${result.prefix || ''} + ${result.fillerName || ''} + 迸放`.toLowerCase();
      return comboChain.value.every(action => {
        const actionName = action.name.toLowerCase();
        return fullText.includes(actionName);
      });
    });
  }

  return filtered
    .sort((a, b) => a.delay - b.delay || a.prefixFrames - b.prefixFrames)
    .slice(0, 50);
});

const visibleBurstPressureResults = computed(() => {
  return allBurstPressureResults.value.slice(0, MOBILE_RESULT_PREVIEW_COUNT);
});

interface FrameTrapResult {
  key: string;
  prefix: string;
  prefixFrames: number;
  filler?: Move;
  fillerName: string;
  fillerFrames: number;
  fillerStartup?: number;
  fillerActive?: number;
  fillerRecovery?: number;
  baseTotalFrames: number;
  extraDelayFrames: number;
  totalFrames: number;
  resultingAdvantage: number;
  deltaToTarget: number;
}



const allFrameTrapResults = computed<FrameTrapResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];

  const targetAdv = normalizedFrameTrapAdvTarget.value;
  const prefixes = getAltPrefixes();
  const results: FrameTrapResult[] = [];
  const extraDelay = normalizedAltExtraDelay.value;

  for (const prefix of prefixes) {
    const baseTotal = prefix.frames;
    const directTotal = baseTotal + extraDelay;
    const directAdv = effectiveKnockdownAdv.value - directTotal;
    if (directAdv === targetAdv) {
      results.push({
        key: `${prefix.name}|direct|${prefix.frames}`,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        fillerName: '无追加动作',
        fillerFrames: 0,
        baseTotalFrames: baseTotal,
        extraDelayFrames: extraDelay,
        totalFrames: directTotal,
        resultingAdvantage: directAdv,
        deltaToTarget: directAdv - targetAdv,
      });
    }

    for (const move of throwFillerMoves.value) {
      const fillerStartup = parseInt(move.startup) || 0;
      const fillerActive = parseActiveWindowFrames(move.active);
      const fillerRecovery = parseTotalRecoveryFrames(move.recovery);
      const fillerFrames = getMoveTotalFrames(move);
      if (fillerFrames <= 0) continue;
      const baseTotalFrames = prefix.frames + fillerFrames;
      const totalFrames = baseTotalFrames + extraDelay;
      const resultingAdvantage = effectiveKnockdownAdv.value - totalFrames;
      if (resultingAdvantage !== targetAdv) continue;

      results.push({
        key: `${prefix.name}|${prefix.frames}|${move.name}|${move.input}|${fillerFrames}`,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        filler: move,
        fillerName: getMoveDisplayName(move),
        fillerFrames,
        fillerStartup,
        fillerActive,
        fillerRecovery,
        baseTotalFrames,
        extraDelayFrames: extraDelay,
        totalFrames,
        resultingAdvantage,
        deltaToTarget: resultingAdvantage - targetAdv,
      });
    }
  }

  let filtered = results;
  if (comboChain.value.length > 0) {
    filtered = filtered.filter(result => {
      const fullText = `${result.prefix || ''} + ${result.fillerName || ''}`.toLowerCase();
      return comboChain.value.every(action => {
        const actionName = action.name.toLowerCase();
        return fullText.includes(actionName);
      });
    });
  }

  return filtered
    .sort((a, b) => a.totalFrames - b.totalFrames || a.prefixFrames - b.prefixFrames)
    .slice(0, 50);
});

const visibleFrameTrapResults = computed(() => {
  return allFrameTrapResults.value.slice(0, MOBILE_RESULT_PREVIEW_COUNT);
});

interface SafeBaitResult {
  key: string;
  prefix: string;
  prefixFrames: number;
  filler?: Move;
  fillerName: string;
  fillerFrames: number;
  fillerStartup?: number;
  fillerActive?: number;
  fillerRecovery?: number;
  baseTotalFrames: number;
  extraDelayFrames: number;
  totalFrames: number;
  strictLimitFrame: number;
  baitLimitFrame: number;
  safetyMargin: number;
}

const allSafeBaitResults = computed<SafeBaitResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];

  const results: SafeBaitResult[] = [];
  const prefixes = getAltPrefixes();
  const extraDelay = normalizedAltExtraDelay.value;
  const opponentStartup = normalizedOpponentReversalStartup.value;
  const strictLimitFrame = safeBaitStrictLimitFrame.value;
  const baitLimitFrame = safeBaitMaxTotalFrame.value;

  const pushResult = (result: Omit<SafeBaitResult, 'strictLimitFrame' | 'baitLimitFrame' | 'safetyMargin'>) => {
    if (!isSafeBaitTotalFrames({
      totalFrames: result.totalFrames,
      opponentWakeupFrame: opponentWakeupFrame.value,
      opponentMoveStartup: opponentStartup,
    })) {
      return;
    }

    results.push({
      ...result,
      strictLimitFrame,
      baitLimitFrame,
      safetyMargin: baitLimitFrame - result.totalFrames,
    });
  };

  for (const prefix of prefixes) {
    const directTotal = prefix.frames + extraDelay;
    pushResult({
      key: `${prefix.name}|direct|${prefix.frames}`,
      prefix: prefix.name,
      prefixFrames: prefix.frames,
      fillerName: '无追加动作',
      fillerFrames: 0,
      baseTotalFrames: prefix.frames,
      extraDelayFrames: extraDelay,
      totalFrames: directTotal,
    });

    for (const move of throwFillerMoves.value) {
      const fillerFrames = getMoveTotalFrames(move);
      if (fillerFrames <= 0) continue;

      const fillerStartup = parseInt(move.startup) || 0;
      const fillerActive = parseActiveWindowFrames(move.active);
      const fillerRecovery = parseTotalRecoveryFrames(move.recovery);
      const baseTotalFrames = prefix.frames + fillerFrames;
      const totalFrames = baseTotalFrames + extraDelay;

      pushResult({
        key: `${prefix.name}|${prefix.frames}|${move.name}|${move.input}|${fillerFrames}`,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        filler: move,
        fillerName: getMoveDisplayName(move),
        fillerFrames,
        fillerStartup,
        fillerActive,
        fillerRecovery,
        baseTotalFrames,
        extraDelayFrames: extraDelay,
        totalFrames,
      });
    }
  }

  let filtered = results;
  if (comboChain.value.length > 0) {
    filtered = filtered.filter(result => {
      const fullText = `${result.prefix || ''} + ${result.fillerName || ''} + 安全骗压`.toLowerCase();
      return comboChain.value.every(action => {
        const actionName = action.name.toLowerCase();
        return fullText.includes(actionName);
      });
    });
  }

  return filtered
    .sort((a, b) => a.safetyMargin - b.safetyMargin || b.totalFrames - a.totalFrames || a.prefixFrames - b.prefixFrames)
    .slice(0, 50);
});

const visibleSafeBaitResults = computed(() => {
  return allSafeBaitResults.value.slice(0, MOBILE_RESULT_PREVIEW_COUNT);
});

interface DriveRushOkiResult {
  key: string;
  prefix: string;
  prefixFrames: number;
  extraDelayFrames: number;
  driveRushStartDelay: number;
  attackStartFrame: number;
  move: Move;
  startup: number;
  fastestHitFrame: number;
  firstActive: number;
  lastActive: number;
  wakeupOffset: number;
  toleranceFrames?: number;
  coversOpponent: boolean;
  isTrade: boolean;
  activeDisplayStartOffset: number;
  activeDisplayLength: number;
  activeHasGap: boolean;
  activeHasMultipleSegments: boolean;
  activeHitTotal: number;
  meatyStartFrame: number;
  meatyStartOffset: number;
  meatyLength: number;
  meatyBonus: number;
  effectiveHitFrame: number;
  driveRushAdvantageBonus: number;
  calculatedOnBlock?: number | string;
  calculatedOnHit?: number | string;
}

function isDriveRushAdvantageMove(move: Move): boolean {
  return move.category === 'normal' || move.category === 'unique';
}

function getDriveRushAdvantageBonus(move: Move): number {
  return isDriveRushAdvantageMove(move) ? DRIVE_RUSH_FRAME_ADVANTAGE_BONUS : 0;
}

const allDriveRushOkiResults = computed<DriveRushOkiResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];

  const results: DriveRushOkiResult[] = [];
  const keyCounts = new Map<string, number>();
  const prefixes = getAltPrefixes();
  const extraDelay = normalizedAltExtraDelay.value;
  const oppFirst = opponentFirstActiveFrame.value;
  const oppWindowStart = opponentWakeupFrame.value;
  const oppWindowEnd = opponentPreActiveEnd.value;
  const hasPreActiveWindow = oppWindowEnd >= oppWindowStart;

  for (const prefix of prefixes) {
    for (const move of driveRushFollowUpMoves.value) {
      const startup = getDriveRushMoveStartup(move) ?? 0;
      if (startup <= 0) continue;

      const activeInfo = parseActiveSegments(move.active);
      const activeHasGap = activeInfo.gaps.length > 0;
      const activeHasMultipleSegments = activeInfo.segments.length > 1;
      const activeHitTotal = parseTotalActiveFrames(move.active);
      const activeDisplayStartOffset = activeHasGap ? activeInfo.lastSegmentStartOffset : 0;
      const activeDisplayLength = activeHasGap ? activeInfo.lastSegmentLength : activeHitTotal;
      const meatyStartOffset = activeHasMultipleSegments ? activeInfo.lastSegmentStartOffset : 0;
      const meatyLength = activeHasMultipleSegments ? activeInfo.lastSegmentLength : activeHitTotal;

      const driveRushStartDelay = prefix.frames + extraDelay;
      const timing = calculateDriveRushAttackTiming({
        driveRushStartFrame: driveRushStartDelay,
        moveStartup: startup,
        activeStartOffset: activeDisplayStartOffset,
        activeLength: activeDisplayLength,
      });
      const attackStartFrame = timing.attackStartFrame;
      const fastestHitFrame = timing.fastestHitFrame;
      const firstActive = timing.firstActiveFrame;
      const lastActive = timing.lastActiveFrame;

      const overlapsPreActive =
        hasPreActiveWindow && lastActive >= oppWindowStart && firstActive <= oppWindowEnd;
      const overlapsOppFirst = firstActive <= oppFirst && lastActive >= oppFirst;
      const isSuccessMatch = overlapsPreActive;
      const isTradeMatch = overlapsOppFirst && !overlapsPreActive;

      if (!isSuccessMatch && !isTradeMatch) continue;

      const meatyStartFrame = fastestHitFrame + meatyStartOffset;
      const effectiveHitFrame = Math.max(meatyStartFrame, oppWindowStart);
      const canApplyMeaty = !move.noMeaty;
      const meatyBonus = canApplyMeaty ? (effectiveHitFrame - meatyStartFrame) : 0;
      const driveRushAdvantageBonus = getDriveRushAdvantageBonus(move);
      const toleranceFrames = isSuccessMatch ? Math.max(0, oppWindowEnd - firstActive) : undefined;

      let calcBlock: number | string | undefined;
      let calcHit: number | string | undefined;

      const baseBlock = parseFrameAdvantage(move.onBlock);
      if (baseBlock !== null) {
        calcBlock = baseBlock + driveRushAdvantageBonus + meatyBonus;
      } else {
        calcBlock = move.onBlock;
      }

      const baseHit = parseFrameAdvantage(move.onHit);
      if (baseHit !== null) {
        const chBonus = isSuccessMatch ? 2 : 0;
        calcHit = baseHit + driveRushAdvantageBonus + meatyBonus + chBonus;
      } else {
        calcHit = move.onHit;
      }

      const baseKey = buildOkiResultKeyBase({
        prefixName: `${prefix.name}|DR`,
        prefixFrames: driveRushStartDelay,
        moveName: move.name,
        moveInput: move.input,
        ourActiveStart: firstActive,
        ourActiveEnd: lastActive,
      });
      const key = getUniqueOkiResultKey(baseKey, keyCounts);

      results.push({
        key,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        extraDelayFrames: extraDelay,
        driveRushStartDelay,
        attackStartFrame,
        move,
        startup,
        fastestHitFrame,
        firstActive,
        lastActive,
        wakeupOffset: firstActive - opponentWakeupFrame.value + 1,
        toleranceFrames,
        coversOpponent: isSuccessMatch,
        isTrade: isTradeMatch,
        activeDisplayStartOffset,
        activeDisplayLength,
        activeHasGap,
        activeHasMultipleSegments,
        activeHitTotal,
        meatyStartFrame,
        meatyStartOffset,
        meatyLength,
        meatyBonus,
        effectiveHitFrame,
        driveRushAdvantageBonus,
        calculatedOnBlock: calcBlock,
        calculatedOnHit: calcHit,
      });
    }
  }

  let filtered = results;
  if (comboChain.value.length > 0) {
    filtered = filtered.filter(result => {
      const fullText = `绿冲 + ${result.prefix || ''} + ${getMoveDisplayName(result.move) || ''} + ${result.move.name || ''} + ${result.move.nameZh || ''}`.toLowerCase();
      return comboChain.value.every(action => {
        const actionName = action.name.toLowerCase();
        return fullText.includes(actionName);
      });
    });
  }

  return filtered
    .sort((a, b) => {
      if (a.coversOpponent !== b.coversOpponent) return a.coversOpponent ? -1 : 1;
      return a.firstActive - b.firstActive || a.startup - b.startup;
    })
    .slice(0, 50);
});

const visibleDriveRushOkiResults = computed(() => {
  return allDriveRushOkiResults.value.slice(0, MOBILE_RESULT_PREVIEW_COUNT);
});

// Search and dropdown logic for bait initiator and defender bait reversal
const filteredBaitInitiators = computed<Move[]>(() => {
  if (!allMoves.value) return [];
  const queryRaw = baitInitiatorSearchQuery.value.trim();
  const queryLower = queryRaw.toLowerCase();
  if (!queryRaw) return allMoves.value.slice(0, 30);

  return allMoves.value.filter((m: Move) =>
    m.name.toLowerCase().includes(queryLower) ||
    (m.nameZh && m.nameZh.includes(queryRaw)) ||
    (m.input && m.input.toLowerCase().includes(queryLower))
  ).slice(0, 30);
});

function selectBaitInitiator(move: Move) {
  selectedBaitInitiator.value = move;
  baitInitiatorSearchQuery.value = getMoveDisplayName(move);
  showBaitInitiatorDropdown.value = false;
}

watch(selectedBaitInitiator, (newVal) => {
  if (newVal) {
    baitInitiatorSearchQuery.value = getMoveDisplayName(newVal);
  } else {
    baitInitiatorSearchQuery.value = '';
  }
});

function handleBaitInitiatorBlur() {
  setTimeout(() => showBaitInitiatorDropdown.value = false, 200);
}

const filteredDefenderBaitMoves = computed<Move[]>(() => {
  if (!defenderMoves.value) return [];
  const queryRaw = defenderBaitSearchQuery.value.trim();
  const queryLower = queryRaw.toLowerCase();
  if (!queryRaw) return defenderMoves.value.slice(0, 30);

  return defenderMoves.value.filter((m: Move) =>
    m.name.toLowerCase().includes(queryLower) ||
    (m.nameZh && m.nameZh.includes(queryRaw)) ||
    (m.input && m.input.toLowerCase().includes(queryLower))
  ).slice(0, 30);
});

function selectDefenderBaitMove(move: Move) {
  selectedDefenderBaitMove.value = move;
  defenderBaitSearchQuery.value = getMoveDisplayName(move);
  showDefenderBaitDropdown.value = false;
}

watch(selectedDefenderBaitMove, (newVal) => {
  if (newVal) {
    defenderBaitSearchQuery.value = getMoveDisplayName(newVal);
  } else {
    defenderBaitSearchQuery.value = '';
  }
});

function handleDefenderBaitBlur() {
  setTimeout(() => showDefenderBaitDropdown.value = false, 200);
}

// Bait Throw calculation
const baitThrowResult = computed(() => {
  if (!attackerFrameData.value) return null;

  // Attacker move info
  const move1 = selectedBaitInitiator.value;
  if (!move1) return null;

  const stats1 = calculateMoveStats(move1);
  const blockstun1 = stats1.blockstun;
  const onBlock1 = parseFrameValue(move1.onBlock);

  // Is cancelled into Drive Rush?
  const isDRC = isBaitInitiatorDRC.value;

  // Defender action info
  const isCustomGrab = defenderBaitReactionType.value === 'throw';
  let grabName = '普通拆投';
  let grabInput = 'LP+LK';
  let grabStartup = 5;
  let grabRecovery = 50;
  let grabTotal = 53;

  if (!isCustomGrab && selectedDefenderBaitMove.value) {
    const move2 = selectedDefenderBaitMove.value;
    grabName = getMoveDisplayName(move2);
    grabInput = move2.input;
    grabStartup = parseInt(move2.startup) || 5;
    
    // Get total frames
    const totalFrames = getMoveTotalFrames(move2);
    grabTotal = totalFrames > 0 ? totalFrames : (grabStartup + 50);
    grabRecovery = grabTotal - grabStartup;
  } else {
    grabStartup = defenderBaitCustomStartup.value;
    grabRecovery = defenderBaitCustomWhiffRecovery.value;
    grabTotal = grabStartup + grabRecovery;
  }

  // Bait action info
  const baitAction = selectedBaitAction.value; // 'jump' | 'backdash'
  let baitName = baitAction === 'jump' ? '垂直跳' : '后撤步';
  let baitDuration = 45; // default jump
  if (baitAction === 'backdash' && stats.value) {
    baitDuration = stats.value.backDash;
  } else if (baitAction === 'backdash') {
    baitDuration = 23;
  }

  // Calculations relative to opponent recovery at Frame 0:
  // - If direct (no DRC): defender recovers on Blockstun1. Attacker recovers on Blockstun1 - OnBlock1.
  //   Relative start frame of bait action is: (Blockstun1 - OnBlock1) - Blockstun1 = -OnBlock1.
  // - If DRC: attacker starts jump on Frame 11 of the run. Defender recovers on Blockstun1.
  //   Relative start frame of bait action is: 11 - Blockstun1.
  const relativeBaitStart = isDRC ? (11 - blockstun1) : -onBlock1;

  // Let's set 1-based index where 1 is the defender's first recovery frame:
  // Defender recovering frame is Frame 1.
  // Grab active frame is Frame `grabStartup` (since startup 5 means it hits on 5th frame).
  const F_opp_act = 1;
  const F_grab_active = grabStartup;
  const F_bait_start = relativeBaitStart + 1;

  // Is the attacker immune when the grab becomes active?
  let isSafe = false;
  let safetyReason = '';

  if (baitAction === 'jump') {
    const F_airborne = F_bait_start + 4; // pre-jump is 4 frames (F_bait_start to F_bait_start+3)
    isSafe = F_grab_active >= F_bait_start;
    if (isSafe) {
      if (F_grab_active >= F_airborne) {
        safetyReason = `完全安全：对方在第 ${F_grab_active} 帧出招，我方在第 ${F_airborne} 帧已处于空中状态，投掷必定挥空。`;
      } else {
        safetyReason = `投掷安全（防抢招）：对方在第 ${F_grab_active} 帧投掷，我方正处于起跳预备帧（第 ${F_bait_start} 至 ${F_airborne - 1} 帧），享有完全的投无敌，投掷必定挥空。`;
      }
    } else {
      safetyReason = `不安全被确反：我方收招过慢，起跳动作还未开始（第 ${F_bait_start} 帧）就已经被对方投掷判定命中（第 ${F_grab_active} 帧）。`;
    }
  } else {
    // Backdash
    const F_invul_end = F_bait_start + 16; // 17 frames of invul
    isSafe = F_grab_active >= F_bait_start && F_grab_active <= F_invul_end;
    if (isSafe) {
      safetyReason = `后撤步安全：对方在第 ${F_grab_active} 帧投掷，我方处于后撤步投无敌时间（第 ${F_bait_start} 至 ${F_invul_end} 帧），投掷必定挥空。`;
    } else if (F_grab_active < F_bait_start) {
      safetyReason = `不安全被确反：我方收招过慢，后撤步动作还未开始就已经被对方投掷判定命中。`;
    } else {
      safetyReason = `可能不安全：对方判定在第 ${F_grab_active} 帧生效，已超出后撤步的投无敌时间。`;
    }
  }

  // Punish frame advantage calculation
  const F_attacker_recover = F_bait_start + baitDuration;
  const F_defender_recover = F_opp_act + grabTotal - 1;
  const punishAdvantage = F_defender_recover - F_attacker_recover;

  return {
    move1,
    isDRC,
    blockstun1,
    onBlock1,
    grabName,
    grabInput,
    grabStartup,
    grabRecovery,
    grabTotal,
    baitName,
    baitDuration,
    F_bait_start,
    F_opp_act,
    F_grab_active,
    isSafe,
    safetyReason,
    F_attacker_recover,
    F_defender_recover,
    punishAdvantage,
  };
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
      
      // Set default bait initiator to 5HP or first normal
      const normals = module.default.moves.filter((m: Move) => m.category === 'normal');
      const hp5 = normals.find((m: Move) => m.input === '5HP');
      selectedBaitInitiator.value = hp5 || normals[0] || null;
    } else {
      defenderFrameData.value = module.default;
      selectedDefenderMove.value = null;
      
      // Set default defender bait move (SA3, or first super)
      const supers = module.default.moves.filter((m: Move) => m.category === 'super');
      const sa3 = supers.find((m: Move) => m.name.includes('SA3') || (m.input && m.input.includes('720')) || m.name.includes('Storm Buster'));
      selectedDefenderBaitMove.value = sa3 || supers[0] || null;
    }
  } catch (e) {
    console.error(`Failed to load character data for ${charId}:`, e);
    if (role === 'attacker') attackerFrameData.value = null;
    else defenderFrameData.value = null;
  } finally {
    loading.value = false;
  }
}

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

function addDriveRush() {
  comboChain.value.push({
    type: 'driveRush',
    name: '绿冲',
    frames: PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME,
  });
}

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

function addEmptyJump() {
  comboChain.value.push({
    type: 'dash',
    name: '空跳',
    frames: 45,
  });
}

function addJumpAction() {
  comboChain.value.push({
    type: 'dash',
    name: '跳跃 + 动作',
    frames: 46,
  });
}

function addMove(move: Move) {
  if (isAirborneMove(move)) return;
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

function canAddDriveRushMove(move: Move): boolean {
  return !isComboSequenceMove(move) && isDriveRushFollowUpMove(move);
}

function addDriveRushMove(move: Move) {
  if (!canAddDriveRushMove(move)) return;
  const startup = getDriveRushMoveStartup(move);
  if (startup === null || startup <= 0) return;
  const active = parseActiveWindowFrames(move.active);
  comboChain.value.push({
    type: 'driveRush',
    name: `绿冲${move.name}`,
    frames: getFastestDriveRushHitFrame(startup),
    active,
    move,
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

  // Calculate Attacker Duration
  // Prefix + Startup + Active + Recovery
  const total = Math.max(result.recoverFrame, result.effectiveHitFrame ?? result.ourActiveEnd);

  // Also consider Defender's interaction to extend timeline if needed? 
  // For Attacker Row, just show functionality.
  // Actually, we should align lengths across rows for grid perfection.
  // But let's let CSS handle alignment (width). 
  // We'll generate up to Attacker's End for now.

  const activeStart = result.projectileOki
    ? result.effectiveHitFrame ?? result.ourActiveStart
    : prefixFrames + startup;
  const activeEnd = result.projectileOki
    ? activeStart
    : prefixFrames + startup + active - 1;


  for (let i = 1; i <= total; i++) {
    const globalFrame = i;

    let type: TimelineFrame['type'];

    if (result.projectileOki && i === activeStart) {
      type = 'active';
    } else if (i <= prefixFrames) {
      type = 'prefix';
    } else if (i > result.recoverFrame) {
      type = 'neutral';
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
  const attackerEnd = result.recoverFrame;

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
  if (val === undefined || val === null) return false;
  if (typeof val === 'number') return val >= 0;
  const parsed = parseInt(String(val), 10);
  return !isNaN(parsed) && parsed >= 0;
}

function isNegative(val: number | string | undefined): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === 'number') return val < 0;
  const parsed = parseInt(String(val), 10);
  return !isNaN(parsed) && parsed < 0;
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

function formatFrameDelta(val: number): string {
  return `${val >= 0 ? '+' : ''}${val}F`;
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

      <div class="preset-toolbar">
        <input
          type="text"
          v-model="knockdownSearchQuery"
          class="preset-search-input"
          placeholder="搜索击倒招式 / 指令 / 帧数..."
        />
        <button
          v-if="knockdownSearchQuery"
          type="button"
          class="preset-tool-btn"
          @click="knockdownSearchQuery = ''"
        >
          清除
        </button>
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
        <button v-for="move in visibleKnockdownMoves" :key="`${move.name}-${move.input}`"
          :class="['knockdown-card', { active: isSelectedKnockdown(move) }]"
          @click="selectKnockdownMove(move)">
          <span class="move-name">{{ getMoveDisplayName(move) }}</span>
          <span class="move-input">{{ move.input }}</span>
          <span class="move-advantage" v-if="move.knockdown">+{{ parseKnockdownAdvantage(move) }}F</span>
        </button>
      </div>
      <div v-if="filteredKnockdownMoves.length === 0" class="empty-inline">
        没有匹配的击倒预设
      </div>
      <button
        v-if="hiddenKnockdownPresetCount > 0 && !hasKnockdownPresetFilter"
        type="button"
        class="show-more-btn"
        @click="showAllKnockdownPresets = true"
      >
        展开其余 {{ hiddenKnockdownPresetCount }} 个预设
      </button>
      <button
        v-else-if="showAllKnockdownPresets && !hasKnockdownPresetFilter && filteredKnockdownMoves.length > KNOCKDOWN_PRESET_PREVIEW_COUNT"
        type="button"
        class="show-more-btn"
        @click="showAllKnockdownPresets = false"
      >
        收起预设
      </button>
    </section>

    <!-- Step 3: Combo Builder -->
    <section v-if="effectiveKnockdownAdv > 0 && attackerFrameData" class="oki-section results-section">
      <h2 class="section-title">
        <span class="step-number">3</span>
        动作过滤与匹配 (Oki Routing)
      </h2>

      <!-- Opponent Info & Settings -->
      <div class="opponent-info" style="display:block">
        <div class="mb-2">
          <strong>对手反击判定第一帧 (Reversal Active):</strong>
          {{ effectiveKnockdownAdv }} (击倒) + {{ normalizedOpponentReversalStartup }} (发生) =
          <strong class="frame-negative">{{ opponentFirstActiveFrame }}F</strong>
        </div>
        <div class="mb-2">
          <strong>起身斗反:</strong>
          {{ WAKEUP_DRIVE_REVERSAL.startup }}F 生效，{{ wakeupDriveReversalInvulStartFrame }}~{{ wakeupDriveReversalInvulEndFrame }}F 无敌，
          安全压制需恢复帧 ≤ <strong class="frame-negative">{{ wakeupDriveReversalImpactFrame }}F</strong>
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

      <div class="combo-builder">
        <div class="combo-builder-title">过滤动作</div>
        <div class="combo-chain">
          <div v-for="(action, idx) in comboChain" :key="idx" class="chain-item">
            <span class="chain-name">{{ getActionDisplayName(action) }}</span>
            <span class="chain-frames">{{ action.frames }}F</span>
            <button class="chain-remove" @click="removeAction(idx)">×</button>
            <span v-if="idx < comboChain.length - 1" class="chain-plus">+</span>
          </div>
          <span v-if="comboChain.length === 0" class="chain-empty">点击下方添加过滤动作</span>
        </div>



        <div class="combo-actions">
          <button class="action-btn dash-btn" @click="addDash">
            + 前冲 ({{ stats?.forwardDash }}F)
          </button>
          <button class="action-btn dash-btn" @click="addEmptyJump">
            + 空跳 (45F)
          </button>
          <button class="action-btn dash-btn" @click="addJumpAction">
            + 跳跃 + 动作 (46F)
          </button>
          <button class="action-btn dash-btn" @click="addDriveRush">
            + 绿冲 ({{ PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME }}F)
          </button>
          <div class="move-search">
            <input type="text" v-model="moveSearchQuery" placeholder="搜索招式..." class="move-search-input" />
            <div v-if="moveSearchQuery" class="move-dropdown">
              <div v-for="move in filteredMoves" :key="`${move.name}-${move.input}`" class="move-option-row">
                <button class="move-option" @click="addMove(move)">
                  <span>{{ getMoveDisplayName(move) }}</span>
                  <span class="move-input">{{ move.input }}</span>
                  <span>{{ move.startup }}F</span>
                </button>
                <button
                  v-if="canAddDriveRushMove(move)"
                  class="move-option-dr"
                  @click="addDriveRushMove(move)"
                >
                  DR {{ getFastestDriveRushHitFrame(getDriveRushMoveStartup(move) ?? 0) }}F
                </button>
              </div>
            </div>
          </div>
          <button v-if="comboChain.length > 0" class="action-btn clear-btn" @click="clearCombo">
            清空
          </button>
        </div>
      </div>

      <!-- Exclude Last-Hit Moves (Personal Preference) -->
      <div class="exclude-moves-section">
        <div class="exclude-moves-title">排除最后招式 (个人喜好)</div>
        <p class="exclude-moves-desc">不想让某个招式作为 Oki 压制的最后一击（例如 5HK 不能打蹲防）。</p>
        <div class="exclude-moves-list">
          <div v-for="em in excludedMoves.filter(m => m.characterId === attackerCharId)" :key="em.id" class="exclude-move-tag">
            <span class="exclude-move-name">{{ em.moveInput || em.moveName }}</span>
            <span v-if="em.note" class="exclude-move-note" :title="em.note">({{ em.note }})</span>
            <button class="exclude-move-remove" @click="removeExcludedMove(em.id)">×</button>
          </div>
          <span v-if="excludedMoves.filter(m => m.characterId === attackerCharId).length === 0" class="exclude-moves-empty">
            暂无排除招式，在下方搜索添加
          </span>
        </div>
        <div class="exclude-moves-add">
          <div class="move-search" style="flex:1; min-width:150px">
            <input
              type="text"
              v-model="newExcludedMoveInput"
              placeholder="搜索招式（如 5HK）..."
              class="move-search-input"
              style="font-size: 0.8rem;"
            />
            <div v-if="newExcludedMoveInput" class="move-dropdown">
              <button
                v-for="item in getFilteredMovesForDropdown(newExcludedMoveInput)"
                :key="`excl-${item.input}-${item.name}`"
                class="move-option text-xs"
                @click="addExcludedMove(item.name, item.input)"
              >
                <span>{{ item.displayName }}</span>
                <span class="move-input text-xs" v-if="item.input !== item.displayName">{{ item.input }}</span>
              </button>
            </div>
          </div>
          <input
            type="text"
            v-model="newExcludedMoveNote"
            placeholder="备注（可选，如：不能打蹲防）"
            class="small-input"
            style="flex:1; min-width:120px; font-size:0.8rem;"
          />
          <button
            v-if="newExcludedMoveInput"
            class="action-btn"
            style="background: var(--color-danger); color: #fff; white-space: nowrap;"
            @click="addExcludedMove(newExcludedMoveInput, newExcludedMoveInput)"
          >
            手动添加
          </button>
        </div>
      </div>

      <!-- Preferred Moves (Personal Preference) -->
      <div class="preferred-moves-section">
        <div class="preferred-moves-title">优先展示招式 (个人喜好)</div>
        <p class="preferred-moves-desc">若组合中包含以下任一喜好招式，会优先在结果顶部展示。比如添加：2MK、236MK。</p>
        <div class="preferred-moves-list">
          <div v-for="pm in preferredMoves.filter(m => m.characterId === attackerCharId)" :key="pm.id" class="preferred-move-tag">
            <span class="preferred-move-name">{{ pm.moveInput || pm.moveName }}</span>
            <span v-if="pm.note" class="preferred-move-note" :title="pm.note">({{ pm.note }})</span>
            <button class="preferred-move-remove" @click="removePreferredMove(pm.id)">×</button>
          </div>
          <span v-if="preferredMoves.filter(m => m.characterId === attackerCharId).length === 0" class="preferred-moves-empty">
            暂无优先招式，在下方搜索添加
          </span>
        </div>
        <div class="preferred-moves-add">
          <div class="move-search" style="flex:1; min-width:150px">
            <input
              type="text"
              v-model="newPreferredMoveInput"
              placeholder="搜索招式（如 2MK）..."
              class="move-search-input"
              style="font-size: 0.8rem;"
            />
            <div v-if="newPreferredMoveInput" class="move-dropdown">
              <button
                v-for="item in getFilteredMovesForDropdown(newPreferredMoveInput)"
                :key="`pref-${item.input}-${item.name}`"
                class="move-option text-xs"
                @click="addPreferredMove(item.name, item.input)"
              >
                <span>{{ item.displayName }}</span>
                <span class="move-input text-xs" v-if="item.input !== item.displayName">{{ item.input }}</span>
              </button>
            </div>
          </div>
          <input
            type="text"
            v-model="newPreferredMoveNote"
            placeholder="备注（可选，如：核心连招）"
            class="small-input"
            style="flex:1; min-width:120px; font-size:0.8rem;"
          />
          <button
            v-if="newPreferredMoveInput"
            class="action-btn"
            style="background: #fbbf24; color: #1e1b4b; white-space: nowrap;"
            @click="addPreferredMove(newPreferredMoveInput, newPreferredMoveInput)"
          >
            手动添加
          </button>
        </div>
        <div class="preferred-filter-toggle">
          <label class="flex items-center cursor-pointer" style="gap: 8px;">
            <input
              type="checkbox"
              v-model="onlyShowPreferred"
            />
            <span>仅显示包含喜好招式的组合 (只筛选这种)</span>
          </label>
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
             <div v-if="comboChain.length > 0" class="filter-active-badge" title="已根据上方的过滤动作筛选结果">
               <span class="icon">✨</span>
               已启用动作筛选
             </div>
          </div>
        </div>
      </div>
      <div class="auto-match-notes">
        <span class="note-item">排序规则：优先显示被防有利 (On Block) 的压制，其次为发生更快（发生F 更小）。</span>
        <span class="note-item">容错：当前招式“最晚可以延迟几帧”仍能压制（0 表示必须精准卡帧）。</span>
        <span class="note-item">防斗反：我方恢复帧不晚于起身斗反第 {{ WAKEUP_DRIVE_REVERSAL.startup }}F 生效帧。</span>
        <span class="note-item">仅显示前 50 条最优解。</span>
      </div>
      <!-- Removed separate text info as it's now in the button state -->

      <div v-if="okiResults.length > 0">
        <!-- Desktop Results Table -->
        <div class="desktop-results-table results-table">
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
            <span>安全</span>
            <span class="sortable-header" @click="toggleSort('block')">
              被防
              <span v-if="sortKey === 'block'" class="sort-indicator">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span>
            </span>
            <span class="sortable-header" @click="toggleSort('hit')">
              被击打康加2
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
            trade: result.isTrade,
            'preferred-row': result.isPreferred
          }]" @click="toggleResultDetail(result.key)">
            <div class="result-combo">
              <span v-if="result.isPreferred" class="preferred-badge">★ 喜好</span>
              <span v-if="result.coversOpponent" class="success-badge">压制</span>
              <span v-if="result.isTrade" class="trade-badge">相杀</span>
              <span v-if="result.isChainCancel" class="chain-cancel-badge">连锁取消 Chain Cancel</span>
              <span v-if="result.tags && result.tags.length > 0" class="tag-badge">{{ result.tags.join(', ') }}</span>
              <span v-if="result.prefix" class="combo-prefix">{{ result.prefix }}</span>
              <span v-if="result.prefix">+</span>
              <span>{{ getMoveDisplayName(result.move) }}</span>
              <span class="move-input">{{ result.move.input }}</span>
            </div>
            <span>{{ result.prefixFrames + parseInt(result.move.startup) }}F</span>
            <span>{{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F</span>
            <span>{{ formatTolerance(result.toleranceFrames) }}</span>
            <span>
              <span v-if="result.safeAgainstWakeupDriveReversal" class="safe-dr-badge">防斗反</span>
              <span v-else>-</span>
            </span>
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
                <span class="detail-label">动作序列:</span>
                <span>
                  {{ result.prefix || '无' }}
                  <span v-if="result.prefixInput"> ({{ result.prefixInput }})</span>
                  = {{ result.prefixFrames }}F
                  <span v-if="result.isDriveRush">有效偏移</span>
                </span>
              </div>
              <div class="detail-row calc" v-if="result.isChainCancel">
                <span class="detail-label">连锁取消公式:</span>
                <span>
                  <template v-if="result.chainCancelStepFrames && result.chainCancelMoveInputs && result.chainCancelStepFrames.length === result.chainCancelMoveInputs.length">
                    <span v-for="(f, i) in result.chainCancelStepFrames" :key="i">
                      <span v-if="i > 0"> + </span>
                      {{ f }}F<span v-if="i === 0"> ({{ result.chainCancelMoveInputs[i] }}首招)</span><span v-else> ({{ result.chainCancelMoveInputs[i] }})</span>
                    </span>
                    = {{ result.prefixFrames }}F
                  </template>
                  <template v-else>
                    首招完整 {{ result.chainCancelMoveTotalFrames }}F
                    + {{ result.chainCancelOffset }}F × ({{ result.chainCancelSteps }} − 1)步
                    = {{ result.prefixFrames }}F
                  </template>
                  <em>（跳过发生帧, 截短收招 1 帧）</em>
                </span>
              </div>
              <div class="detail-row" v-if="result.isDriveRush">
                <span class="detail-label">绿冲起点:</span>
                <span>{{ result.sourcePrefixName || '无前置' }} = {{ result.sourcePrefixFrames ?? 0 }}F</span>
              </div>
              <div class="detail-row" v-if="result.isDriveRush">
                <span class="detail-label">动作开始:</span>
                <span>{{ result.sourcePrefixFrames ?? 0 }} + {{ PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME }} = {{ result.driveRushAttackStartFrame }}F</span>
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
                <span v-if="result.isDriveRush">
                  {{ result.sourcePrefixFrames ?? 0 }} + {{ PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME }} + {{ result.move.startup }}
                  <span v-if="result.activeDisplayStartOffset && result.activeDisplayStartOffset > 0">
                    + {{ result.activeDisplayStartOffset }}
                  </span>
                  = {{ result.ourActiveStart }}F
                </span>
                <span v-else>
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
                <span class="detail-label">防斗反:</span>
                <span v-if="result.projectileOki">
                  本体恢复 {{ result.recoverFrame }}F
                  = {{ result.prefixFrames }} + {{ result.projectileOki.totalFrames }} (波动拳本体总帧)
                  ；斗反生效 {{ wakeupDriveReversalImpactFrame }}F
                  <span
                    :class="{ 'frame-positive': result.safeAgainstWakeupDriveReversal, 'frame-negative': !result.safeAgainstWakeupDriveReversal }"
                  >
                    {{ result.safeAgainstWakeupDriveReversal ? `可防，余量 ${formatFrameDelta(result.driveReversalSafetyMargin)}` : `不可防，差 ${formatFrameDelta(result.driveReversalSafetyMargin)}` }}
                  </span>
                </span>
                <span v-else>
                  恢复 {{ result.recoverFrame }}F
                  = {{ result.prefixFrames }} + {{ result.move.startup }} + {{ result.activeWindowFrames }} + {{ result.recoveryFrames }}
                  ；斗反生效 {{ wakeupDriveReversalImpactFrame }}F
                  <span
                    :class="{ 'frame-positive': result.safeAgainstWakeupDriveReversal, 'frame-negative': !result.safeAgainstWakeupDriveReversal }"
                  >
                    {{ result.safeAgainstWakeupDriveReversal ? `可防，余量 ${formatFrameDelta(result.driveReversalSafetyMargin)}` : `不可防，差 ${formatFrameDelta(result.driveReversalSafetyMargin)}` }}
                  </span>
                </span>
              </div>
              <div class="detail-row calc">
                <span class="detail-label">被防计算:</span>
                <span v-if="result.projectileOki">
                  {{ result.projectileOki.blockFrameFromInput }} (输入到被防)
                  + {{ result.projectileOki.blockstun }} (防御硬直)
                  - {{ result.projectileOki.totalFrames }} (本体总帧)
                  = <span
                    :class="{ 'frame-positive': isPositive(result.calculatedOnBlock), 'frame-negative': isNegative(result.calculatedOnBlock) }">{{
                      formatFrame(result.calculatedOnBlock) }}</span>
                </span>
                <span v-else>
                  {{ result.move.onBlock }} (原始)
                  <span v-if="result.driveRushAdvantageBonus && result.driveRushAdvantageBonus > 0" class="meaty-bonus-highlight">
                    + {{ result.driveRushAdvantageBonus }} (绿冲)
                  </span>
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
                  <span v-if="result.driveRushAdvantageBonus && result.driveRushAdvantageBonus > 0" class="meaty-bonus-highlight">
                    + {{ result.driveRushAdvantageBonus }} (绿冲)
                  </span>
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

              <button type="button" class="detail-toggle-btn" @click.stop="showResultTimeline = !showResultTimeline">
                {{ showResultTimeline ? '隐藏时序图' : '查看时序图' }}
              </button>

              <!-- Timeline UI (Multi-Row View) -->
              <div v-if="showResultTimeline" class="timeline-wrapper">
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

        <!-- Mobile Results Cards -->
        <div class="mobile-results-list">
          <div
            v-for="result in visibleOkiResults"
            :key="'mob-step3-' + result.key"
            :class="['mobile-result-card', {
              expanded: selectedResultKey === result.key,
              success: result.coversOpponent,
              trade: result.isTrade,
              'preferred-card': result.isPreferred
            }]"
            @click="toggleResultDetail(result.key)"
          >
            <div class="card-header">
              <div class="card-combo-title">
                <span v-if="result.isPreferred" class="preferred-badge" style="vertical-align: middle;">★ 喜好</span>
                <span v-if="result.prefix" class="mob-prefix">{{ result.prefix }}</span>
                <span v-if="result.prefix" class="mob-plus">+</span>
                <span class="mob-move-name">{{ getMoveDisplayName(result.move) }}</span>
                <span class="mob-move-input">({{ result.move.input }})</span>
              </div>
              <span class="mob-expand-chevron" :class="{ rotated: selectedResultKey === result.key }">▼</span>
            </div>

            <div class="card-tags-row">
              <span v-if="result.isPreferred" class="badge-mini" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; border-color: rgba(251, 191, 36, 0.3)">★ 喜好</span>
              <span v-if="result.coversOpponent" class="badge-mini success">压制成功</span>
              <span v-if="result.isTrade" class="badge-mini trade">相杀</span>
              <span v-if="result.safeAgainstWakeupDriveReversal" class="badge-mini safe-dr">防斗反</span>
              <span class="badge-mini frame font-mono">发生: {{ result.prefixFrames + parseInt(result.move.startup) }}F</span>
              <span class="badge-mini frame font-mono">打击: {{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F</span>
              <span class="badge-mini frame font-mono">容错: {{ formatTolerance(result.toleranceFrames) }}</span>
              <span :class="['badge-mini', 'frame', 'font-mono', isPositive(result.calculatedOnBlock) ? 'green' : (isNegative(result.calculatedOnBlock) ? 'red' : '')]">
                被防: {{ formatFrame(result.calculatedOnBlock) }}
              </span>
              <span :class="['badge-mini', 'frame', 'font-mono', isPositive(result.calculatedOnHit) ? 'green' : (isNegative(result.calculatedOnHit) ? 'red' : '')]">
                打康: {{ formatFrame(result.calculatedOnHit) }}
              </span>
            </div>

            <!-- Mobile Expanded Details Panel -->
            <div v-if="selectedResultKey === result.key" class="mobile-card-details" @click.stop>
              <div class="mobile-detail-section">
                <div class="section-divider">帧数计算步骤</div>
                <div class="detail-step-item">
                  <span class="step-lbl">前置动作:</span>
                  <span class="step-val font-mono">{{ result.prefix || '无' }} ({{ result.prefixFrames }}F)</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">招式发生 ({{ getMoveDisplayName(result.move) }}):</span>
                  <span class="step-val font-mono">+ {{ result.move.startup }}F</span>
                </div>
                <div class="detail-step-item highlight-final">
                  <span class="step-lbl">总发生 (Start):</span>
                  <span class="step-val font-mono">= {{ result.ourActiveStart }}F</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">打击持续判定:</span>
                  <span class="step-val font-mono frame-positive">{{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">对手判定第一帧:</span>
                  <span class="step-val font-mono frame-negative">{{ opponentFirstActiveFrame }}F</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">防守方起手脆弱:</span>
                  <span class="step-val font-mono">{{ opponentWakeupFrame }}~{{ opponentPreActiveEnd }}F</span>
                </div>
              </div>

              <div class="mobile-detail-section">
                <div class="section-divider">防御/命中有利帧 (Advantage)</div>
                <div class="advantage-blocks">
                  <div class="adv-card block-adv">
                    <div class="adv-title">🛡️ 被防帧优势</div>
                    <div class="adv-calc font-mono-sm">
                      {{ result.move.onBlock }}
                      <span v-if="result.driveRushAdvantageBonus" class="bonus-tag">+{{ result.driveRushAdvantageBonus }}</span>
                      <span v-if="result.meatyBonus" class="bonus-tag green">+{{ result.meatyBonus }}</span>
                    </div>
                    <div :class="['adv-value', { 'frame-positive': isPositive(result.calculatedOnBlock), 'frame-negative': isNegative(result.calculatedOnBlock) }]">
                      {{ formatFrame(result.calculatedOnBlock) }}
                    </div>
                  </div>

                  <div class="adv-card hit-adv">
                    <div class="adv-title">🎯 命中(打康)帧优势</div>
                    <div class="adv-calc font-mono-sm">
                      {{ result.move.onHit }}
                      <span v-if="result.driveRushAdvantageBonus" class="bonus-tag">+{{ result.driveRushAdvantageBonus }}</span>
                      <span v-if="result.meatyBonus" class="bonus-tag green">+{{ result.meatyBonus }}</span>
                      <span v-if="result.coversOpponent" class="bonus-tag yellow">+2</span>
                    </div>
                    <div :class="['adv-value', { 'frame-positive': isPositive(result.calculatedOnHit), 'frame-negative': isNegative(result.calculatedOnHit) }]">
                      {{ formatFrame(result.calculatedOnHit) }}
                    </div>
                  </div>
                </div>

                <div class="detail-step-item" v-if="result.isTrade">
                  <span class="step-lbl">相杀有利:</span>
                  <span class="step-val font-mono frame-positive">{{ result.tradeDetail }}</span>
                </div>
              </div>

              <button type="button" class="detail-toggle-btn" @click.stop="showResultTimeline = !showResultTimeline">
                {{ showResultTimeline ? '隐藏时序图' : '查看时序图' }}
              </button>

              <!-- Mobile Timeline inside Mobile Card Details -->
              <div v-if="showResultTimeline" class="mobile-timeline-wrapper">
                <div class="section-divider">时序可视化</div>
                <div class="timeline-scroll-container">
                  <!-- Attacker Timeline -->
                  <div class="timeline-row-label">进攻方 (Self)</div>
                  <div class="timeline-blocks-container">
                    <div v-for="frame in generateTimelineFrames(result, opponentWakeupFrame, opponentFirstActiveFrame)"
                      :key="'mob-t1-' + frame.index" :class="['frame-block', frame.type, { 'is-hit': frame.isHit }]">
                      <div class="frame-content">
                        <div v-if="frame.isWakeup" class="frame-marker wakeup ghost">▼</div>
                      </div>
                      <div class="frame-number" v-if="frame.label">{{ frame.label }}</div>
                    </div>
                  </div>
                  <!-- Defender Timeline (Hit) -->
                  <div class="timeline-row-label mt-4">对手 (Hit)</div>
                  <div class="timeline-blocks-container">
                    <div v-for="frame in generateDefenderFrames(result, opponentWakeupFrame, 'hit')"
                      :key="'mob-t2-' + frame.globalFrame" :class="['frame-block', frame.type]">
                      <div class="frame-content">
                        <div v-if="frame.isWakeup" class="frame-marker wakeup">▼</div>
                        <div v-if="frame.isHit" class="frame-marker hit-marker">💥</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            v-if="hiddenOkiResultCount > 0 && !showAllAutoResults"
            type="button"
            class="show-more-btn mobile-only"
            @click="showAllAutoResults = true"
          >
            显示其余 {{ hiddenOkiResultCount }} 条
          </button>
          <button
            v-else-if="showAllAutoResults && okiResults.length > MOBILE_RESULT_PREVIEW_COUNT"
            type="button"
            class="show-more-btn mobile-only"
            @click="showAllAutoResults = false"
          >
            收起结果
          </button>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>没有自动匹配的压制组合</p>
      </div>
    </section>

    <!-- Step 4: Loop Throw Calculator -->
    <section v-if="effectiveKnockdownAdv > 0" :class="['oki-section', 'throw-section', { collapsed: !showThrowSection }]">
      <div class="collapsible-heading">
        <h2 class="section-title">
          <span class="step-number">4</span>
          循环投计算器
        </h2>
        <button type="button" class="section-toggle-btn" @click="showThrowSection = !showThrowSection">
          {{ showThrowSection ? '收起' : '展开' }}
        </button>
      </div>
      <p v-if="!showThrowSection" class="section-desc compact">
        计算投压起身与打投二择的前置帧。默认收起以减少主结果浏览长度。
      </p>
      <template v-if="showThrowSection">
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
        <div class="summary-item">
          <span class="summary-label">额外延迟</span>
          <input type="number" v-model.number="throwExtraDelayFrames" min="0" class="small-input" />
          <span class="summary-unit">F</span>
        </div>
      </div>

      <div class="throw-math">
        <div class="math-row">
          <span class="math-label">额外延迟 E:</span>
          <span class="math-value">{{ normalizedThrowExtraDelay }}F</span>
        </div>
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
      <p v-if="comboChain.length > 0" class="prefix-info">
        已筛选包含 <strong>{{ comboChainPrefixName }}</strong> 的投组合
      </p>

      <div v-if="throwResults.length > 0">
        <!-- Desktop Results Table -->
        <div class="desktop-results-table results-table">
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
                <span class="detail-label">动作序列:</span>
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
                <span>{{ result.prefixFrames }} + {{ result.fillerFrames }} + {{ result.extraDelayFrames }} = {{ result.delay }}F</span>
              </div>
              <div class="detail-row calc">
                <span class="detail-label">第一帧:</span>
                <span>{{ result.delay }} + {{ normalizedThrowStartup }} = {{ result.firstActive }}F</span>
              </div>

              <button type="button" class="detail-toggle-btn" @click.stop="showThrowTimeline = !showThrowTimeline">
                {{ showThrowTimeline ? '隐藏时序图' : '查看时序图' }}
              </button>

              <!-- Loop Throw Timeline -->
              <div v-if="showThrowTimeline" class="timeline-wrapper">
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

        <!-- Mobile Results Cards for Step 4 -->
        <div class="mobile-results-list">
          <div
            v-for="result in visibleThrowResults"
            :key="'mob-throw-' + result.key"
            :class="['mobile-result-card', {
              expanded: selectedThrowResultKey === result.key
            }]"
            @click="toggleThrowResultDetail(result.key)"
          >
            <div class="card-header">
              <div class="card-combo-title">
                <span v-if="result.prefix" class="mob-prefix">{{ result.prefix }}</span>
                <span v-if="result.prefix" class="mob-plus">+</span>
                <span v-if="result.fillerName !== '直接投'" class="mob-move-name">{{ result.fillerName }}</span>
                <span v-if="result.filler && result.fillerName !== '直接投'" class="mob-move-input">({{ result.filler.input }})</span>
                <span v-if="result.fillerName !== '直接投'" class="mob-plus">+</span>
                <span class="mob-dr-badge">投</span>
              </div>
              <span class="mob-expand-chevron" :class="{ rotated: selectedThrowResultKey === result.key }">▼</span>
            </div>

            <div class="card-tags-row">
              <span class="badge-mini frame font-mono">延迟S: {{ result.delay }}F</span>
              <span class="badge-mini frame font-mono">第一帧: {{ result.firstActive }}F</span>
              <span class="badge-mini frame font-mono">容错: {{ formatTolerance(result.toleranceFrames) }}</span>
            </div>

            <!-- Mobile Expanded Details Panel for Throw -->
            <div v-if="selectedThrowResultKey === result.key" class="mobile-card-details" @click.stop>
              <div class="mobile-detail-section">
                <div class="section-divider">帧数计算步骤</div>
                <div class="detail-step-item">
                  <span class="step-lbl">前置动作:</span>
                  <span class="step-val font-mono">{{ result.prefix || '无' }} ({{ result.prefixFrames }}F)</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">空挥招式:</span>
                  <span class="step-val font-mono">
                    <span v-if="result.filler">{{ result.fillerName }} ({{ result.fillerFrames }}F)</span>
                    <span v-else>无 (0F)</span>
                  </span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">延迟 S:</span>
                  <span class="step-val font-mono">= {{ result.delay }}F</span>
                </div>
                <div class="detail-step-item highlight-final">
                  <span class="step-lbl">第一帧判定:</span>
                  <span class="step-val font-mono">= {{ result.firstActive }}F</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">允许窗口:</span>
                  <span class="step-val font-mono frame-positive">{{ throwDelayMin }}F ~ {{ throwDelayMax }}F</span>
                </div>
              </div>

              <button type="button" class="detail-toggle-btn" @click.stop="showThrowTimeline = !showThrowTimeline">
                {{ showThrowTimeline ? '隐藏时序图' : '查看时序图' }}
              </button>

              <!-- Mobile Timeline inside Mobile Card Details -->
              <div v-if="showThrowTimeline" class="mobile-timeline-wrapper">
                <div class="section-divider">时序可视化</div>
                <div class="timeline-scroll-container">
                  <!-- Attacker Timeline -->
                  <div class="timeline-row-label">进攻方 (Self)</div>
                  <div class="timeline-blocks-container">
                    <div
                      v-for="frame in generateThrowTimelineFrames(result, opponentWakeupFrame, normalizedThrowStartup, normalizedThrowActive)"
                      :key="'mob-throw-t1-' + frame.index" :class="['frame-block', frame.type, { 'is-hit': frame.isHit }]">
                      <div class="frame-content">
                        <div v-if="frame.isWakeup" class="frame-marker wakeup ghost">▼</div>
                      </div>
                      <div class="frame-number" v-if="frame.label">{{ frame.label }}</div>
                    </div>
                  </div>
                  <!-- Defender Timeline -->
                  <div class="timeline-row-label mt-4">对手 (Defender)</div>
                  <div class="timeline-blocks-container">
                    <div v-for="frame in generateThrowDefenderFrames(result, opponentWakeupFrame, result.firstActive)"
                      :key="'mob-throw-t2-' + frame.globalFrame" :class="['frame-block', frame.type]">
                      <div class="frame-content">
                        <div v-if="frame.isWakeup" class="frame-marker wakeup">▼</div>
                        <div v-if="frame.isHit" class="frame-marker hit-marker">⚠️</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      <div v-else-if="throwDelayMax >= 0" class="empty-state">
        <p>没有自动匹配的循环投组合</p>
      </div>
      </template>
    </section>

    <section v-if="effectiveKnockdownAdv > 0" :class="['oki-section', 'alt-oki-section', { collapsed: !showAltOkiSection }]">
      <div class="alt-oki-header">
        <h2 class="section-title">
          <span class="step-number">5</span>
          另类压起身
        </h2>
        <button type="button" class="section-toggle-btn" @click="showAltOkiSection = !showAltOkiSection">
          {{ showAltOkiSection ? '收起' : '展开' }}
        </button>
        <div v-if="showAltOkiSection" class="alt-oki-global-delay">
          <span class="delay-label">全局额外延迟</span>
          <div class="stepper-container">
            <button class="stepper-btn" @click="stepAltExtraDelay(-1)" type="button">−</button>
            <span class="stepper-value">{{ altExtraDelayFrames }}F</span>
            <button class="stepper-btn" @click="stepAltExtraDelay(1)" type="button">+</button>
          </div>
        </div>
      </div>
      <p v-if="!showAltOkiSection" class="section-desc compact">
        绿冲、迸放、优势反算与安全骗压等进阶枚举。需要时展开查看。
      </p>

      <template v-if="showAltOkiSection">

      <!-- Segmented Tab Control -->
      <div class="alt-oki-tabs">
        <button
          type="button"
          :class="['alt-oki-tab-btn', { active: activeAltOkiTab === 'driveRush' }]"
          @click="activeAltOkiTab = 'driveRush'"
        >
          🚗 绿冲压制
        </button>
        <button
          type="button"
          :class="['alt-oki-tab-btn', { active: activeAltOkiTab === 'driveImpact' }]"
          @click="activeAltOkiTab = 'driveImpact'"
        >
          💥 迸放对齐
        </button>
        <button
          type="button"
          :class="['alt-oki-tab-btn', { active: activeAltOkiTab === 'frameTrap' }]"
          @click="activeAltOkiTab = 'frameTrap'"
        >
          🎯 优势反算
        </button>
        <button
          type="button"
          :class="['alt-oki-tab-btn', { active: activeAltOkiTab === 'safeBait' }]"
          @click="activeAltOkiTab = 'safeBait'"
        >
          🛡️ 安全骗压
        </button>
        <button
          type="button"
          :class="['alt-oki-tab-btn', { active: activeAltOkiTab === 'baitThrow' }]"
          @click="activeAltOkiTab = 'baitThrow'"
        >
          🤼 打拆投
        </button>
      </div>

      <!-- TAB 1: 绿冲 + 动作压起身 -->
      <div v-if="activeAltOkiTab === 'driveRush'" class="alt-oki-panel fade-in">
        <div class="panel-intro">
          <h3 class="panel-subtitle">绿冲 + 动作压起身</h3>
          <p class="panel-desc">按绿冲动作第 1 帧计时，Parry Drive Rush 第 11 帧可取消进攻击。最速命中帧 = 招式发生 + 11。</p>
        </div>

        <div class="math-hud-flow">
          <div class="flow-step">
            <span class="flow-label">击倒优势 (N)</span>
            <span class="flow-val highlight">{{ effectiveKnockdownAdv }}F</span>
          </div>
          <div class="flow-arrow">➔</div>
          <div class="flow-step">
            <span class="flow-label">全局额外延迟</span>
            <span class="flow-val">{{ normalizedAltExtraDelay }}F</span>
          </div>
          <div class="flow-arrow">+</div>
          <div class="flow-step">
            <span class="flow-label">绿冲前置取消</span>
            <span class="flow-val">{{ PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME }}F</span>
          </div>
          <div class="flow-arrow">+</div>
          <div class="flow-step">
            <span class="flow-label">招式发生</span>
            <span class="flow-val">发生F</span>
          </div>
          <div class="flow-arrow">=</div>
          <div class="flow-step final">
            <span class="flow-label">最速命中帧</span>
            <span class="flow-val">发生 + 11F</span>
          </div>
        </div>

        <div class="math-formula-box">
          <div class="formula-title">对手可命中窗口：</div>
          <div class="formula-value" v-if="opponentPreActiveWindowValid">
            起身第 <span class="badge green">{{ opponentWakeupFrame }}F</span> 到 判定前 <span class="badge yellow">{{ opponentPreActiveEnd }}F</span> (共 {{ opponentPreActiveEnd - opponentWakeupFrame + 1 }} 帧窗口)
          </div>
          <div class="formula-value red" v-else>无 (对手直接凹招判定生效)</div>
        </div>

        <div class="results-header-row throw-results-header">
          <h4 class="results-title">绿冲匹配结果 (共 {{ allDriveRushOkiResults.length }} 条)</h4>
        </div>

        <!-- Desktop Results Table -->
        <div v-if="allDriveRushOkiResults.length > 0" class="desktop-results-table results-table">
          <div class="result-header throw-header">
            <span>组合</span>
            <span>最速命中</span>
            <span>打击持续帧</span>
            <span>压制帧</span>
          </div>
          <div
            v-for="result in visibleDriveRushOkiResults"
            :key="result.key"
            :class="['result-row-auto', 'throw-row', {
              expanded: selectedDriveRushResultKey === result.key,
              success: result.coversOpponent,
              trade: result.isTrade
            }]"
            @click="toggleDriveRushResultDetail(result.key)"
          >
            <div class="result-combo">
              <span v-if="result.coversOpponent" class="success-badge">压制成功</span>
              <span v-if="result.isTrade" class="trade-badge">相杀</span>
              <span v-if="result.prefix" class="combo-prefix">{{ result.prefix }}</span>
              <span v-if="result.prefix">+</span>
              <span class="badge-dr-tag">绿冲</span>
              <span>+</span>
              <span>{{ getMoveDisplayName(result.move) }}</span>
              <span class="move-input">({{ result.move.input }})</span>
            </div>
            <span class="font-mono-bold">{{ result.fastestHitFrame }}F</span>
            <span class="font-mono">{{ result.firstActive }}~{{ result.lastActive }}F</span>
            <span :class="result.coversOpponent ? 'frame-positive' : 'frame-neutral'">{{ result.wakeupOffset }}F</span>

            <!-- Expanded Details Panel inside row -->
            <div v-if="selectedDriveRushResultKey === result.key" class="result-detail" @click.stop>
              <div class="detail-title">📖 绿冲压制帧数详情</div>
              <div class="detail-grid">
                <div class="detail-steps-column">
                  <h5 class="detail-sub-title">1. 帧数计算步骤 (Steps)</h5>
                  <div class="detail-step-item">
                    <span class="step-lbl">前置动作序列:</span>
                    <span class="step-val font-mono">{{ result.prefix || '无' }} = {{ result.prefixFrames }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">全局额外延迟:</span>
                    <span class="step-val font-mono">+ {{ result.extraDelayFrames }}F</span>
                  </div>
                  <div class="detail-step-item highlight-line">
                    <span class="step-lbl">绿冲起点延迟:</span>
                    <span class="step-val font-mono">= {{ result.driveRushStartDelay }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">绿冲攻击取消前置:</span>
                    <span class="step-val font-mono">+ {{ PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">派生动作发生 ({{ getMoveDisplayName(result.move) }}):</span>
                    <span class="step-val font-mono">+ {{ result.startup }}F</span>
                  </div>
                  <div class="detail-step-item highlight-final">
                    <span class="step-lbl">最速命中帧 (Fastest):</span>
                    <span class="step-val font-mono">= {{ result.fastestHitFrame }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">打击持续判定范围:</span>
                    <span class="step-val font-mono frame-positive">{{ result.firstActive }}~{{ result.lastActive }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">压制帧 (Wakeup Offset):</span>
                    <span class="step-val font-mono frame-positive">{{ result.wakeupOffset }}F</span>
                  </div>
                </div>

                <div class="detail-advantage-column">
                  <h5 class="detail-sub-title">2. 命中/防御判定结果 (Advantage)</h5>
                  <div class="advantage-blocks">
                    <div class="adv-card block-adv">
                      <div class="adv-title">🛡️ 被防帧优势</div>
                      <div class="adv-calc font-mono-sm">
                        {{ result.move.onBlock }} (基准)
                        <span v-if="result.driveRushAdvantageBonus > 0" class="bonus-tag">+{{ result.driveRushAdvantageBonus }} (绿冲)</span>
                        <span v-if="result.meatyBonus > 0" class="bonus-tag green">+{{ result.meatyBonus }} (持续)</span>
                      </div>
                      <div :class="['adv-value', { 'frame-positive': isPositive(result.calculatedOnBlock), 'frame-negative': isNegative(result.calculatedOnBlock) }]">
                        {{ formatFrame(result.calculatedOnBlock) }}
                      </div>
                    </div>

                    <div class="adv-card hit-adv">
                      <div class="adv-title">🎯 命中(打康)帧优势</div>
                      <div class="adv-calc font-mono-sm">
                        {{ result.move.onHit }} (基准)
                        <span v-if="result.driveRushAdvantageBonus > 0" class="bonus-tag">+{{ result.driveRushAdvantageBonus }} (绿冲)</span>
                        <span v-if="result.meatyBonus > 0" class="bonus-tag green">+{{ result.meatyBonus }} (持续)</span>
                        <span v-if="result.coversOpponent" class="bonus-tag yellow">+2 (打康)</span>
                      </div>
                      <div :class="['adv-value', { 'frame-positive': isPositive(result.calculatedOnHit), 'frame-negative': isNegative(result.calculatedOnHit) }]">
                        {{ formatFrame(result.calculatedOnHit) }}
                      </div>
                    </div>
                  </div>

                  <div class="advantage-verdict" :class="{ success: result.coversOpponent, trade: result.isTrade }">
                    <span v-if="result.coversOpponent">✓ 压制成功: 持续判定与起身的脆弱窗口完全重合</span>
                    <span v-else-if="result.isTrade">⚠️ 相杀: 与对手最速凹招判定帧在第 {{ opponentFirstActiveFrame }}F 重合</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile Results Cards -->
        <div v-if="allDriveRushOkiResults.length > 0" class="mobile-results-list">
          <div
            v-for="result in allDriveRushOkiResults"
            :key="'mob-' + result.key"
            :class="['mobile-result-card', {
              expanded: selectedDriveRushResultKey === result.key,
              success: result.coversOpponent,
              trade: result.isTrade
            }]"
            @click="toggleDriveRushResultDetail(result.key)"
          >
            <div class="card-header">
              <div class="card-combo-title">
                <span v-if="result.prefix" class="mob-prefix">{{ result.prefix }}</span>
                <span v-if="result.prefix" class="mob-plus">+</span>
                <span class="mob-dr-badge">绿冲</span>
                <span class="mob-plus">+</span>
                <span class="mob-move-name">{{ getMoveDisplayName(result.move) }}</span>
                <span class="mob-move-input">({{ result.move.input }})</span>
              </div>
              <span class="mob-expand-chevron" :class="{ rotated: selectedDriveRushResultKey === result.key }">▼</span>
            </div>

            <div class="card-tags-row">
              <span v-if="result.coversOpponent" class="badge-mini success">压制成功</span>
              <span v-if="result.isTrade" class="badge-mini trade">相杀</span>
              <span class="badge-mini frame font-mono">最速命中: {{ result.fastestHitFrame }}F</span>
              <span class="badge-mini frame font-mono" :class="result.coversOpponent ? 'green' : 'gray'">压制: {{ result.wakeupOffset }}F</span>
              <span :class="['badge-mini', 'frame', 'font-mono', isPositive(result.calculatedOnBlock) ? 'green' : (isNegative(result.calculatedOnBlock) ? 'red' : '')]">
                被防: {{ formatFrame(result.calculatedOnBlock) }}
              </span>
              <span :class="['badge-mini', 'frame', 'font-mono', isPositive(result.calculatedOnHit) ? 'green' : (isNegative(result.calculatedOnHit) ? 'red' : '')]">
                打康: {{ formatFrame(result.calculatedOnHit) }}
              </span>
            </div>

            <!-- Mobile Expanded Details Panel -->
            <div v-if="selectedDriveRushResultKey === result.key" class="mobile-card-details" @click.stop>
              <div class="mobile-detail-section">
                <div class="section-divider">帧数计算步骤</div>
                <div class="mob-calc-step">前置动作: <span class="font-mono-bold">{{ result.prefix || '无' }} ({{ result.prefixFrames }}F)</span></div>
                <div class="mob-calc-step">全局延迟: <span class="font-mono-bold">+{{ result.extraDelayFrames }}F</span></div>
                <div class="mob-calc-step">绿冲起点: <span class="font-mono-bold">= {{ result.driveRushStartDelay }}F</span></div>
                <div class="mob-calc-step">攻击取消: <span class="font-mono-bold">+{{ PARRY_DRIVE_RUSH_ATTACK_CANCEL_FRAME }}F</span></div>
                <div class="mob-calc-step">招式发生: <span class="font-mono-bold">+{{ result.startup }}F</span></div>
                <div class="mob-calc-step highlight">最速命中: <span class="font-mono-bold">= {{ result.fastestHitFrame }}F</span></div>
                <div class="mob-calc-step">持续时间: <span class="font-mono-bold">{{ result.firstActive }}~{{ result.lastActive }}F</span></div>
              </div>

              <div class="mobile-detail-section">
                <div class="section-divider">最终优势</div>
                <div class="mob-adv-row">
                  <span class="adv-label">🛡️ 被防优势:</span>
                  <span :class="['adv-num', { 'frame-positive': isPositive(result.calculatedOnBlock), 'frame-negative': isNegative(result.calculatedOnBlock) }]">
                    {{ formatFrame(result.calculatedOnBlock) }}
                  </span>
                  <span class="adv-math-desc">({{ result.move.onBlock }} + DR{{ result.driveRushAdvantageBonus }} + Meaty{{ result.meatyBonus }})</span>
                </div>
                <div class="mob-adv-row">
                  <span class="adv-label">🎯 打康优势:</span>
                  <span :class="['adv-num', { 'frame-positive': isPositive(result.calculatedOnHit), 'frame-negative': isNegative(result.calculatedOnHit) }]">
                    {{ formatFrame(result.calculatedOnHit) }}
                  </span>
                  <span class="adv-math-desc">({{ result.move.onHit }} + DR{{ result.driveRushAdvantageBonus }} + Meaty{{ result.meatyBonus }} + 打康2)</span>
                </div>
              </div>

              <div class="mobile-verdict-banner" :class="{ success: result.coversOpponent, trade: result.isTrade }">
                <span v-if="result.coversOpponent">✓ 压制成功: 覆盖对手起身无敌后脆弱帧</span>
                <span v-else-if="result.isTrade">⚠️ 相杀: 与对手最速凹招在第 {{ opponentFirstActiveFrame }}F 发生重合</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty-state">
          <p>没有找到自动匹配的绿冲压起身组合</p>
        </div>
      </div>

      <!-- TAB 2: 斗气迸放压起身 -->
      <div v-if="activeAltOkiTab === 'driveImpact'" class="alt-oki-panel fade-in">
        <div class="panel-intro">
          <h3 class="panel-subtitle">斗气迸放压起身 (Drive Impact)</h3>
          <p class="panel-desc">固定 26F 发生，26~27F 持续。通过配置目标“压制帧”来精确对齐判定位置。</p>
        </div>

        <!-- Custom Parameter Stepper -->
        <div class="panel-setting-block">
          <div class="panel-setting-row">
            <span class="setting-label">目标压制帧 (Wakeup Offset Target)</span>
            <div class="stepper-container">
              <button class="stepper-btn" @click="stepBurstPressureOffset(-1)" type="button">−</button>
              <span class="stepper-value">{{ burstPressureOffset }}F</span>
              <button class="stepper-btn" @click="stepBurstPressureOffset(1)" type="button">+</button>
            </div>
            <span class="setting-unit">F</span>
          </div>
          <p class="setting-desc-text">定义迸放第一段判定相对起身的对齐帧数。例如 1F 代表最速压起身。</p>
        </div>

        <div class="math-hud-flow impact">
          <div class="flow-step">
            <span class="flow-label">击倒优势 (N)</span>
            <span class="flow-val highlight">{{ effectiveKnockdownAdv }}F</span>
          </div>
          <div class="flow-arrow">➔</div>
          <div class="flow-step">
            <span class="flow-label">额外延迟</span>
            <span class="flow-val">{{ normalizedAltExtraDelay }}F</span>
          </div>
          <div class="flow-arrow">+</div>
          <div class="flow-step">
            <span class="flow-label">目标第一帧</span>
            <span class="flow-val">{{ burstTargetFirstActiveFrame }}F</span>
          </div>
          <div class="flow-arrow">➔</div>
          <div class="flow-step">
            <span class="flow-label">需要前置</span>
            <span class="flow-val">{{ burstRequiredDelay }}F</span>
          </div>
          <div class="flow-arrow">+</div>
          <div class="flow-step">
            <span class="flow-label">迸放发生</span>
            <span class="flow-val">26F</span>
          </div>
          <div class="flow-arrow">=</div>
          <div class="flow-step final">
            <span class="flow-label">目标判定范围</span>
            <span class="flow-val">{{ burstTargetFirstActiveFrame }}~{{ burstTargetLastActiveFrame }}F</span>
          </div>
        </div>

        <div v-if="burstRequiredDelay < 0" class="throw-warning-glow">
          ⚠️ 当前设定的目标压制帧需要负的前置帧数（{{ burstRequiredDelay }}F），该方案无法在实际对局中成立！请减小目标压制帧。
        </div>

        <div class="results-header-row throw-results-header">
          <h4 class="results-title">斗气迸放匹配 (共 {{ allBurstPressureResults.length }} 条)</h4>
        </div>

        <!-- Desktop Results Table -->
        <div v-if="allBurstPressureResults.length > 0" class="desktop-results-table results-table">
          <div class="result-header throw-header">
            <span>前置组合</span>
            <span>前置总帧</span>
            <span>判定帧</span>
            <span>压制帧</span>
          </div>
          <div
            v-for="result in visibleBurstPressureResults"
            :key="result.key"
            :class="['result-row-auto', 'throw-row', { expanded: selectedBurstResultKey === result.key }]"
            @click="toggleBurstResultDetail(result.key)"
          >
            <div class="result-combo">
              <span class="combo-prefix">{{ result.prefix || '无前置' }}</span>
              <span>+</span>
              <span class="badge-di-tag">迸放</span>
              <span>+</span>
              <span class="filler-name">{{ result.fillerName }}</span>
              <span class="move-input" v-if="result.filler">({{ result.filler.input }})</span>
            </div>
            <span class="font-mono-bold">{{ result.delay }}F</span>
            <span class="font-mono">{{ result.firstActive }}~{{ result.lastActive }}F</span>
            <span class="frame-positive font-mono-bold">{{ result.wakeupOffset }}F</span>

            <!-- Expanded Details -->
            <div v-if="selectedBurstResultKey === result.key" class="result-detail" @click.stop>
              <div class="detail-title">📖 斗气迸放压制帧数详情</div>
              <div class="detail-grid single-col">
                <div class="detail-steps-column">
                  <div class="detail-step-item">
                    <span class="step-lbl">动作序列前置:</span>
                    <span class="step-val font-mono">{{ result.prefix || '无' }} = {{ result.prefixFrames }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">追加动作 ({{ result.fillerName }}):</span>
                    <span class="step-val font-mono" v-if="result.filler">
                      + {{ result.fillerFrames }}F
                      <span class="setting-tip">({{ result.filler.raw?.total ? '原始总帧' : '各阶段累加' }})</span>
                    </span>
                    <span class="step-val font-mono" v-else>+ 0F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">额外空盘延迟:</span>
                    <span class="step-val font-mono">+ {{ result.extraDelayFrames }}F</span>
                  </div>
                  <div class="detail-step-item highlight-line">
                    <span class="step-lbl">实际前置总帧 (Delay):</span>
                    <span class="step-val font-mono">= {{ result.delay }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">迸放启动时间 (Burst Startup):</span>
                    <span class="step-val font-mono">+ {{ BURST_STARTUP_FRAMES }}F</span>
                  </div>
                  <div class="detail-step-item highlight-final">
                    <span class="step-lbl">迸放判定生效范围:</span>
                    <span class="step-val font-mono frame-positive">= {{ result.firstActive }} ~ {{ result.lastActive }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">对应对手起身压制帧:</span>
                    <span class="step-val font-mono frame-positive">{{ result.wakeupOffset }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">对手起身第1帧:</span>
                    <span class="step-val font-mono">{{ opponentWakeupFrame }}F</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile Results Cards -->
        <div v-if="allBurstPressureResults.length > 0" class="mobile-results-list">
          <div
            v-for="result in allBurstPressureResults"
            :key="'mob-' + result.key"
            :class="['mobile-result-card', 'di-theme', { expanded: selectedBurstResultKey === result.key }]"
            @click="toggleBurstResultDetail(result.key)"
          >
            <div class="card-header">
              <div class="card-combo-title">
                <span class="mob-prefix">{{ result.prefix || '无前置' }}</span>
                <span class="mob-plus">+</span>
                <span class="mob-di-badge">迸放</span>
                <span class="mob-plus" v-if="result.filler">+</span>
                <span class="mob-move-name" v-if="result.filler">{{ result.fillerName }}</span>
              </div>
              <span class="mob-expand-chevron" :class="{ rotated: selectedBurstResultKey === result.key }">▼</span>
            </div>

            <div class="card-tags-row">
              <span class="badge-mini success">精确压制</span>
              <span class="badge-mini frame font-mono">前置总帧: {{ result.delay }}F</span>
              <span class="badge-mini frame font-mono green">压制: +{{ result.wakeupOffset }}F</span>
            </div>

            <!-- Mobile Expanded Details -->
            <div v-if="selectedBurstResultKey === result.key" class="mobile-card-details" @click.stop>
              <div class="mobile-detail-section">
                <div class="section-divider">帧数计算步骤</div>
                <div class="mob-calc-step">前置动作: <span class="font-mono-bold">{{ result.prefix || '无' }} ({{ result.prefixFrames }}F)</span></div>
                <div class="mob-calc-step">追加前置: <span class="font-mono-bold">+{{ result.fillerFrames }}F</span></div>
                <div class="mob-calc-step">追加延迟: <span class="font-mono-bold">+{{ result.extraDelayFrames }}F</span></div>
                <div class="mob-calc-step highlight">前置总帧: <span class="font-mono-bold">= {{ result.delay }}F</span></div>
                <div class="mob-calc-step">迸放启动: <span class="font-mono-bold">+{{ BURST_STARTUP_FRAMES }}F</span></div>
                <div class="mob-calc-step highlight">判定范围: <span class="font-mono-bold">{{ result.firstActive }}~{{ result.lastActive }}F</span></div>
                <div class="mob-calc-step">压制对齐: <span class="font-mono-bold">第 {{ result.wakeupOffset }} 帧压制</span></div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="burstRequiredDelay >= 0" class="empty-state">
          <p>没有找到自动匹配的迸放压起身组合</p>
        </div>
      </div>

      <!-- TAB 3: 目标优势帧反算组合 -->
      <div v-if="activeAltOkiTab === 'frameTrap'" class="alt-oki-panel fade-in">
        <div class="panel-intro">
          <h3 class="panel-subtitle">目标优势帧反算组合</h3>
          <p class="panel-desc">根据您期望保留的特定目标优势帧，自动反向计算出可行的连段/前置空挥路线。</p>
        </div>

        <!-- Custom Parameter Stepper -->
        <div class="panel-setting-block">
          <div class="panel-setting-row">
            <span class="setting-label">期望目标优势帧 (Target Advantage Frame)</span>
            <div class="stepper-container">
              <button class="stepper-btn" @click="stepFrameTrapAdvTarget(-1)" type="button">−</button>
              <span class="stepper-value">{{ frameTrapAdvantageTarget >= 0 ? '+' : '' }}{{ frameTrapAdvantageTarget }}</span>
              <button class="stepper-btn" @click="stepFrameTrapAdvTarget(1)" type="button">+</button>
            </div>
            <span class="setting-unit">F</span>
          </div>
          <p class="setting-desc-text">输入您想在对手起床后获得的帧数优势（正值表示我方先动，负值表示对手先动）。</p>
        </div>

        <div class="math-hud-flow ft">
          <div class="flow-step">
            <span class="flow-label">击倒优势 (N)</span>
            <span class="flow-val highlight">{{ effectiveKnockdownAdv }}F</span>
          </div>
          <div class="flow-arrow">➔</div>
          <div class="flow-step">
            <span class="flow-label">全局额外延迟</span>
            <span class="flow-val">{{ normalizedAltExtraDelay }}F</span>
          </div>
          <div class="flow-arrow">−</div>
          <div class="flow-step">
            <span class="flow-label">组合总帧数</span>
            <span class="flow-val">组合总F</span>
          </div>
          <div class="flow-arrow">=</div>
          <div class="flow-step final">
            <span class="flow-label">结果优势帧</span>
            <span class="flow-val highlight">{{ frameTrapAdvantageTarget >= 0 ? '+' : '' }}{{ normalizedFrameTrapAdvTarget }}F</span>
          </div>
        </div>

        <div class="results-header-row throw-results-header">
          <h4 class="results-title">优势反算匹配 (共 {{ allFrameTrapResults.length }} 条)</h4>
        </div>

        <!-- Desktop Results Table -->
        <div v-if="allFrameTrapResults.length > 0" class="desktop-results-table results-table">
          <div class="result-header throw-header">
            <span>组合路线</span>
            <span>组合总帧</span>
            <span>结果优势</span>
            <span>目标差值</span>
          </div>
          <div
            v-for="result in visibleFrameTrapResults"
            :key="result.key"
            :class="['result-row-auto', 'throw-row', { expanded: selectedFrameTrapResultKey === result.key }]"
            @click="toggleFrameTrapResultDetail(result.key)"
          >
            <div class="result-combo">
              <span class="combo-prefix">{{ result.prefix || '无前置' }}</span>
              <span>+</span>
              <span class="move-name">{{ result.fillerName }}</span>
              <span class="move-input" v-if="result.filler">({{ result.filler.input }})</span>
            </div>
            <span class="font-mono-bold">{{ result.totalFrames }}F</span>
            <span :class="['font-mono-bold', { 'frame-positive': isPositive(result.resultingAdvantage), 'frame-negative': isNegative(result.resultingAdvantage) }]">
              {{ formatFrame(result.resultingAdvantage) }}
            </span>
            <span :class="['font-mono', { 'frame-positive': isPositive(result.deltaToTarget), 'frame-negative': isNegative(result.deltaToTarget) }]">
              {{ formatFrame(result.deltaToTarget) }}
            </span>

            <!-- Expanded Details -->
            <div v-if="selectedFrameTrapResultKey === result.key" class="result-detail" @click.stop>
              <div class="detail-title">📖 连段前置反算帧数详情</div>
              <div class="detail-grid single-col">
                <div class="detail-steps-column">
                  <div class="detail-step-item">
                    <span class="step-lbl">第一段动作前置:</span>
                    <span class="step-val font-mono">{{ result.prefix || '无' }} = {{ result.prefixFrames }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">追加空挥/移动动作:</span>
                    <span class="step-val font-mono" v-if="result.filler">
                      + {{ result.fillerFrames }}F
                      <span class="setting-tip">({{ result.filler.raw?.total ? '动作总帧' : '启动+持续+恢复' }})</span>
                    </span>
                    <span class="step-val font-mono" v-else>+ 0F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">额外空盘延迟:</span>
                    <span class="step-val font-mono">+ {{ result.extraDelayFrames }}F</span>
                  </div>
                  <div class="detail-step-item highlight-line">
                    <span class="step-lbl">组合总消耗帧 (Cost):</span>
                    <span class="step-val font-mono">= {{ result.totalFrames }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">原始击倒优势:</span>
                    <span class="step-val font-mono">{{ effectiveKnockdownAdv }}F</span>
                  </div>
                  <div class="detail-step-item highlight-final">
                    <span class="step-lbl">最终生成帧优势 (Advantage):</span>
                    <span :class="['step-val', 'font-mono-bold', { 'frame-positive': isPositive(result.resultingAdvantage), 'frame-negative': isNegative(result.resultingAdvantage) }]">
                      {{ formatFrame(result.resultingAdvantage) }}
                    </span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">设定目标优势:</span>
                    <span class="step-val font-mono">{{ formatFrame(normalizedFrameTrapAdvTarget) }}</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">与目标差值 (Delta):</span>
                    <span :class="['step-val', 'font-mono', { 'frame-positive': isPositive(result.deltaToTarget), 'frame-negative': isNegative(result.deltaToTarget) }]">
                      {{ formatFrame(result.deltaToTarget) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile Results Cards -->
        <div v-if="allFrameTrapResults.length > 0" class="mobile-results-list">
          <div
            v-for="result in allFrameTrapResults"
            :key="'mob-' + result.key"
            :class="['mobile-result-card', 'ft-theme', { expanded: selectedFrameTrapResultKey === result.key }]"
            @click="toggleFrameTrapResultDetail(result.key)"
          >
            <div class="card-header">
              <div class="card-combo-title">
                <span class="mob-prefix">{{ result.prefix || '无前置' }}</span>
                <span class="mob-plus">+</span>
                <span class="mob-move-name">{{ result.fillerName }}</span>
              </div>
              <span class="mob-expand-chevron" :class="{ rotated: selectedFrameTrapResultKey === result.key }">▼</span>
            </div>

            <div class="card-tags-row">
              <span class="badge-mini success">反算成功</span>
              <span class="badge-mini frame font-mono">组合总帧: {{ result.totalFrames }}F</span>
              <span :class="['badge-mini', 'frame', 'font-mono', isPositive(result.resultingAdvantage) ? 'green' : 'red']">
                优势: {{ formatFrame(result.resultingAdvantage) }}
              </span>
            </div>

            <!-- Mobile Expanded Details -->
            <div v-if="selectedFrameTrapResultKey === result.key" class="mobile-card-details" @click.stop>
              <div class="mobile-detail-section">
                <div class="section-divider">帧数计算步骤</div>
                <div class="mob-calc-step">前置消耗: <span class="font-mono-bold">{{ result.prefix || '无' }} ({{ result.prefixFrames }}F)</span></div>
                <div class="mob-calc-step">动作空挥: <span class="font-mono-bold">+{{ result.fillerFrames }}F</span></div>
                <div class="mob-calc-step">追加延迟: <span class="font-mono-bold">+{{ result.extraDelayFrames }}F</span></div>
                <div class="mob-calc-step highlight">组合消耗: <span class="font-mono-bold">= {{ result.totalFrames }}F</span></div>
                <div class="mob-calc-step">击倒帧数: <span class="font-mono-bold">{{ effectiveKnockdownAdv }}F</span></div>
                <div class="mob-calc-step highlight">结果优势: <span :class="['font-mono-bold', isPositive(result.resultingAdvantage) ? 'green-text' : 'red-text']">{{ formatFrame(result.resultingAdvantage) }}</span></div>
                <div class="mob-calc-step">目标差值: <span class="font-mono-bold">{{ formatFrame(result.deltaToTarget) }}</span></div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty-state">
          <p>没有找到自动匹配的反算前置组合</p>
        </div>
      </div>

      <!-- TAB 4: 安全骗压 -->
      <div v-if="activeAltOkiTab === 'safeBait'" class="alt-oki-panel fade-in">
        <div class="panel-intro">
          <h3 class="panel-subtitle">安全骗压 (Safe Bait Setup)</h3>
          <p class="panel-desc">使用空挥前置动作欺骗对手起身凹招，保证整套动作在对手凹招判定发生前完成，从而能够完美防御。</p>
        </div>

        <!-- Custom Parameter Stepper -->
        <div class="panel-setting-block block-grid">
          <div class="panel-setting-row">
            <span class="setting-label">对手凹招发生帧</span>
            <div class="stepper-container">
              <button class="stepper-btn" @click="stepOpponentReversalStartup(-1)" type="button">−</button>
              <span class="stepper-value">{{ opponentReversalStartup }}F</span>
              <button class="stepper-btn" @click="stepOpponentReversalStartup(1)" type="button">+</button>
            </div>
            <span class="setting-unit">F</span>
          </div>

          <div class="panel-setting-row search-defender-reversal">
            <span class="setting-label">或搜索对手动作快速设定</span>
            <div class="move-search">
              <input
                type="text"
                v-model="defenderMoveSearchQuery"
                @focus="showDefenderDropdown = true"
                @blur="handleDefenderBlur"
                placeholder="搜索防守方必杀技/凹招..."
                class="move-search-input"
              />
              <div v-if="showDefenderDropdown && filteredDefenderMoves.length > 0" class="move-dropdown">
                <button
                  type="button"
                  v-for="move in filteredDefenderMoves"
                  :key="move.name"
                  @mousedown="selectDefenderMove(move)"
                  class="move-option"
                >
                  <span>{{ getMoveDisplayName(move) }}</span>
                  <span class="move-input">{{ move.input }} ({{ move.startup }}F)</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="math-hud-flow sb">
          <div class="flow-step">
            <span class="flow-label">对手起身</span>
            <span class="flow-val">{{ opponentWakeupFrame }}F</span>
          </div>
          <div class="flow-arrow">+</div>
          <div class="flow-step">
            <span class="flow-label">凹招发生</span>
            <span class="flow-val highlight">{{ normalizedOpponentReversalStartup }}F</span>
          </div>
          <div class="flow-arrow">=</div>
          <div class="flow-step final">
            <span class="flow-label">凹招判定第1帧</span>
            <span class="flow-val highlight">{{ safeBaitStrictLimitFrame }}F</span>
          </div>
          <div class="flow-arrow">➔</div>
          <div class="flow-step final green-border">
            <span class="flow-label">最大安全组合帧</span>
            <span class="flow-val highlight">{{ safeBaitMaxTotalFrame }}F</span>
          </div>
        </div>

        <div class="math-formula-box bg-blue">
          <div class="formula-title">🛡️ 安全骗压安全公式：</div>
          <div class="formula-value">
            组合总帧数 <span class="badge blue">&lt; 对手凹招第一帧 ({{ safeBaitStrictLimitFrame }}F)</span>。最大允许动作总帧数为 <span class="badge green">{{ safeBaitMaxTotalFrame }}F</span> 
            <span class="window-bonus">({{ safeBaitTargetLabel }})</span>
          </div>
        </div>

        <div class="results-header-row throw-results-header">
          <h4 class="results-title">安全骗压结果 (共 {{ allSafeBaitResults.length }} 条)</h4>
        </div>

        <!-- Desktop Results Table -->
        <div v-if="allSafeBaitResults.length > 0" class="desktop-results-table results-table">
          <div class="result-header throw-header">
            <span>前置骗凹组合</span>
            <span>组合总帧</span>
            <span>对手判定帧</span>
            <span>防御余量</span>
          </div>
          <div
            v-for="result in visibleSafeBaitResults"
            :key="result.key"
            :class="['result-row-auto', 'throw-row', 'safe-bait-row', { expanded: selectedSafeBaitResultKey === result.key }]"
            @click="toggleSafeBaitResultDetail(result.key)"
          >
            <div class="result-combo">
              <span class="safe-dr-badge">安全诱骗</span>
              <span class="combo-prefix">{{ result.prefix || '无前置' }}</span>
              <span>+</span>
              <span class="move-name">{{ result.fillerName }}</span>
              <span class="move-input" v-if="result.filler">({{ result.filler.input }})</span>
            </div>
            <span class="font-mono-bold">{{ result.totalFrames }}F</span>
            <span class="font-mono">{{ result.strictLimitFrame }}F</span>
            <span class="frame-positive font-mono-bold">+{{ result.safetyMargin }}F</span>

            <!-- Expanded Details -->
            <div v-if="selectedSafeBaitResultKey === result.key" class="result-detail" @click.stop>
              <div class="detail-title">📖 安全骗凹帧数计算详情</div>
              <div class="detail-grid single-col">
                <div class="detail-steps-column">
                  <div class="detail-step-item">
                    <span class="step-lbl">第一段前置动作:</span>
                    <span class="step-val font-mono">{{ result.prefix || '无' }} = {{ result.prefixFrames }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">欺骗用追加挥空动作:</span>
                    <span class="step-val font-mono" v-if="result.filler">
                      + {{ result.fillerFrames }}F
                      <span class="setting-tip">({{ result.filler.raw?.total ? '动作总帧' : '动作收招' }})</span>
                    </span>
                    <span class="step-val font-mono" v-else>+ 0F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">连段额外延迟:</span>
                    <span class="step-val font-mono">+ {{ result.extraDelayFrames }}F</span>
                  </div>
                  <div class="detail-step-item highlight-line">
                    <span class="step-lbl">我方动作链消耗总帧:</span>
                    <span class="step-val font-mono">= {{ result.totalFrames }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">防守方起身第1帧:</span>
                    <span class="step-val font-mono">{{ opponentWakeupFrame }}F</span>
                  </div>
                  <div class="detail-step-item">
                    <span class="step-lbl">对手防守招式 ({{ safeBaitTargetLabel }}):</span>
                    <span class="step-val font-mono">{{ opponentReversalStartup }}F 发生</span>
                  </div>
                  <div class="detail-step-item highlight-final blue-border">
                    <span class="step-lbl">对方攻击伤害生效帧 (Strict Limit):</span>
                    <span class="step-val font-mono">= {{ result.strictLimitFrame }}F</span>
                  </div>
                  <div class="detail-step-item result-banner-green">
                    <span class="step-lbl">判定结果 (Verdict):</span>
                    <span class="step-val frame-positive">
                      ✓ 安全诱骗成立：我方整套动作收招（{{ result.totalFrames }}F）比对手凹招攻击生效（{{ result.strictLimitFrame }}F）快了 {{ result.safetyMargin }} 帧，支持起身后直接拉防！
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile Results Cards -->
        <div v-if="allSafeBaitResults.length > 0" class="mobile-results-list">
          <div
            v-for="result in allSafeBaitResults"
            :key="'mob-' + result.key"
            :class="['mobile-result-card', 'sb-theme', { expanded: selectedSafeBaitResultKey === result.key }]"
            @click="toggleSafeBaitResultDetail(result.key)"
          >
            <div class="card-header">
              <div class="card-combo-title">
                <span class="mob-prefix">{{ result.prefix || '无前置' }}</span>
                <span class="mob-plus">+</span>
                <span class="mob-move-name">{{ result.fillerName }}</span>
              </div>
              <span class="mob-expand-chevron" :class="{ rotated: selectedSafeBaitResultKey === result.key }">▼</span>
            </div>

            <div class="card-tags-row">
              <span class="badge-mini success">安全防御</span>
              <span class="badge-mini frame font-mono">总帧: {{ result.totalFrames }}F</span>
              <span class="badge-mini frame font-mono green">防守余量: +{{ result.safetyMargin }}F</span>
            </div>

            <!-- Mobile Expanded Details -->
            <div v-if="selectedSafeBaitResultKey === result.key" class="mobile-card-details" @click.stop>
              <div class="mobile-detail-section">
                <div class="section-divider">帧数计算步骤</div>
                <div class="mob-calc-step">动作前置: <span class="font-mono-bold">{{ result.prefix || '无' }} ({{ result.prefixFrames }}F)</span></div>
                <div class="mob-calc-step">追加动作: <span class="font-mono-bold">+{{ result.fillerFrames }}F</span></div>
                <div class="mob-calc-step">追加延迟: <span class="font-mono-bold">+{{ result.extraDelayFrames }}F</span></div>
                <div class="mob-calc-step highlight">动作总耗: <span class="font-mono-bold">= {{ result.totalFrames }}F</span></div>
                <div class="mob-calc-step">对手判定: <span class="font-mono-bold">第 {{ result.strictLimitFrame }}F 生效</span></div>
                <div class="mob-calc-step highlight margin">防御余量: <span class="font-mono-bold green-text">+{{ result.safetyMargin }}F</span></div>
              </div>

              <div class="mobile-verdict-banner success">
                ✓ 诱骗成立：我方在对手凹招判定第 {{ result.strictLimitFrame }}F 前已收招，可完防对方动作。
              </div>
            </div><!-- end mobile-card-details -->
          </div><!-- end mobile-result-card v-for -->
        </div><!-- end mobile-results-list -->

        <div v-else class="empty-state">
          <p>没有找到自动匹配的安全骗压组合</p>
        </div>
      </div>

      <!-- TAB 5: 打拆投 (Bait Throw) -->
      <div v-if="activeAltOkiTab === 'baitThrow'" class="alt-oki-panel fade-in">
        <div class="panel-intro">
          <h3 class="panel-subtitle">打拆投 / 骗大招 (Bait Throw / Grab Reversal)</h3>
          <p class="panel-desc">通过垂直跳或后撤步，躲避对方在防守硬直结束后的即时拆投或指令投（如老桑 SA3），并计算确反优势。</p>
        </div>

        <!-- Parameters config -->
        <div class="panel-setting-block block-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <!-- Left: Attacker Settings -->
          <div class="setting-card">
            <h4 class="card-title">攻方设定 (Attacker)</h4>
            
            <div class="panel-setting-row" style="margin-bottom: 15px;">
              <span class="setting-label">起手压制招式</span>
              <div class="move-search" style="display: inline-block; width: 220px; vertical-align: middle;">
                <input
                  type="text"
                  v-model="baitInitiatorSearchQuery"
                  @focus="showBaitInitiatorDropdown = true"
                  @blur="handleBaitInitiatorBlur"
                  placeholder="搜索攻方起手招式..."
                  class="move-search-input"
                />
                <div v-if="showBaitInitiatorDropdown && filteredBaitInitiators.length > 0" class="move-dropdown">
                  <button
                    type="button"
                    v-for="move in filteredBaitInitiators"
                    :key="move.name + '-' + move.input"
                    @mousedown="selectBaitInitiator(move)"
                    class="move-option"
                  >
                    <span>{{ getMoveDisplayName(move) }}</span>
                    <span class="move-input">{{ move.input }} (被防: {{ move.onBlock }}F)</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="panel-setting-row" style="margin-bottom: 15px;">
              <span class="setting-label">是否取消绿冲 (DRC)</span>
              <label class="switch-label" style="cursor: pointer; display: inline-flex; align-items: center;">
                <input type="checkbox" v-model="isBaitInitiatorDRC" style="margin-right: 5px;" />
                <span class="switch-txt">取消绿冲 (耗3格斗气)</span>
              </label>
            </div>

            <div class="panel-setting-row">
              <span class="setting-label">攻方回避动作</span>
              <div class="segmented-control" style="display: inline-flex; gap: 5px;">
                <button
                  type="button"
                  :class="['segmented-btn', { active: selectedBaitAction === 'jump' }]"
                  @click="selectedBaitAction = 'jump'"
                >
                  垂直跳 (45F)
                </button>
                <button
                  type="button"
                  :class="['segmented-btn', { active: selectedBaitAction === 'backdash' }]"
                  @click="selectedBaitAction = 'backdash'"
                >
                  后撤步 ({{ stats?.backDash || 23 }}F)
                </button>
              </div>
            </div>
          </div>

          <!-- Right: Defender Settings -->
          <div class="setting-card">
            <h4 class="card-title">防守方抢招设定 (Defender)</h4>
            
            <div class="panel-setting-row" style="margin-bottom: 15px;">
              <span class="setting-label">防守方抢招类型</span>
              <div class="segmented-control" style="display: inline-flex; gap: 5px;">
                <button
                  type="button"
                  :class="['segmented-btn', { active: defenderBaitReactionType === 'throw' }]"
                  @click="defenderBaitReactionType = 'throw'"
                >
                  普通拆投
                </button>
                <button
                  type="button"
                  :class="['segmented-btn', { active: defenderBaitReactionType === 'invincibleGrab' }]"
                  @click="defenderBaitReactionType = 'invincibleGrab'"
                >
                  无敌投 / 必杀 / SA3
                </button>
              </div>
            </div>

            <div v-if="defenderBaitReactionType === 'throw'" class="custom-throw-inputs">
              <div class="panel-setting-row" style="margin-bottom: 10px;">
                <span class="setting-label">投掷发生帧 (Startup)</span>
                <div class="stepper-container">
                  <button class="stepper-btn" @click="stepDefenderBaitCustomStartup(-1)" type="button">−</button>
                  <span class="stepper-value">{{ defenderBaitCustomStartup }}F</span>
                  <button class="stepper-btn" @click="stepDefenderBaitCustomStartup(1)" type="button">+</button>
                </div>
              </div>
              <div class="panel-setting-row">
                <span class="setting-label">投掷空挥总硬直 (Recovery)</span>
                <div class="stepper-container">
                  <button class="stepper-btn" @click="stepDefenderBaitCustomWhiffRecovery(-5)" type="button">−</button>
                  <span class="stepper-value">{{ defenderBaitCustomWhiffRecovery }}F</span>
                  <button class="stepper-btn" @click="stepDefenderBaitCustomWhiffRecovery(5)" type="button">+</button>
                </div>
              </div>
            </div>

            <div v-else class="defender-grab-search-input">
              <div class="panel-setting-row">
                <span class="setting-label">选择防守方指令投/大招</span>
                <div class="move-search" style="display: inline-block; width: 220px; vertical-align: middle;">
                  <input
                    type="text"
                    v-model="defenderBaitSearchQuery"
                    @focus="showDefenderBaitDropdown = true"
                    @blur="handleDefenderBaitBlur"
                    placeholder="搜索防守方必杀技/超杀..."
                    class="move-search-input"
                    :disabled="!defenderFrameData"
                  />
                  <div v-if="showDefenderBaitDropdown && filteredDefenderBaitMoves.length > 0" class="move-dropdown">
                    <button
                      type="button"
                      v-for="move in filteredDefenderBaitMoves"
                      :key="move.name + '-' + move.input"
                      @mousedown="selectDefenderBaitMove(move)"
                      class="move-option"
                    >
                      <span>{{ getMoveDisplayName(move) }}</span>
                      <span class="move-input">{{ move.input }} ({{ move.startup }}F)</span>
                    </button>
                  </div>
                </div>
                <p v-if="!defenderFrameData" class="text-xs text-gray-400 mt-1">请在上方选择防守方角色以启用招式搜索</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Bait Result Block -->
        <div v-if="baitThrowResult" class="bait-result-block" style="margin-top: 25px;">
          <!-- Verdict Banner -->
          <div :class="['verdict-banner', baitThrowResult.isSafe ? 'banner-safe' : 'banner-danger']" style="padding: 15px; border-radius: 8px; margin-bottom: 20px; font-weight: bold;">
            <div class="verdict-title" style="font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
              <span v-if="baitThrowResult.isSafe">🟢 诱骗成立 (Safe Bait)</span>
              <span v-else>🔴 诱骗失败 (Caught / Punished)</span>
              <span class="punish-adv-badge" v-if="baitThrowResult.isSafe" style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.9rem;">
                落地确反优势: +{{ baitThrowResult.punishAdvantage }}F
              </span>
            </div>
            <div class="verdict-desc" style="font-size: 0.95rem; margin-top: 5px; font-weight: normal; opacity: 0.9;">
              {{ baitThrowResult.safetyReason }}
            </div>
          </div>

          <!-- Mathematical Alignment steps -->
          <div class="math-hud-flow sb" style="margin-bottom: 25px;">
            <div class="flow-step">
              <span class="flow-label">防守方起身/恢复动作</span>
              <span class="flow-val">第 {{ baitThrowResult.F_opp_act }}F</span>
            </div>
            <div class="flow-arrow">➔</div>
            <div class="flow-step">
              <span class="flow-label">抢招/超杀生效</span>
              <span class="flow-val highlight">第 {{ baitThrowResult.F_grab_active }}F</span>
            </div>
            <div class="flow-arrow">⚡</div>
            <div class="flow-step final" :class="[baitThrowResult.isSafe ? 'green-border' : 'red-border']">
              <span class="flow-label">我方回避动作开始</span>
              <span class="flow-val highlight">第 {{ baitThrowResult.F_bait_start }}F</span>
            </div>
          </div>

          <!-- Timeline chart -->
          <div class="timeline-visual" style="background: var(--color-bg-dark, #1a1b26); border: 1px solid var(--color-border, #2f304b); border-radius: 8px; padding: 20px; margin-top: 20px;">
            <h4 style="margin: 0 0 15px 0; color: var(--color-text-secondary, #a9b1d6); font-size: 0.95rem;">📊 骗招对齐时间线 (Timeline Alignment)</h4>
            <div class="timeline-container" style="display: flex; flex-direction: column; gap: 12px; position: relative;">
              <!-- Ruler -->
              <div class="timeline-ruler" style="display: flex; border-bottom: 1px solid #3b4261; padding-bottom: 5px; font-family: monospace; font-size: 11px; color: #565f89;">
                <div style="width: 120px; font-weight: bold;">轴/帧数 (Frame)</div>
                <div style="flex: 1; display: flex; justify-content: space-between;">
                  <span>-15F</span>
                  <span>-10F</span>
                  <span>-5F</span>
                  <span>0F (防守方恢复)</span>
                  <span>+5F</span>
                  <span>+10F</span>
                  <span>+15F</span>
                  <span>+20F</span>
                  <span>+30F</span>
                  <span>+40F</span>
                  <span>+50F+</span>
                </div>
              </div>
              
              <!-- Attacker Row -->
              <div class="timeline-row" style="display: flex; align-items: center;">
                <div class="row-label" style="width: 120px; font-size: 12px; font-weight: bold; color: var(--color-text-primary, #c0caf5);">我方 (Attacker)</div>
                <div class="row-bar-container" style="flex: 1; height: 24px; background: #24283b; border-radius: 4px; position: relative; overflow: hidden; border: 1px solid #414868;">
                  <!-- Initial Move blocked -->
                  <div class="time-block normal" :style="{
                    left: '5%',
                    width: '35%',
                    background: '#34495e',
                    height: '100%',
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#fff'
                  }">
                    {{ baitThrowResult.move1.name }} (被防)
                  </div>
                  <!-- DRC Cancel if active -->
                  <div v-if="baitThrowResult.isDRC" class="time-block drc" :style="{
                    left: '40%',
                    width: '10%',
                    background: '#1abc9c',
                    height: '100%',
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#000',
                    fontWeight: 'bold'
                  }">
                    绿冲取消
                  </div>
                  <!-- Bait Action start (Jump/Backdash) -->
                  <div class="time-block action" :style="{
                    left: baitThrowResult.isDRC ? '50%' : '42%',
                    width: '40%',
                    background: baitThrowResult.isSafe ? '#2ecc71' : '#e74c3c',
                    height: '100%',
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#fff',
                    fontWeight: 'bold'
                  }">
                    {{ baitThrowResult.baitName }} (持续 {{ baitThrowResult.baitDuration }}F)
                  </div>
                </div>
              </div>

              <!-- Defender Row -->
              <div class="timeline-row" style="display: flex; align-items: center;">
                <div class="row-label" style="width: 120px; font-size: 12px; font-weight: bold; color: var(--color-text-primary, #c0caf5);">对手 (Defender)</div>
                <div class="row-bar-container" style="flex: 1; height: 24px; background: #24283b; border-radius: 4px; position: relative; overflow: hidden; border: 1px solid #414868;">
                  <!-- Blockstun -->
                  <div class="time-block blockstun" :style="{
                    left: '5%',
                    width: '40%',
                    background: '#7f8c8d',
                    height: '100%',
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#fff'
                  }">
                    防御硬直 ({{ baitThrowResult.blockstun1 }}F)
                  </div>
                  <!-- Reversal Startup -->
                  <div class="time-block reversal" :style="{
                    left: '45%',
                    width: (baitThrowResult.grabStartup * 1.5) + '%',
                    background: '#e67e22',
                    height: '100%',
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#fff'
                  }">
                    抢招发生 ({{ baitThrowResult.grabStartup }}F)
                  </div>
                  <!-- Grab Whiff / Recovery -->
                  <div class="time-block whiff" :style="{
                    left: (45 + baitThrowResult.grabStartup * 1.5) + '%',
                    width: '45%',
                    background: '#9b59b6',
                    height: '100%',
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#fff'
                  }">
                    空挥硬直 ({{ baitThrowResult.grabRecovery }}F)
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Explanatory note -->
            <div class="timeline-legend" style="display: flex; gap: 15px; margin-top: 15px; font-size: 11px; flex-wrap: wrap;">
              <span style="display: flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#34495e; border-radius:2px;"></span> 被防招式</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#1abc9c; border-radius:2px;"></span> 绿冲取消 (11F)</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#2ecc71; border-radius:2px;"></span> 安全回避</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#e74c3c; border-radius:2px;"></span> 不安全/被命中</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#7f8c8d; border-radius:2px;"></span> 对手防御硬直</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#e67e22; border-radius:2px;"></span> 抢招发生</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#9b59b6; border-radius:2px;"></span> 抢招空挥/收招</span>
            </div>
          </div>

          <!-- Punish calculation detail card -->
          <div class="results-table" style="margin-top: 20px;">
            <div class="detail-title">📖 骗拆投确反帧数计算详情</div>
            <div class="detail-grid single-col" style="padding: 15px; background: rgba(255,255,255,0.02); border-radius: 4px;">
              <div class="detail-steps-column">
                <div class="detail-step-item">
                  <span class="step-lbl">我方起手压制招式:</span>
                  <span class="step-val font-mono">{{ getMoveDisplayName(baitThrowResult.move1) }} = {{ baitThrowResult.move1.onBlock }}F (被防)</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">对手防御硬直 (Blockstun):</span>
                  <span class="step-val font-mono">{{ baitThrowResult.blockstun1 }}F</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">绿冲动作状态:</span>
                  <span class="step-val font-mono">{{ baitThrowResult.isDRC ? '有 (前冲占用 11 帧，第 12 帧可行动)' : '无' }}</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">我方回避动作起始帧 (相对于对手恢复第1帧):</span>
                  <span class="step-val font-mono">第 {{ baitThrowResult.F_bait_start }}F</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">对手出招动作:</span>
                  <span class="step-val font-mono">{{ baitThrowResult.grabName }} (发生: {{ baitThrowResult.grabStartup }}F, 硬直: {{ baitThrowResult.grabRecovery }}F, 总共: {{ baitThrowResult.grabTotal }}F)</span>
                </div>
                <div class="detail-step-item">
                  <span class="step-lbl">对手出招判定生效帧:</span>
                  <span class="step-val font-mono">第 {{ baitThrowResult.F_grab_active }}F</span>
                </div>
                <div class="detail-step-item highlight-line">
                  <span class="step-lbl">我方动作完成/落地帧:</span>
                  <span class="step-val font-mono">第 {{ baitThrowResult.F_attacker_recover }}F</span>
                </div>
                <div class="detail-step-item highlight-line">
                  <span class="step-lbl">对手空挥/出招完成恢复帧:</span>
                  <span class="step-val font-mono">第 {{ baitThrowResult.F_defender_recover }}F</span>
                </div>
                <div class="detail-step-item highlight-final" :class="[baitThrowResult.isSafe ? 'blue-border' : 'red-border']">
                  <span class="step-lbl">判定确反帧优势 (Punish Advantage):</span>
                  <span class="step-val font-mono" :class="[baitThrowResult.isSafe ? 'frame-positive' : 'frame-negative']">
                    {{ baitThrowResult.punishAdvantage >= 0 ? '+' : '' }}{{ baitThrowResult.punishAdvantage }}F
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </template>
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

.preset-toolbar {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-md);
}

.preset-search-input {
  flex: 1;
  min-width: 0;
}

.preset-tool-btn,
.show-more-btn,
.detail-toggle-btn,
.section-toggle-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: 600;
  transition: all var(--transition-fast);
}

.preset-tool-btn,
.section-toggle-btn {
  padding: var(--space-sm) var(--space-md);
  white-space: nowrap;
}

.show-more-btn {
  width: 100%;
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
}

.detail-toggle-btn {
  margin-top: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
}

.preset-tool-btn:hover,
.show-more-btn:hover,
.detail-toggle-btn:hover,
.section-toggle-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.empty-inline {
  padding: var(--space-md);
  color: var(--color-text-muted);
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
}

.mobile-only {
  display: none;
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

.combo-delay-row,
.alt-oki-delay-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-md);
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

.move-option-row {
  display: flex;
  border-bottom: 1px solid var(--color-border-light);
}

.move-option-row:last-child {
  border-bottom: none;
}

.move-option-row .move-option {
  flex: 1;
  border-bottom: none;
}

.move-option-dr {
  flex: 0 0 72px;
  padding: var(--space-sm) var(--space-xs);
  background: rgba(0, 212, 255, 0.12);
  border: none;
  border-left: 1px solid var(--color-border-light);
  color: #00d4ff;
  cursor: pointer;
  font-weight: 700;
}

.move-option-dr:hover {
  background: rgba(0, 212, 255, 0.22);
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

.section-desc.compact {
  margin-bottom: 0;
}

.collapsible-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.collapsible-heading .section-title,
.alt-oki-header .section-title {
  margin-bottom: 0;
}

/* Exclude Last-Hit Moves Section */
.exclude-moves-section {
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.exclude-moves-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-warning);
  margin-bottom: var(--space-xxs);
}

.exclude-moves-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin: 0 0 var(--space-sm);
}

.exclude-moves-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.exclude-move-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xxs);
  padding: 2px var(--space-sm);
  background: rgba(255, 100, 100, 0.15);
  border: 1px solid rgba(255, 100, 100, 0.3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.exclude-move-name {
  color: var(--color-danger);
  font-weight: 500;
}

.exclude-move-note {
  color: var(--color-text-muted);
  font-size: 11px;
}

.exclude-move-remove {
  background: none;
  border: none;
  color: var(--color-danger);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}

.exclude-move-remove:hover {
  color: #fff;
}

.exclude-moves-empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-style: italic;
}

.exclude-moves-add {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-start;
  flex-wrap: wrap;
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
  grid-template-columns: 2.5fr 1fr 1.2fr 0.7fr 0.8fr 0.8fr 0.8fr 1fr;
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
  /* grid-template-columns: 1fr; -- REMOVED to maintain table column alignments! */
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

.safe-dr-badge {
  background: rgba(0, 212, 255, 0.18);
  color: #00d4ff;
  padding: 2px 6px;
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
}

.tag-badge {
  background: rgba(147, 51, 234, 0.3);
  color: #d8b4fe;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.chain-cancel-badge {
  background: rgba(251, 146, 60, 0.25);
  color: #fb923c;
  padding: 2px 8px;
  border: 1px solid rgba(251, 146, 60, 0.5);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: 0.01em;
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

/* Redesigned Alt Oki Styles */
.alt-oki-section {
  position: relative;
  overflow: visible;
}

.alt-oki-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  border-bottom: 1px solid var(--color-border-light);
  padding-bottom: var(--space-md);
}

.alt-oki-global-delay {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.delay-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* Numeric Steppers styling */
.stepper-container {
  display: inline-flex;
  align-items: center;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.stepper-btn {
  background: rgba(255, 255, 255, 0.03);
  border: none;
  color: var(--color-text-primary);
  width: 36px;
  height: 36px;
  font-size: var(--font-size-md);
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
}

.stepper-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-accent);
}

.stepper-btn:active {
  transform: scale(0.9);
}

.stepper-value {
  padding: 0 var(--space-md);
  min-width: 50px;
  text-align: center;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: var(--font-size-sm);
  color: var(--color-accent);
  border-left: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-primary);
}

/* Segmented Tab Control */
.alt-oki-tabs {
  display: flex;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-xs);
  gap: var(--space-xs);
  margin-bottom: var(--space-lg);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
}

.alt-oki-tab-btn {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-weight: 600;
  font-size: var(--font-size-sm);
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-normal);
}

.alt-oki-tab-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.alt-oki-tab-btn.active {
  background: var(--gradient-fire);
  color: white;
  box-shadow: var(--shadow-md), 0 0 10px rgba(255, 107, 53, 0.3);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* Tab Panel Animations */
.alt-oki-panel {
  width: 100%;
}

.panel-intro {
  margin-bottom: var(--space-md);
}

.panel-subtitle {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: var(--space-xs);
}

.panel-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}

/* Mathematical flowchart display */
.math-hud-flow {
  display: flex;
  align-items: center;
  background: linear-gradient(180deg, var(--color-bg-secondary) 0%, rgba(22, 27, 34, 0.5) 100%);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  gap: var(--space-md);
  overflow-x: auto;
  box-shadow: var(--shadow-sm);
}

.math-hud-flow.impact {
  border-color: rgba(255, 107, 53, 0.3);
}

.math-hud-flow.ft {
  border-color: rgba(147, 51, 234, 0.3);
}

.math-hud-flow.sb {
  border-color: rgba(0, 212, 255, 0.3);
}

.flow-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.flow-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: var(--space-xs);
}

.flow-val {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
  background: var(--color-bg-tertiary);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.flow-val.highlight {
  color: var(--color-accent);
}

.flow-step.final .flow-val {
  background: rgba(255, 107, 53, 0.1);
  border-color: var(--color-accent);
  color: var(--color-accent);
  box-shadow: 0 0 10px rgba(255, 107, 53, 0.15);
}

.flow-step.final.green-border .flow-val {
  background: rgba(63, 185, 80, 0.1);
  border-color: var(--color-positive);
  color: var(--color-positive);
  box-shadow: 0 0 10px rgba(63, 185, 80, 0.15);
}

.flow-arrow {
  font-weight: 700;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  flex-shrink: 0;
  padding-top: var(--font-size-sm);
}

/* Math Formula custom box */
.math-formula-box {
  background: rgba(63, 185, 80, 0.05);
  border: 1px solid rgba(63, 185, 80, 0.2);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-lg);
  font-size: var(--font-size-sm);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.math-formula-box.bg-blue {
  background: rgba(0, 212, 255, 0.05);
  border-color: rgba(0, 212, 255, 0.2);
}

.formula-title {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.formula-value {
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.formula-value.red {
  color: var(--color-negative);
  font-weight: 600;
}

.badge {
  font-family: var(--font-mono);
  font-weight: 700;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.badge.green {
  background: rgba(63, 185, 80, 0.2);
  color: var(--color-positive);
}

.badge.yellow {
  background: rgba(210, 153, 34, 0.2);
  color: #ca8a04;
}

.badge.blue {
  background: rgba(0, 212, 255, 0.2);
  color: #00d4ff;
}

/* Settings controls in panels */
.panel-setting-block {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  box-shadow: var(--shadow-sm);
}

.panel-setting-block.grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-lg);
}

.panel-setting-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.panel-setting-row.search-defender-reversal {
  flex-grow: 1;
}

.setting-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  font-weight: 600;
}

.setting-unit {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.setting-desc-text {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-top: var(--space-xs);
  margin-bottom: 0;
}

.setting-tip {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.throw-warning-glow {
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.3);
  color: var(--color-negative);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  margin-bottom: var(--space-lg);
  box-shadow: 0 0 10px rgba(248, 81, 73, 0.1);
}

/* Extra Tags */
.badge-dr-tag {
  background: rgba(0, 212, 255, 0.12);
  color: #00d4ff;
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  font-size: var(--font-size-xs);
  font-weight: 700;
}

.badge-di-tag {
  background: rgba(255, 107, 53, 0.12);
  color: #ff6b35;
  border: 1px solid rgba(255, 107, 53, 0.3);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  font-size: var(--font-size-xs);
  font-weight: 700;
}

.font-mono-bold {
  font-family: var(--font-mono);
  font-weight: 700;
}

.font-mono-sm {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
}

/* Results detail expanded cards styling */
.detail-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: var(--space-lg);
  margin-top: var(--space-sm);
}

.detail-grid.single-col {
  grid-template-columns: 1fr;
}

.detail-sub-title {
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--space-sm);
}

.detail-step-item {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--color-border-light);
}

.detail-step-item.highlight-line {
  border-bottom-color: var(--color-border);
  color: var(--color-accent);
}

.detail-step-item.highlight-final {
  border-top: 1px solid var(--color-border);
  border-bottom: 2px solid var(--color-accent);
  padding: var(--space-sm) 0;
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--color-accent);
}

.detail-step-item.highlight-final.blue-border {
  border-bottom-color: #00d4ff;
  color: #00d4ff;
}

.detail-step-item.result-banner-green {
  border-top: 1px solid var(--color-border);
  border-bottom: none;
  padding: var(--space-sm) 0;
  color: var(--color-positive);
  font-weight: 600;
}

.step-lbl {
  color: var(--color-text-muted);
}

.step-val {
  font-weight: 600;
}

/* Advantage Output Cards */
.advantage-blocks {
  display: flex;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.adv-card {
  flex: 1;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  text-align: center;
  box-shadow: var(--shadow-sm);
}

.adv-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: var(--space-xs);
}

.adv-calc {
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
}

.adv-value {
  font-size: var(--font-size-2xl);
  font-family: var(--font-mono);
  font-weight: 800;
  line-height: 1.1;
}

.bonus-tag {
  display: inline-block;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border);
  border-radius: 2px;
  padding: 0 4px;
  margin-left: 2px;
}

.bonus-tag.green {
  color: var(--color-positive);
  background: rgba(63, 185, 80, 0.05);
  border-color: rgba(63, 185, 80, 0.15);
}

.bonus-tag.yellow {
  color: var(--color-warning);
  background: rgba(210, 153, 34, 0.05);
  border-color: rgba(210, 153, 34, 0.15);
}

.advantage-verdict {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-weight: 600;
  font-size: var(--font-size-sm);
  text-align: center;
  box-shadow: var(--shadow-sm);
}

.advantage-verdict.success {
  background: rgba(63, 185, 80, 0.1);
  border: 1px solid rgba(63, 185, 80, 0.25);
  color: var(--color-positive);
}

.advantage-verdict.trade {
  background: rgba(210, 153, 34, 0.1);
  border: 1px solid rgba(210, 153, 34, 0.25);
  color: #ca8a04;
}

/* Mobile responsive results styling */
.desktop-results-table {
  display: block;
}

.mobile-results-list {
  display: none;
  flex-direction: column;
  gap: var(--space-md);
}

.mobile-result-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-sm);
  border-left: 4px solid var(--color-neutral);
}

.mobile-result-card:hover {
  border-color: var(--color-accent);
}

.mobile-result-card.success {
  border-left-color: var(--color-positive);
}

.mobile-result-card.trade {
  border-left-color: var(--color-warning);
}

.mobile-result-card.di-theme {
  border-left-color: #ff6b35;
}

.mobile-result-card.ft-theme {
  border-left-color: #9333ea;
}

.mobile-result-card.sb-theme {
  border-left-color: #00d4ff;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.card-combo-title {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-weight: 700;
  font-size: var(--font-size-sm);
}

.mob-prefix {
  background: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.mob-plus {
  color: var(--color-text-muted);
}

.mob-dr-badge {
  background: rgba(0, 212, 255, 0.15);
  color: #00d4ff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

.mob-di-badge {
  background: rgba(255, 107, 53, 0.15);
  color: #ff6b35;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

.mob-move-name {
  color: var(--color-text-primary);
}

.mob-move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.mob-expand-chevron {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  transition: transform var(--transition-normal);
  padding: 4px;
}

.mob-expand-chevron.rotated {
  transform: rotate(180deg);
  color: var(--color-accent);
}

.card-tags-row {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
  margin-bottom: var(--space-xs);
}

.badge-mini {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 2px;
}

.badge-mini.success {
  background: rgba(63, 185, 80, 0.15);
  color: var(--color-positive);
  border: 1px solid rgba(63, 185, 80, 0.25);
}

.badge-mini.trade {
  background: rgba(210, 153, 34, 0.15);
  color: #ca8a04;
  border: 1px solid rgba(210, 153, 34, 0.25);
}

.badge-mini.frame {
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.badge-mini.frame.green {
  color: var(--color-positive);
  background: rgba(63, 185, 80, 0.05);
  border-color: rgba(63, 185, 80, 0.15);
}

.badge-mini.frame.red {
  color: var(--color-negative);
  background: rgba(248, 81, 73, 0.05);
  border-color: rgba(248, 81, 73, 0.15);
}

/* Mobile card expanded details */
.mobile-card-details {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-border-light);
  animation: fadeIn var(--transition-normal) ease;
}

.mobile-detail-section {
  margin-bottom: var(--space-md);
}

.section-divider {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--space-xs);
  border-bottom: 1px dashed var(--color-border);
  padding-bottom: 2px;
}

.mob-calc-step {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  display: flex;
  justify-content: space-between;
  padding: var(--space-xxs) 0;
}

.mob-calc-step.highlight {
  color: var(--color-accent);
  font-weight: 700;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-xs);
  margin-bottom: var(--space-xs);
}

.mob-calc-step.highlight.margin {
  border-bottom-color: rgba(0, 212, 255, 0.3);
  color: #00d4ff;
}

.mob-adv-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--font-size-sm);
  padding: var(--space-xs) 0;
  flex-wrap: wrap;
}

.adv-label {
  color: var(--color-text-secondary);
}

.adv-num {
  font-family: var(--font-mono);
  font-weight: 800;
  font-size: var(--font-size-md);
}

.adv-math-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.green-text {
  color: var(--color-positive);
}

.red-text {
  color: var(--color-negative);
}

.mobile-verdict-banner {
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-align: center;
  box-shadow: var(--shadow-sm);
}

.mobile-verdict-banner.success {
  background: rgba(63, 185, 80, 0.1);
  border: 1px solid rgba(63, 185, 80, 0.2);
  color: var(--color-positive);
}

.mobile-verdict-banner.trade {
  background: rgba(210, 153, 34, 0.1);
  border: 1px solid rgba(210, 153, 34, 0.2);
  color: #ca8a04;
}

/* Media Queries for full mobile responsiveness */
@media (max-width: 992px) {
  .detail-grid {
    grid-template-columns: 1fr;
    gap: var(--space-md);
  }
}

@media (max-width: 768px) {
  .oki-view {
    padding-bottom: var(--space-xl) !important;
  }

  .page-title {
    margin-top: var(--space-sm);
  }

  .stats-bar {
    padding: var(--space-sm) var(--space-md);
    margin-bottom: var(--space-md);
  }

  .oki-section {
    padding: var(--space-md);
    margin-bottom: var(--space-md);
  }

  .preset-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .knockdown-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mobile-only {
    display: block;
  }

  .collapsible-heading {
    align-items: flex-start;
  }

  .alt-oki-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-sm);
  }

  .alt-oki-global-delay {
    grid-column: 1 / -1;
    width: 100%;
    justify-content: space-between;
  }

  .alt-oki-tabs {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }

  .desktop-results-table {
    display: none !important;
  }

  .mobile-results-list {
    display: flex !important;
  }
}

@media (max-width: 480px) {
  .alt-oki-tabs {
    grid-template-columns: 1fr;
  }
  
  .panel-setting-row {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-xs);
  }
  
  .stepper-container {
    width: 100%;
  }
  
  .stepper-btn {
    flex: 1;
  }
  
  .stepper-value {
    flex: 2;
  }
  
  .math-hud-flow {
    padding: var(--space-sm);
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
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  flex-shrink: 0;
  background: #27272a;
  transition: all var(--transition-fast);
}

.timeline-blocks-container {
  display: flex;
  align-items: flex-start;
  min-width: max-content;
  gap: 2px;
}

/* Colors with modern gradients and glowing edges */
.frame-block.prefix {
  background: linear-gradient(180deg, #4b5563 0%, #1f2937 100%);
  border-color: #6b7280;
}

.frame-block.startup {
  background: linear-gradient(180deg, #9ca3af 0%, #6b7280 100%);
  border-color: #d1d5db;
}

.frame-block.active {
  background: linear-gradient(180deg, #ef4444 0%, #b91c1c 100%);
  border-color: #f87171;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
}

.frame-block.recovery {
  background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%);
  border-color: #60a5fa;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.3);
}

/* Defender States */
.frame-block.down {
  background: linear-gradient(180deg, #18181b 0%, #09090b 100%);
  border-color: #3f3f46;
}

.frame-block.vulnerable {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.15) 100%);
  border-color: rgba(16, 185, 129, 0.6);
}

.frame-block.hitstun {
  background: linear-gradient(180deg, #fbbf24 0%, #d97706 100%);
  border-color: #fcd34d;
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.3);
}

.frame-block.blockstun {
  background: linear-gradient(180deg, #a78bfa 0%, #6d28d9 100%);
  border-color: #c084fc;
  box-shadow: 0 0 8px rgba(167, 139, 250, 0.3);
}

.frame-block.neutral {
  background: linear-gradient(180deg, #27272a 0%, #18181b 100%);
  border-color: #3f3f46;
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

.filter-active-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  background: rgba(168, 85, 247, 0.15); /* Purple tint */
  border: 1px dashed #a855f7;
  color: #c084fc;
  font-size: var(--font-size-xs);
  font-weight: 500;
  white-space: nowrap;
  animation: filterPulse 2s infinite ease-in-out;
}

@keyframes filterPulse {
  0% {
    box-shadow: 0 0 4px rgba(168, 85, 247, 0.2);
  }
  50% {
    box-shadow: 0 0 12px rgba(168, 85, 247, 0.4);
    background: rgba(168, 85, 247, 0.22);
  }
  100% {
    box-shadow: 0 0 4px rgba(168, 85, 247, 0.2);
  }
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

/* Custom Moves Palette Fallbacks */
:root {
  --color-surface: var(--color-bg-card);
  --color-bg: var(--color-bg-primary);
  --color-danger: var(--color-negative);
  --color-danger-rgb: 248, 81, 73;
  --color-primary: var(--color-accent);
}

/* Glassmorphic Dropdowns & Custom Search Upgrade */
.move-dropdown {
  background: rgba(28, 33, 40, 0.95) !important;
  backdrop-filter: blur(12px) !important;
  border: 1px solid var(--color-accent-light) !important;
  box-shadow: var(--shadow-lg), 0 0 15px rgba(255, 107, 53, 0.1) !important;
  padding: var(--space-xs);
  transition: all var(--transition-normal);
}

.move-option-row {
  display: flex;
  gap: var(--space-xs);
  padding: 2px 4px;
}

.move-option {
  flex: 1;
  text-align: left;
  background: transparent;
  border: none;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all var(--transition-fast);
}

.move-option:hover {
  background: rgba(255, 107, 53, 0.15) !important;
  color: var(--color-text-primary) !important;
}

.move-option-dr {
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: var(--radius-sm);
  background: rgba(0, 212, 255, 0.15);
  border: 1px solid #00d4ff;
  color: #00d4ff;
  cursor: pointer;
  white-space: nowrap;
}

.move-option-dr:hover {
  background: #00d4ff;
  color: #000;
  box-shadow: 0 0 8px rgba(0, 212, 255, 0.4);
}

/* Sequencer Combo Chain Upgrades */
.combo-chain {
  background: rgba(22, 27, 34, 0.6) !important;
  backdrop-filter: blur(10px) !important;
  border: 1px solid var(--color-border) !important;
  padding: var(--space-md) !important;
  min-height: 52px !important;
  display: flex;
  align-items: center;
  gap: var(--space-sm) !important;
}

.chain-item {
  background: linear-gradient(135deg, rgba(0, 212, 255, 0.12) 0%, rgba(123, 47, 247, 0.18) 100%) !important;
  border: 1px solid rgba(0, 212, 255, 0.4) !important;
  box-shadow: 0 0 10px rgba(0, 212, 255, 0.1) !important;
  border-radius: var(--radius-md) !important;
  padding: 6px 12px !important;
  font-size: var(--font-size-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  animation: slideIn var(--transition-fast) ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.chain-plus {
  color: var(--color-accent) !important;
  font-weight: 700 !important;
  text-shadow: 0 0 6px rgba(255, 107, 53, 0.4);
}

/* Quick Action Buttons Redesign */
.dash-btn {
  background: linear-gradient(135deg, rgba(0, 212, 255, 0.15) 0%, rgba(0, 212, 255, 0.05) 100%) !important;
  border: 1px solid rgba(0, 212, 255, 0.4) !important;
  color: #00d4ff !important;
  transition: all var(--transition-fast) !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.dash-btn:hover {
  background: linear-gradient(135deg, rgba(0, 212, 255, 0.25) 0%, rgba(0, 212, 255, 0.1) 100%) !important;
  border-color: #00d4ff !important;
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.25) !important;
  transform: translateY(-1px);
}

.dash-btn:active {
  transform: translateY(1px);
}

/* Mobile Responsive Results List & Card styling */
.mobile-result-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  cursor: pointer;
  transition: all var(--transition-normal);
  position: relative;
  overflow: hidden;
}

.mobile-result-card:hover {
  border-color: var(--color-accent-hover);
  box-shadow: var(--shadow-md);
}

.mobile-result-card.success {
  border-color: rgba(63, 185, 80, 0.4);
  background: linear-gradient(180deg, var(--color-bg-card) 0%, rgba(63, 185, 80, 0.04) 100%);
}

.mobile-result-card.success:hover {
  border-color: var(--color-positive);
  box-shadow: 0 0 15px rgba(63, 185, 80, 0.15);
}

.mobile-result-card.trade {
  border-color: rgba(210, 153, 34, 0.4);
  background: linear-gradient(180deg, var(--color-bg-card) 0%, rgba(210, 153, 34, 0.04) 100%);
}

.mobile-result-card.trade:hover {
  border-color: var(--color-warning);
  box-shadow: 0 0 15px rgba(210, 153, 34, 0.15);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-combo-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  font-size: var(--font-size-sm);
  flex-wrap: wrap;
}

.mob-prefix {
  color: var(--color-text-secondary);
}

.mob-plus {
  color: var(--color-text-muted);
  font-weight: bold;
}

.mob-move-name {
  color: var(--color-text-primary);
}

.mob-move-input {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-accent);
}

.mob-dr-badge {
  background: rgba(0, 212, 255, 0.15);
  border: 1px solid #00d4ff;
  color: #00d4ff;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: bold;
}

.mob-expand-chevron {
  font-size: 10px;
  color: var(--color-text-muted);
  transition: transform var(--transition-normal);
}

.mob-expand-chevron.rotated {
  transform: rotate(180deg);
  color: var(--color-accent);
}

.card-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.badge-mini {
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: 600;
}

.badge-mini.success {
  background: rgba(63, 185, 80, 0.2);
  color: var(--color-positive);
}

.badge-mini.trade {
  background: rgba(210, 153, 34, 0.2);
  color: #d29922;
}

.badge-mini.safe-dr {
  background: rgba(0, 212, 255, 0.15);
  border: 1px solid rgba(0, 212, 255, 0.3);
  color: #00d4ff;
}

.badge-mini.frame {
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

/* Expanded Card Calculations Dashboard */
.mobile-card-details {
  border-top: 1px solid var(--color-border);
  margin-top: var(--space-xs);
  padding-top: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  animation: slideDown var(--transition-normal) ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    max-height: 0;
    overflow: hidden;
  }
  to {
    opacity: 1;
    max-height: 1000px;
  }
}

.mobile-detail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mobile-detail-section .section-divider {
  margin: var(--space-sm) 0 var(--space-xs);
  font-size: 11px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-accent);
}

.detail-step-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-xs);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--color-border-light);
}

.detail-step-item.highlight-line {
  background: rgba(0, 212, 255, 0.05);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border-bottom: none;
}

.detail-step-item.highlight-final {
  background: var(--color-accent-light);
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border-bottom: none;
  font-weight: 600;
}

.step-lbl {
  color: var(--color-text-secondary);
}

.step-val {
  color: var(--color-text-primary);
  font-weight: 600;
}

.advantage-blocks {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}

.adv-card {
  flex: 1;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.adv-title {
  font-size: 10px;
  font-weight: bold;
  color: var(--color-text-secondary);
  text-transform: uppercase;
}

.adv-calc {
  font-size: 9px;
  color: var(--color-text-muted);
}

.adv-value {
  font-size: var(--font-size-lg);
  font-weight: bold;
  font-family: var(--font-mono);
}

.mobile-timeline-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.mobile-timeline-wrapper .timeline-scroll-container {
  padding: var(--space-sm);
  background: rgba(22, 27, 34, 0.4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* Scroll tracks */
.timeline-scroll-container::-webkit-scrollbar {
  height: 6px;
}

.timeline-scroll-container::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.timeline-scroll-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}

/* Responsive adjustments */
@media (max-width: 992px) {
  .desktop-results-table {
    display: none !important;
  }
  
  .mobile-results-list {
    display: flex !important;
    flex-direction: column;
    gap: var(--space-sm);
  }
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
  
  .advantage-blocks {
    flex-direction: column;
  }
/* Bait Throw specific styles */
.setting-card {
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--color-border-light, #2f304b);
  border-radius: var(--radius-md, 6px);
  padding: 20px;
}
.card-title {
  margin: 0 0 15px 0;
  font-size: 1rem;
  color: var(--color-accent, #ff4757);
  border-bottom: 1px solid var(--color-border-light, #2f304b);
  padding-bottom: 8px;
}
.segmented-control {
  display: inline-flex;
  gap: 5px;
  background: rgba(0, 0, 0, 0.2);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--color-border-light, #2f304b);
}
.segmented-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #7f8c8d);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}
.segmented-btn.active {
  background: var(--color-bg-tertiary, #2c2e3e);
  color: var(--color-text-primary, #ffffff);
  box-shadow: 0 2px 4px rgba(0,0,0,0.15);
}
.verdict-banner {
  border-left: 5px solid transparent;
  transition: all 0.3s ease;
}
.verdict-banner.banner-safe {
  background: rgba(46, 204, 113, 0.15);
  border: 1px solid rgba(46, 204, 113, 0.3);
  border-left: 5px solid #2ecc71;
  color: #2ecc71;
}
.verdict-banner.banner-danger {
  background: rgba(231, 76, 60, 0.15);
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-left: 5px solid #e74c3c;
  color: #e74c3c;
}
.timeline-container {
  overflow-x: auto;
}
.time-block {
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.2);
  transition: all 0.3s ease;
}
}

/* Preferred Moves Section */
.preferred-moves-section {
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.preferred-moves-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #fbbf24;
  margin-bottom: var(--space-xxs);
}

.preferred-moves-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin: 0 0 var(--space-sm);
}

.preferred-moves-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.preferred-move-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xxs);
  padding: 2px var(--space-sm);
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.preferred-move-name {
  color: #fbbf24;
  font-weight: 500;
}

.preferred-move-note {
  color: var(--color-text-muted);
  font-size: 11px;
}

.preferred-move-remove {
  background: none;
  border: none;
  color: #fbbf24;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}

.preferred-move-remove:hover {
  color: #fff;
}

.preferred-moves-empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-style: italic;
}

.preferred-moves-add {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-start;
  flex-wrap: wrap;
}

.preferred-filter-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px dashed var(--color-border-light);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.preferred-filter-toggle input[type="checkbox"] {
  cursor: pointer;
  accent-color: #fbbf24;
}

/* Preferred Row and Star Styling */
.preferred-badge {
  display: inline-flex;
  align-items: center;
  background: rgba(251, 191, 36, 0.2);
  border: 1px solid rgba(251, 191, 36, 0.4);
  color: #fbbf24;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: bold;
  padding: 1px 4px;
  margin-right: 4px;
}

.result-row-auto.preferred-row {
  border-left: 3px solid #fbbf24 !important;
  background: rgba(251, 191, 36, 0.03) !important;
}

.result-row-auto.preferred-row:hover {
  background: rgba(251, 191, 36, 0.06) !important;
}

.mobile-result-card.preferred-card {
  border-left: 3px solid #fbbf24 !important;
  background: rgba(251, 191, 36, 0.03) !important;
}
</style>
