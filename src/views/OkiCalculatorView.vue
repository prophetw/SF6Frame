<script setup lang="ts">
import { ref, computed } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData, type CharacterStats } from '../types';

const selectedCharacterId = ref<string>('');
const selectedKnockdownMove = ref<Move | null>(null);
const frameData = ref<FrameData | null>(null);
const loading = ref(false);

// Custom knockdown advantage
const customKnockdownAdv = ref<number>(38);
const useCustomKnockdown = ref(false);

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

// Opponent's fastest reversal settings
const opponentReversalStartup = ref<number>(4);
// const opponentReversalActive = ref<number>(3); // Unused

// Use combo chain as prefix for auto calculation
const useChainAsPrefix = ref(false);

// Loop throw calculator inputs
const throwStartup = ref<number>(5);
const throwActive = ref<number>(3);
const wakeupThrowInvul = ref<number>(1);

// Selected result for detail view
const selectedResultKey = ref<string | null>(null);
const selectedThrowResultKey = ref<string | null>(null);

// Effective knockdown advantage
const effectiveKnockdownAdv = computed(() => {
  if (useCustomKnockdown.value && customKnockdownAdv.value > 0) {
    return customKnockdownAdv.value;
  }
  return selectedKnockdownMove.value?.knockdown?.advantage || 0;
});

// Character stats
const stats = computed<CharacterStats | undefined>(() => frameData.value?.stats);

// Opponent's reversal first frame
const opponentFirstFrame = computed(() => {
  return effectiveKnockdownAdv.value + opponentReversalStartup.value;
});

// Loop throw calculator
const normalizedThrowStartup = computed(() => Math.max(1, throwStartup.value || 1));
const normalizedThrowActive = computed(() => Math.max(1, throwActive.value || 1));
const normalizedThrowInvul = computed(() => Math.max(0, wakeupThrowInvul.value || 0));

const earliestThrowableFrame = computed(() => {
  return effectiveKnockdownAdv.value + normalizedThrowInvul.value;
});

const throwDelayMax = computed(() => {
  return earliestThrowableFrame.value - normalizedThrowStartup.value;
});

const throwDelayMin = computed(() => {
  return throwDelayMax.value - (normalizedThrowActive.value - 1);
});

const throwDelayMinClamped = computed(() => {
  return Math.max(0, throwDelayMin.value);
});

const throwFirstActiveMin = computed(() => {
  return earliestThrowableFrame.value - (normalizedThrowActive.value - 1);
});

const throwFirstActiveMax = computed(() => {
  return earliestThrowableFrame.value;
});

// Knockdown moves
const knockdownMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter((m: Move) => m.knockdown && m.knockdown.type !== 'none');
});

// ALL moves for selection
const allMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter((m: Move) => {
    const startup = parseInt(m.startup) || 0;
    return startup > 0 && startup <= 50;
  });
});

// Filtered moves for search
const filteredMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  const query = moveSearchQuery.value.toLowerCase();
  if (!query) return allMoves.value.slice(0, 15);
  return allMoves.value.filter((m: Move) => 
    m.name.toLowerCase().includes(query) ||
    m.input.toLowerCase().includes(query)
  ).slice(0, 15);
});

// Parse total active frames
function parseTotalActiveFrames(active: string): number {
  if (!active || active === '-') return 1;
  const matches = String(active).match(/\d+/g);
  if (!matches) return 1;
  return matches.reduce((sum, n) => sum + parseInt(n), 0);
}

function parseTotalRecoveryFrames(recovery: string): number {
  if (!recovery || recovery === '-') return 0;
  const matches = String(recovery).match(/\d+/g);
  if (!matches) return 0;
  return matches.reduce((sum, n) => sum + parseInt(n), 0);
}

function getMoveTotalFrames(move: Move): number {
  const startup = parseInt(move.startup) || 0;
  const active = parseTotalActiveFrames(move.active);
  const recovery = parseTotalRecoveryFrames(move.recovery);
  return startup + active + recovery;
}

// Calculate combo result
const comboResult = computed(() => {
  if (comboChain.value.length === 0 || effectiveKnockdownAdv.value <= 0) return null;
  
  // Calculate total startup frames (all actions except last one's active)
  let totalStartup = 0;
  let lastActiveFrames = 1;
  
  for (let i = 0; i < comboChain.value.length; i++) {
    const action = comboChain.value[i];
    if (!action) continue;
    if (i === comboChain.value.length - 1 && action.type === 'move') {
      // Last action: add startup, track active separately
      totalStartup += action.frames;
      lastActiveFrames = action.active || 1;
    } else {
      // Not last action: add full frames
      totalStartup += action.frames;
    }
  }
  
  const ourStart = totalStartup;
  const ourEnd = ourStart + lastActiveFrames - 1;
  
  const oppFirst = opponentFirstFrame.value;
  // Success: our first active is BEFORE opponent's first active
  // Trade: our first active equals opponent's first active
  const isSuccess = ourStart < oppFirst && oppFirst <= ourEnd;
  const isTrade = ourStart === oppFirst && oppFirst <= ourEnd;
  const coversOpponent = isSuccess; // For backward compatibility
  
  let status = '';
  if (isSuccess) {
    status = '压制成功 ✓';
  } else if (isTrade) {
    status = '相杀';
  } else if (ourEnd < oppFirst) {
    status = '打击太早';
  } else {
    status = '打击太晚';
  }
  
  return {
    totalStartup,
    ourStart,
    ourEnd,
    coversOpponent,
    status,
  };
});

// Extended Oki Result for auto list
interface ExtendedOkiResult {
  move: Move;
  prefix: string;
  prefixFrames: number;
  ourActiveStart: number;
  ourActiveEnd: number;
  coversOpponent: boolean;
  isTrade: boolean;
}

// Calculate prefix frames from combo chain (excluding last move if it has active)
const comboChainPrefixFrames = computed(() => {
  let total = 0;
  for (const action of comboChain.value) {
    total += action.frames;
  }
  return total;
});

// Build prefix name from combo chain
const comboChainPrefixName = computed(() => {
  if (comboChain.value.length === 0) return '';
  return comboChain.value.map((a: ComboAction) => a.name).join(' + ');
});

// Prefix frames for throw (includes move recovery)
const comboChainThrowPrefixFrames = computed(() => {
  let total = 0;
  for (const action of comboChain.value) {
    if (action.type === 'move' && action.move) {
      total += getMoveTotalFrames(action.move);
    } else {
      total += action.frames;
    }
  }
  return total;
});

// Toggle result detail
function toggleResultDetail(key: string) {
  if (selectedResultKey.value === key) {
    selectedResultKey.value = null;
  } else {
    selectedResultKey.value = key;
  }
}

function toggleThrowResultDetail(key: string) {
  if (selectedThrowResultKey.value === key) {
    selectedThrowResultKey.value = null;
  } else {
    selectedThrowResultKey.value = key;
  }
}

// Auto results
const okiResults = computed<ExtendedOkiResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0 || !stats.value) return [];
  
  const results: ExtendedOkiResult[] = [];
  const oppFirst = opponentFirstFrame.value;
  
  let prefixes: { name: string; frames: number }[];
  
  if (useChainAsPrefix.value && comboChain.value.length > 0) {
    // Use combo chain as the only prefix
    prefixes = [
      { name: comboChainPrefixName.value, frames: comboChainPrefixFrames.value },
    ];
  } else {
    // Default prefixes
    prefixes = [
      { name: '', frames: 0 },
      { name: '前冲', frames: stats.value.forwardDash },
      { name: '前冲x2', frames: stats.value.forwardDash * 2 },
    ];
  }
  
  for (const prefix of prefixes) {
    for (const move of allMoves.value) {
      const startup = parseInt(move.startup) || 0;
      const totalActive = parseTotalActiveFrames(move.active);
      if (startup <= 0) continue;
      
      const ourStart = prefix.frames + startup;
      const ourEnd = ourStart + totalActive - 1;
      // Success: ourStart < oppFirst (strict less than, not equal = trade)
      const isSuccess = ourStart < oppFirst && oppFirst <= ourEnd;
      const isTrade = ourStart === oppFirst && oppFirst <= ourEnd;
      
      if (isSuccess || isTrade) {
        results.push({
          move,
          prefix: prefix.name,
          prefixFrames: prefix.frames,
          ourActiveStart: ourStart,
          ourActiveEnd: ourEnd,
          coversOpponent: isSuccess,
          isTrade: isTrade,
        });
      }
    }
  }
  
  return results.sort((a, b) => a.ourActiveStart - b.ourActiveStart).slice(0, 50);
});

// Throw filler moves (exclude throws, keep reasonable total frames)
const throwFillerMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter((m: Move) => {
    if (m.category === 'throw') return false;
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
}

const throwResults = computed<ThrowComboResult[]>(() => {
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
      });
    }

    for (const move of throwFillerMoves.value) {
      const fillerStartup = parseInt(move.startup) || 0;
      const fillerActive = parseTotalActiveFrames(move.active);
      const fillerRecovery = parseTotalRecoveryFrames(move.recovery);
      const fillerFrames = fillerStartup + fillerActive + fillerRecovery;
      const delay = prefix.frames + fillerFrames;

      if (delay < minDelay || delay > maxDelay) continue;

      const key = `${prefix.name}|${move.name}|${prefix.frames}|${fillerFrames}`;
      results.push({
        key,
        prefix: prefix.name,
        prefixFrames: prefix.frames,
        filler: move,
        fillerName: move.name,
        fillerFrames,
        fillerStartup,
        fillerActive,
        fillerRecovery,
        delay,
        firstActive: delay + throwStart,
      });
    }
  }

  return results
    .sort((a, b) => a.delay - b.delay)
    .slice(0, 50);
});

// Actions
// Character data modules
const characterModules = import.meta.glob('../data/characters/*.json');

async function loadCharacterData() {
  if (!selectedCharacterId.value) {
    frameData.value = null;
    return;
  }
  loading.value = true;
  try {
    const path = `../data/characters/${selectedCharacterId.value}.json`;
    const loader = characterModules[path];
    
    if (!loader) {
      console.error(`Character data not found for: ${selectedCharacterId.value}`);
      frameData.value = null;
      return;
    }

    const module = await loader() as { default: FrameData };
    frameData.value = module.default;
    
    selectedKnockdownMove.value = null;
    useCustomKnockdown.value = false;
    comboChain.value = [];
  } catch (e) {
    console.error('Failed to load character data:', e);
    frameData.value = null;
  } finally {
    loading.value = false;
  }
}

function selectKnockdownMove(move: Move) {
  selectedKnockdownMove.value = move;
  useCustomKnockdown.value = false;
}

function enableCustomKnockdown() {
  useCustomKnockdown.value = true;
  selectedKnockdownMove.value = null;
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
  const active = parseTotalActiveFrames(move.active);
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
</script>

<template>
  <div class="oki-view container">
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
      <select v-model="selectedCharacterId" @change="loadCharacterData" class="character-select">
        <option value="">-- 选择角色 --</option>
        <option v-for="char in SF6_CHARACTERS" :key="char.id" :value="char.id">
          {{ char.name }} {{ char.nameJp ? `(${char.nameJp})` : '' }}
        </option>
      </select>
    </section>
    
    <div v-if="loading" class="loading-state"><p>加载中...</p></div>
    
    <!-- Step 2: Knockdown -->
    <section v-else-if="frameData" class="oki-section">
      <h2 class="section-title">
        <span class="step-number">2</span>
        击倒数据
      </h2>
      
      <div class="custom-knockdown-row">
        <button :class="['custom-kd-btn', { active: useCustomKnockdown }]" @click="enableCustomKnockdown">
          自定义
        </button>
        <div v-if="useCustomKnockdown" class="custom-kd-input">
          <span>击倒帧:</span>
          <input type="number" v-model.number="customKnockdownAdv" min="1" max="100" />
          <span>F</span>
        </div>
      </div>
      
      <div v-if="!useCustomKnockdown" class="knockdown-grid">
        <button
          v-for="move in knockdownMoves"
          :key="move.name"
          :class="['knockdown-card', { active: selectedKnockdownMove?.name === move.name }]"
          @click="selectKnockdownMove(move)"
        >
          <span class="move-name">{{ move.name }}</span>
          <span class="move-input">{{ move.input }}</span>
          <span class="move-advantage" v-if="move.knockdown">+{{ move.knockdown.advantage }}F</span>
        </button>
      </div>
    </section>
    
    <!-- Step 3: Combo Builder -->
    <section v-if="effectiveKnockdownAdv > 0 && frameData" class="oki-section results-section">
      <h2 class="section-title">
        <span class="step-number">3</span>
        组合链计算
      </h2>
      
      <!-- Opponent Info -->
      <div class="opponent-info">
        <span>对手第一帧: {{ effectiveKnockdownAdv }} + </span>
        <input type="number" v-model.number="opponentReversalStartup" min="1" max="30" class="small-input" />
        <span> = <strong class="frame-negative">{{ opponentFirstFrame }}F</strong></span>
      </div>
      
      <!-- Combo Chain Builder -->
      <div class="combo-builder">
        <div class="combo-chain">
          <div v-for="(action, idx) in comboChain" :key="idx" class="chain-item">
            <span class="chain-name">{{ action.name }}</span>
            <span class="chain-frames">{{ action.frames }}F</span>
            <button class="chain-remove" @click="removeAction(idx)">×</button>
            <span v-if="idx < comboChain.length - 1" class="chain-plus">+</span>
          </div>
          <span v-if="comboChain.length === 0" class="chain-empty">点击下方添加动作</span>
        </div>
        
        <div class="combo-actions">
          <button class="action-btn dash-btn" @click="addDash">
            + 前冲 ({{ stats?.forwardDash }}F)
          </button>
          <div class="move-search">
            <input 
              type="text" 
              v-model="moveSearchQuery" 
              placeholder="搜索招式..."
              class="move-search-input"
            />
            <div v-if="moveSearchQuery" class="move-dropdown">
              <button
                v-for="move in filteredMoves"
                :key="move.name"
                class="move-option"
                @click="addMove(move)"
              >
                <span>{{ move.name }}</span>
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
          <span class="result-label">对手第一帧:</span>
          <span class="result-value enemy">{{ opponentFirstFrame }}F</span>
        </div>
        <div class="result-row">
          <span class="result-status" :class="{ success: comboResult.coversOpponent }">
            {{ comboResult.status }}
          </span>
        </div>
      </div>
      
      <!-- Auto Results -->
      <div class="results-header-row">
        <h3 class="results-title">自动匹配 ({{ okiResults.length }}个成功)</h3>
        <button 
          v-if="comboChain.length > 0"
          :class="['prefix-btn', { active: useChainAsPrefix }]"
          @click="useChainAsPrefix = !useChainAsPrefix"
        >
          {{ useChainAsPrefix ? '✓ 使用组合前置' : '以当前组合为前置' }}
        </button>
      </div>
      <p v-if="useChainAsPrefix" class="prefix-info">
        前置: <strong>{{ comboChainPrefixName }} ({{ comboChainPrefixFrames }}F)</strong> + 招式
      </p>
      
      <div v-if="okiResults.length > 0" class="results-table">
        <div class="result-header">
          <span>组合</span>
          <span>发生</span>
          <span>打击帧</span>
        </div>
        <div 
          v-for="result in okiResults" 
          :key="`${result.prefix}${result.move.name}`"
          :class="['result-row-auto', { 
            expanded: selectedResultKey === `${result.prefix}${result.move.name}`,
            success: result.coversOpponent,
            trade: result.isTrade
          }]"
          @click="toggleResultDetail(`${result.prefix}${result.move.name}`)"
        >
          <div class="result-combo">
            <span v-if="result.coversOpponent" class="success-badge">压制</span>
            <span v-if="result.isTrade" class="trade-badge">相杀</span>
            <span v-if="result.prefix" class="combo-prefix">{{ result.prefix }}</span>
            <span v-if="result.prefix">+</span>
            <span>{{ result.move.name }}</span>
            <span class="move-input">{{ result.move.input }}</span>
          </div>
          <span>{{ result.prefixFrames + parseInt(result.move.startup) }}F</span>
          <span>{{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F</span>
          
          <!-- Expandable Detail -->
          <div v-if="selectedResultKey === `${result.prefix}${result.move.name}`" class="result-detail" @click.stop>
            <div class="detail-title">帧数详情</div>
            <div class="detail-row">
              <span class="detail-label">前置动作:</span>
              <span>{{ result.prefix || '无' }} = {{ result.prefixFrames }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">招式发生:</span>
              <span>{{ result.move.name }} = {{ result.move.startup }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">招式持续:</span>
              <span>{{ result.move.active }} (共{{ result.ourActiveEnd - result.ourActiveStart + 1 }}帧)</span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">计算:</span>
              <span>{{ result.prefixFrames }} + {{ result.move.startup }} = {{ result.ourActiveStart }}F 第一次打击</span>
            </div>
            <div class="detail-row calc">
              <span class="detail-label">打击范围:</span>
              <span class="frame-positive">{{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">对手第一帧:</span>
              <span class="frame-negative">{{ opponentFirstFrame }}F</span>
            </div>
            <div class="detail-row result">
              <span class="detail-label">判定:</span>
              <span v-if="result.coversOpponent" class="success">✓ 压制成功: {{ result.ourActiveStart }} < {{ opponentFirstFrame }} ≤ {{ result.ourActiveEnd }}</span>
              <span v-else-if="result.isTrade" class="trade">⚠ 相杀: {{ result.ourActiveStart }} = {{ opponentFirstFrame }}</span>
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
      </div>

      <div class="throw-math">
        <div class="math-row">
          <span class="math-label">最早可被投帧:</span>
          <span class="math-value">{{ effectiveKnockdownAdv }} + {{ normalizedThrowInvul }} = {{ earliestThrowableFrame }}F</span>
        </div>
        <div class="math-row">
          <span class="math-label">理想按投延迟:</span>
          <span class="math-value">S = N + I − T = {{ effectiveKnockdownAdv }} + {{ normalizedThrowInvul }} − {{ normalizedThrowStartup }} = {{ throwDelayMax }}F</span>
        </div>
        <div class="math-row">
          <span class="math-label">允许的按投窗口:</span>
          <span class="math-value">{{ throwDelayMin }}F ~ {{ throwDelayMax }}F</span>
        </div>
        <div class="math-row">
          <span class="math-label">第一帧判定允许范围:</span>
          <span class="math-value">{{ throwFirstActiveMin }}F ~ {{ throwFirstActiveMax }}F</span>
        </div>
      </div>

      <div v-if="throwDelayMax < 0" class="throw-warning">
        当前击倒优势不足，无法在起身可投前完成投起手（需要负延迟）。
      </div>

      <div class="results-header-row throw-results-header">
        <h3 class="results-title">循环投组合 ({{ throwResults.length }}个)</h3>
      </div>
      <p v-if="useChainAsPrefix && comboChain.length > 0" class="prefix-info">
        前置: <strong>{{ comboChainPrefixName }} ({{ comboChainThrowPrefixFrames }}F)</strong> + 空挥 + 投
      </p>

      <div v-if="throwResults.length > 0" class="results-table">
        <div class="result-header throw-header">
          <span>组合</span>
          <span>延迟S</span>
          <span>第一帧判定</span>
        </div>
        <div
          v-for="result in throwResults"
          :key="result.key"
          :class="['result-row-auto', 'throw-row', { expanded: selectedThrowResultKey === result.key }]"
          @click="toggleThrowResultDetail(result.key)"
        >
          <div class="result-combo">
            <span v-if="result.prefix" class="combo-prefix">{{ result.prefix }}</span>
            <span v-if="result.prefix">+</span>
            <span v-if="result.fillerName !== '直接投'">{{ result.fillerName }}</span>
            <span v-if="result.fillerName !== '直接投'">+</span>
            <span>投</span>
            <span v-if="result.filler" class="move-input">{{ result.filler.input }}</span>
          </div>
          <span>{{ result.delay }}F</span>
          <span>{{ result.firstActive }}F</span>

          <div v-if="selectedThrowResultKey === result.key" class="result-detail" @click.stop>
            <div class="detail-title">帧数详情</div>
            <div class="detail-row">
              <span class="detail-label">前置动作:</span>
              <span>{{ result.prefix || '无' }} = {{ result.prefixFrames }}F</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">空挥招式:</span>
              <span v-if="result.filler">
                {{ result.fillerName }} = {{ result.fillerStartup }} + {{ result.fillerActive }} + {{ result.fillerRecovery }} = {{ result.fillerFrames }}F
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

.custom-kd-btn:hover, .custom-kd-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.custom-kd-input {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.custom-kd-input input, .small-input {
  width: 60px;
  padding: var(--space-xs);
  text-align: center;
  font-family: var(--font-mono);
}

.knockdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--space-sm);
  max-height: 160px;
  overflow-y: auto;
}

.knockdown-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.knockdown-card:hover { border-color: var(--color-accent); }
.knockdown-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-light);
}

.knockdown-card .move-name { font-weight: 600; font-size: var(--font-size-sm); }
.knockdown-card .move-input { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--color-text-muted); }
.knockdown-card .move-advantage { color: var(--color-positive); font-weight: 600; }

/* Opponent Info */
.opponent-info {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-md);
  padding: var(--space-sm);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
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

.chain-name { font-weight: 600; }
.chain-frames { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--color-text-muted); }
.chain-remove {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0 4px;
}
.chain-remove:hover { color: var(--color-negative); }
.chain-plus { color: var(--color-text-muted); font-weight: 600; margin: 0 var(--space-xs); }
.chain-empty { color: var(--color-text-muted); }

.combo-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
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
}

.move-option:hover { background: var(--color-bg-tertiary); }
.move-option:last-child { border-bottom: none; }

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

.result-label { color: var(--color-text-muted); }
.result-value { font-family: var(--font-mono); font-weight: 600; }
.result-value.enemy { color: var(--color-negative); }
.result-status { font-weight: 700; padding: var(--space-xs) var(--space-md); border-radius: var(--radius-md); }
.result-status.success { background: var(--color-positive); color: white; }

/* Auto Results */
.results-section { border-color: var(--color-accent); }
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

.results-title { font-size: var(--font-size-md); color: var(--color-text-secondary); margin: 0; }

.prefix-btn {
  padding: var(--space-xs) var(--space-md);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
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

.results-table { overflow-x: auto; }

.result-header, .result-row-auto {
  display: grid;
  grid-template-columns: 2fr 1fr 1.5fr;
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

.result-combo { display: flex; gap: var(--space-xs); align-items: center; flex-wrap: wrap; }
.combo-prefix { background: rgba(0, 212, 255, 0.2); color: #00d4ff; padding: 2px 6px; border-radius: var(--radius-sm); font-size: var(--font-size-xs); }
.move-input { font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--color-text-muted); }

.loading-state, .empty-state { text-align: center; padding: var(--space-xl); color: var(--color-text-muted); }

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

.throw-warning {
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: rgba(214, 51, 132, 0.1);
  color: var(--color-negative);
  font-weight: 600;
}

@media (max-width: 640px) {
  .combo-actions { flex-direction: column; }
  .move-search { min-width: 100%; }
}
</style>
