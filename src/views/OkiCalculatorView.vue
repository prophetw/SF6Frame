<script setup lang="ts">
import { ref, computed } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData, type CharacterStats } from '../types';

const selectedCharacterId = ref<string>('');
const selectedKnockdownMove = ref<Move | null>(null);
const frameData = ref<FrameData | null>(null);
const loading = ref(false);

// Custom knockdown advantage (for unlisted moves)
const customKnockdownAdv = ref<number>(38);
const useCustomKnockdown = ref(false);

// Manual move selection
const manualMoveSearch = ref('');
const selectedManualMove = ref<Move | null>(null);
const includeDash = ref(true);

// Opponent's fastest reversal settings
const opponentReversalStartup = ref<number>(4);
const opponentReversalActive = ref<number>(3);

// Effective knockdown advantage
const effectiveKnockdownAdv = computed(() => {
  if (useCustomKnockdown.value && customKnockdownAdv.value > 0) {
    return customKnockdownAdv.value;
  }
  return selectedKnockdownMove.value?.knockdown?.advantage || 0;
});

// Character stats
const stats = computed<CharacterStats | undefined>(() => frameData.value?.stats);

// Opponent's reversal active frame range
const opponentActiveRange = computed(() => {
  const start = effectiveKnockdownAdv.value + opponentReversalStartup.value;
  const end = start + opponentReversalActive.value - 1;
  return { start, end };
});

// Knockdown moves with their frame advantages
const knockdownMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter((m: Move) => m.knockdown && m.knockdown.type !== 'none');
});

// ALL moves for oki (include all categories)
const allMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter((m: Move) => {
    const startup = parseInt(m.startup) || 0;
    return startup > 0 && startup <= 30;  // Only moves with reasonable startup
  });
});

// Filtered moves for manual search
const filteredMovesForSearch = computed<Move[]>(() => {
  if (!frameData.value) return [];
  const query = manualMoveSearch.value.toLowerCase();
  if (!query) return allMoves.value.slice(0, 20);
  return allMoves.value.filter((m: Move) => 
    m.name.toLowerCase().includes(query) ||
    m.input.toLowerCase().includes(query)
  ).slice(0, 20);
});

// Extended Oki Result
interface ExtendedOkiResult {
  move: Move;
  prefix: string;
  prefixFrames: number;
  ourActiveStart: number;
  ourActiveEnd: number;
  coversOpponent: boolean;
  overlaps: boolean;
  coverageInfo: string;
}

// Parse total active frames from string like "3", "2(5)3", "2*3" etc.
function parseTotalActiveFrames(active: string): number {
  if (!active || active === '-') return 1;
  // Sum all numbers in the string
  const matches = String(active).match(/\d+/g);
  if (!matches) return 1;
  return matches.reduce((sum, n) => sum + parseInt(n), 0);
}

// Calculate result for a specific move
function calculateMoveResult(move: Move, useDash: boolean): ExtendedOkiResult | null {
  if (!stats.value) return null;
  
  const prefixFrames = useDash ? stats.value.forwardDash : 0;
  const prefix = useDash ? '前冲' : '';
  const startup = parseInt(move.startup) || 0;
  const totalActive = parseTotalActiveFrames(move.active);
  
  if (startup <= 0) return null;
  
  const ourStart = prefixFrames + startup;
  const ourEnd = ourStart + totalActive - 1;
  
  // Opponent's first reversal active frame
  const opponentFirstFrame = opponentActiveRange.value.start;
  
  // Success = our active range contains opponent's first frame
  // ourStart <= opponentFirstFrame <= ourEnd
  const coversOpponent = ourStart <= opponentFirstFrame && opponentFirstFrame <= ourEnd;
  
  // Also check if we have any overlap at all
  const opponentEnd = opponentActiveRange.value.end;
  const overlaps = ourStart <= opponentEnd && ourEnd >= opponentFirstFrame;
  
  let coverageInfo = '';
  if (coversOpponent) {
    coverageInfo = '压制成功 ✓';
  } else if (ourEnd < opponentFirstFrame) {
    coverageInfo = '打击太早';
  } else if (ourStart > opponentFirstFrame) {
    coverageInfo = '打击太晚';
  } else {
    coverageInfo = '未覆盖';
  }
  
  return {
    move,
    prefix,
    prefixFrames,
    ourActiveStart: ourStart,
    ourActiveEnd: ourEnd,
    coversOpponent,
    overlaps,
    coverageInfo,
  };
}

// Manual move result
const manualMoveResult = computed<ExtendedOkiResult | null>(() => {
  if (!selectedManualMove.value || effectiveKnockdownAdv.value <= 0) return null;
  return calculateMoveResult(selectedManualMove.value, includeDash.value);
});

// Calculate all oki combinations
const okiResults = computed<ExtendedOkiResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0) return [];
  if (!stats.value) return [];
  
  const results: ExtendedOkiResult[] = [];
  
  const prefixes = [
    { useDash: false },
    { useDash: true },
  ];
  
  for (const prefixConfig of prefixes) {
    for (const move of allMoves.value) {
      const result = calculateMoveResult(move, prefixConfig.useDash);
      if (result && (result.overlaps || result.coversOpponent)) {
        results.push(result);
      }
    }
  }
  
  // Sort: fully covers first, then by start time
  return results
    .sort((a, b) => {
      if (a.coversOpponent !== b.coversOpponent) {
        return a.coversOpponent ? -1 : 1;
      }
      return a.ourActiveStart - b.ourActiveStart;
    })
    .slice(0, 50);
});

async function loadCharacterData() {
  if (!selectedCharacterId.value) {
    frameData.value = null;
    return;
  }
  
  loading.value = true;
  try {
    const module = await import(`../data/characters/${selectedCharacterId.value}.json`);
    frameData.value = module.default as FrameData;
    selectedKnockdownMove.value = null;
    selectedManualMove.value = null;
    useCustomKnockdown.value = false;
  } catch {
    frameData.value = null;
  } finally {
    loading.value = false;
  }
}

function selectMove(move: Move) {
  selectedKnockdownMove.value = move;
  useCustomKnockdown.value = false;
}

function enableCustomKnockdown() {
  useCustomKnockdown.value = true;
  selectedKnockdownMove.value = null;
}

function selectManualMove(move: Move) {
  selectedManualMove.value = move;
  manualMoveSearch.value = '';
}

function clearManualMove() {
  selectedManualMove.value = null;
}
</script>

<template>
  <div class="oki-view container">
    <h1 class="page-title">压起身计算器</h1>
    <p class="page-desc">
      计算我方打击帧范围是否覆盖对手反击帧范围
    </p>
    
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
      <span class="stat-item">
        <span class="stat-label">体力</span>
        <span class="stat-value">{{ stats.health }}</span>
      </span>
    </div>
    
    <!-- Step 1: Character Selection -->
    <section class="oki-section">
      <h2 class="section-title">
        <span class="step-number">1</span>
        选择角色
      </h2>
      
      <select 
        v-model="selectedCharacterId" 
        @change="loadCharacterData"
        class="character-select"
      >
        <option value="">-- 选择角色 --</option>
        <option 
          v-for="char in SF6_CHARACTERS" 
          :key="char.id" 
          :value="char.id"
        >
          {{ char.name }} {{ char.nameJp ? `(${char.nameJp})` : '' }}
        </option>
      </select>
    </section>
    
    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <p>加载中...</p>
    </div>
    
    <!-- Step 2: Knockdown Move -->
    <section v-else-if="frameData" class="oki-section">
      <h2 class="section-title">
        <span class="step-number">2</span>
        击倒数据
      </h2>
      
      <!-- Custom Knockdown Input -->
      <div class="custom-knockdown-row">
        <button 
          :class="['custom-kd-btn', { active: useCustomKnockdown }]"
          @click="enableCustomKnockdown"
        >
          自定义
        </button>
        <div v-if="useCustomKnockdown" class="custom-kd-input">
          <span>击倒后起身帧:</span>
          <input 
            type="number" 
            v-model.number="customKnockdownAdv" 
            min="1" 
            max="100"
            placeholder="38"
          />
          <span>F</span>
        </div>
      </div>
      
      <div v-if="!useCustomKnockdown" class="knockdown-grid">
        <button
          v-for="move in knockdownMoves"
          :key="move.name"
          :class="['knockdown-card', { active: selectedKnockdownMove?.name === move.name }]"
          @click="selectMove(move)"
        >
          <span class="move-name">{{ move.name }}</span>
          <span class="move-input">{{ move.input }}</span>
          <span class="move-advantage" v-if="move.knockdown">
            +{{ move.knockdown.advantage }}F
          </span>
        </button>
      </div>
    </section>
    
    <!-- Step 3: Settings & Results -->
    <section v-if="effectiveKnockdownAdv > 0 && frameData" class="oki-section results-section">
      <h2 class="section-title">
        <span class="step-number">3</span>
        计算设置 & 结果
      </h2>
      
      <div class="oki-settings">
        <!-- Frame Calculation Display -->
        <div class="frame-calc-box">
          <div class="calc-row opponent-row">
            <span class="calc-label">对手反击:</span>
            <div class="calc-formula">
              <span class="calc-value kd-value">{{ effectiveKnockdownAdv }}</span>
              <span class="calc-op">+</span>
              <input 
                type="number" 
                v-model.number="opponentReversalStartup" 
                min="1" 
                max="30"
                class="calc-input"
                title="发生帧"
              />
              <span class="calc-label-small">发生</span>
              <span class="calc-op">=</span>
              <span class="calc-result">{{ opponentActiveRange.start }}~{{ opponentActiveRange.end }}F</span>
              <span class="calc-label-small">(持续</span>
              <input 
                type="number" 
                v-model.number="opponentReversalActive" 
                min="1" 
                max="10"
                class="calc-input small"
                title="持续帧"
              />
              <span class="calc-label-small">F)</span>
            </div>
          </div>
        </div>
        
        <!-- Manual Move Selector -->
        <div class="manual-move-section">
          <div class="manual-header">
            <span class="manual-title">手动测试招式:</span>
            <label class="dash-toggle">
              <input type="checkbox" v-model="includeDash" />
              使用前冲 ({{ stats?.forwardDash }}F)
            </label>
          </div>
          
          <div class="manual-search">
            <input 
              type="text"
              v-model="manualMoveSearch"
              placeholder="搜索招式名或指令 (如 6HP, 波动拳)"
              class="search-input"
            />
            <button v-if="selectedManualMove" @click="clearManualMove" class="clear-btn">
              清除
            </button>
          </div>
          
          <!-- Move Selection Dropdown -->
          <div v-if="manualMoveSearch && !selectedManualMove" class="move-dropdown">
            <button
              v-for="move in filteredMovesForSearch"
              :key="move.name"
              class="move-option"
              @click="selectManualMove(move)"
            >
              <span class="move-name">{{ move.name }}</span>
              <span class="move-input">{{ move.input }}</span>
              <span class="move-startup">{{ move.startup }}F</span>
            </button>
          </div>
          
          <!-- Manual Result -->
          <div v-if="selectedManualMove && manualMoveResult" class="manual-result">
            <div class="manual-result-header">
              <span v-if="includeDash" class="combo-prefix">前冲 ({{ stats?.forwardDash }}F)</span>
              <span v-if="includeDash" class="combo-arrow">+</span>
              <span class="move-name">{{ selectedManualMove.name }}</span>
              <span class="move-input">{{ selectedManualMove.input }}</span>
            </div>
            <div class="manual-result-calc">
              <span class="calc-item">
                <span class="calc-label-small">发生:</span>
                <span>{{ selectedManualMove.startup }}F</span>
              </span>
              <span class="calc-item">
                <span class="calc-label-small">持续:</span>
                <span>{{ selectedManualMove.active }}</span>
              </span>
              <span class="calc-item">
                <span class="calc-label-small">打击帧:</span>
                <span class="frame-range-big">{{ manualMoveResult.ourActiveStart }}~{{ manualMoveResult.ourActiveEnd }}F</span>
              </span>
              <span class="calc-item">
                <span class="calc-label-small">对手:</span>
                <span class="frame-range-enemy">{{ opponentActiveRange.start }}~{{ opponentActiveRange.end }}F</span>
              </span>
              <span :class="['coverage-result', { success: manualMoveResult.coversOpponent, overlap: manualMoveResult.overlaps && !manualMoveResult.coversOpponent }]">
                {{ manualMoveResult.coverageInfo }}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Auto Results Table -->
      <h3 class="results-title">自动匹配结果 ({{ okiResults.length }})</h3>
      
      <div v-if="okiResults.length > 0" class="results-table">
        <div class="result-header">
          <span>组合</span>
          <span>发生</span>
          <span>持续</span>
          <span>打击帧</span>
          <span>判定</span>
        </div>
        
        <div 
          v-for="result in okiResults" 
          :key="`${result.prefix}${result.move.name}`"
          :class="['result-row', { 'covers': result.coversOpponent, 'has-prefix': result.prefix }]"
        >
          <div class="result-combo">
            <span v-if="result.prefix" class="combo-prefix">
              {{ result.prefix }} ({{ result.prefixFrames }}F)
            </span>
            <span v-if="result.prefix" class="combo-arrow">+</span>
            <span class="move-name">{{ result.move.name }}</span>
            <span class="move-input">{{ result.move.input }}</span>
          </div>
          <span>{{ result.move.startup }}F</span>
          <span>{{ result.move.active }}</span>
          <span class="frame-range">
            {{ result.ourActiveStart }}~{{ result.ourActiveEnd }}F
          </span>
          <span :class="['coverage-badge', { success: result.coversOpponent }]">
            {{ result.coverageInfo }}
          </span>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <p>没有符合条件的压制组合</p>
      </div>
    </section>
    
    <!-- No Data State -->
    <div v-else-if="selectedCharacterId && !loading && !frameData" class="error-state">
      <p>暂无该角色的帧数据</p>
      <code>pnpm exec tsx scripts/download-fat-data.ts</code>
    </div>
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
  margin-top: var(--space-sm);
  margin-bottom: var(--space-lg);
}

/* Stats Bar */
.stats-bar {
  display: flex;
  flex-wrap: wrap;
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

/* Custom Knockdown */
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
  color: var(--color-text-secondary);
  cursor: pointer;
  font-weight: 600;
  transition: all var(--transition-fast);
}

.custom-kd-btn:hover,
.custom-kd-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-light);
}

.custom-kd-input {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.custom-kd-input input {
  width: 80px;
  padding: var(--space-xs) var(--space-sm);
  text-align: center;
  font-family: var(--font-mono);
  font-weight: 600;
}

.knockdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-sm);
  max-height: 180px;
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
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
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
  font-size: var(--font-size-sm);
  color: var(--color-positive);
  font-weight: 600;
}

/* Frame Calculation Box */
.frame-calc-box {
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
}

.calc-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.calc-label {
  font-weight: 600;
  color: var(--color-text-secondary);
  min-width: 80px;
}

.calc-formula {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.calc-value {
  font-family: var(--font-mono);
  font-weight: 600;
  padding: 2px 8px;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-sm);
}

.kd-value {
  color: var(--color-accent);
}

.calc-op {
  color: var(--color-text-muted);
}

.calc-input {
  width: 50px;
  padding: 4px 8px;
  text-align: center;
  font-family: var(--font-mono);
  font-weight: 600;
  border-radius: var(--radius-sm);
}

.calc-input.small {
  width: 40px;
}

.calc-label-small {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.calc-result {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--color-negative);
  padding: 2px 8px;
  background: rgba(248, 81, 73, 0.15);
  border-radius: var(--radius-sm);
}

/* Manual Move Section */
.manual-move-section {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
}

.manual-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.manual-title {
  font-weight: 600;
  color: var(--color-text-primary);
}

.dash-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.dash-toggle input {
  width: 16px;
  height: 16px;
}

.manual-search {
  display: flex;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.search-input {
  flex: 1;
  padding: var(--space-sm);
}

.clear-btn {
  padding: var(--space-xs) var(--space-md);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.move-dropdown {
  max-height: 200px;
  overflow-y: auto;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.move-option {
  display: flex;
  width: 100%;
  gap: var(--space-md);
  padding: var(--space-sm);
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-border-light);
  cursor: pointer;
  text-align: left;
}

.move-option:hover {
  background: var(--color-bg-tertiary);
}

.move-option:last-child {
  border-bottom: none;
}

.move-option .move-name {
  flex: 1;
  font-weight: 500;
}

.move-option .move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.move-option .move-startup {
  font-family: var(--font-mono);
  color: var(--color-accent);
}

/* Manual Result */
.manual-result {
  background: var(--color-bg-card);
  border: 2px solid var(--color-accent);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}

.manual-result-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
  font-size: var(--font-size-lg);
}

.manual-result-calc {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  align-items: center;
}

.calc-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.frame-range-big {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: var(--font-size-lg);
  color: var(--color-positive);
}

.frame-range-enemy {
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--color-negative);
}

.coverage-result {
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  font-weight: 700;
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
}

.coverage-result.success {
  background: var(--color-positive);
  color: white;
}

.coverage-result.overlap {
  background: rgba(210, 153, 34, 0.2);
  color: var(--color-warning);
}

/* Results */
.results-section {
  border-color: var(--color-accent);
}

.results-title {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-md);
}

.results-table {
  overflow-x: auto;
}

.result-header,
.result-row {
  display: grid;
  grid-template-columns: 2.5fr 1fr 1fr 1.5fr 1.5fr;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-md);
  align-items: center;
  font-size: var(--font-size-sm);
}

.result-header {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.result-row {
  border-bottom: 1px solid var(--color-border-light);
}

.result-row:last-child {
  border-bottom: none;
}

.result-row.covers {
  background: rgba(63, 185, 80, 0.1);
}

.result-row.has-prefix {
  background: rgba(0, 212, 255, 0.05);
}

.result-row.has-prefix.covers {
  background: linear-gradient(90deg, rgba(0, 212, 255, 0.08), rgba(63, 185, 80, 0.1));
}

.result-combo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.combo-prefix {
  background: rgba(0, 212, 255, 0.2);
  color: #00d4ff;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.combo-arrow {
  color: var(--color-text-muted);
  font-weight: 600;
}

.result-combo .move-name,
.manual-result-header .move-name {
  font-weight: 500;
}

.result-combo .move-input,
.manual-result-header .move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.frame-range {
  font-family: var(--font-mono);
}

.coverage-badge {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
}

.coverage-badge.success {
  background: var(--color-positive);
  color: white;
  font-weight: 700;
}

/* States */
.loading-state,
.error-state,
.empty-state {
  text-align: center;
  padding: var(--space-xl);
  color: var(--color-text-muted);
}

.error-state code {
  display: block;
  margin-top: var(--space-md);
  background: var(--color-bg-tertiary);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

/* Mobile */
@media (max-width: 768px) {
  .stats-bar {
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
  }
  
  .knockdown-grid {
    grid-template-columns: 1fr 1fr;
  }
  
  .calc-label {
    min-width: auto;
    width: 100%;
  }
  
  .manual-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-sm);
  }
  
  .manual-result-calc {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .result-header,
  .result-row {
    grid-template-columns: 2fr 1fr 1fr 1.5fr;
  }
  
  .result-header > :nth-child(5),
  .result-row > :nth-child(5) {
    display: none;
  }
}
</style>
