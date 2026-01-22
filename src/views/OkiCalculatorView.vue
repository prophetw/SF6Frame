<script setup lang="ts">
import { ref, computed } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData, type CharacterStats } from '../types';

const selectedCharacterId = ref<string>('');
const selectedKnockdownMove = ref<Move | null>(null);
const frameData = ref<FrameData | null>(null);
const loading = ref(false);

// Custom knockdown advantage (for unlisted moves)
const customKnockdownAdv = ref<number>(0);
const useCustomKnockdown = ref(false);

// Opponent's fastest reversal startup (e.g., 4 for 4f jab)
const opponentReversalStartup = ref<number>(4);

// Forward dash bonus frames (Drive Rush gives +4, normal dash gives +2 in pressure situations)
const DASH_BONUS = 2;

// Effective knockdown advantage
const effectiveKnockdownAdv = computed(() => {
  if (useCustomKnockdown.value && customKnockdownAdv.value > 0) {
    return customKnockdownAdv.value;
  }
  return selectedKnockdownMove.value?.knockdown?.advantage || 0;
});

// Opponent wake-up frame (when they can first act)
const opponentWakeupFrame = computed(() => {
  return effectiveKnockdownAdv.value;
});

// Character stats
const stats = computed<CharacterStats | undefined>(() => frameData.value?.stats);

// Effective dash frames (actual dash frames minus bonus)
const effectiveDashFrames = computed(() => {
  if (!stats.value) return 0;
  return stats.value.forwardDash - DASH_BONUS;
});

// Knockdown moves with their frame advantages
const knockdownMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter((m: Move) => m.knockdown && m.knockdown.type !== 'none');
});

// All potential oki moves
const okiMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter((m: Move) => 
    m.category === 'normal' || m.category === 'special'
  );
});

// Extended Oki Result with combination info
interface ExtendedOkiResult {
  move: Move;
  prefix: string;
  prefixFrames: number;
  effectivePrefixFrames: number;  // After bonus adjustment
  timing: number;
  activeFrameHit: number;
  totalFrames: number;
  beatsReversal: boolean;
}

// Parse active frames (handles formats like "3", "2(5)3", etc.)
function parseActiveFrames(active: string): number {
  if (!active || active === '-') return 1;
  const match = String(active).match(/^\d+/);
  return match ? parseInt(match[0]) : 1;
}

// Calculate all oki combinations
const okiResults = computed<ExtendedOkiResult[]>(() => {
  if (effectiveKnockdownAdv.value <= 0) return [];
  if (!stats.value) return [];
  
  const kdAdv = effectiveKnockdownAdv.value;
  const opponentFirstActive = kdAdv + opponentReversalStartup.value;
  const results: ExtendedOkiResult[] = [];
  
  // Prefixes: no dash, or forward dash (with +2 bonus)
  const prefixes = [
    { name: '', frames: 0, effectiveFrames: 0 },
    { 
      name: '前冲', 
      frames: stats.value.forwardDash, 
      effectiveFrames: stats.value.forwardDash - DASH_BONUS  // Dash gives +2 advantage
    },
  ];
  
  for (const prefix of prefixes) {
    for (const move of okiMoves.value) {
      const startup = parseInt(move.startup) || 0;
      const totalActiveFrames = parseActiveFrames(move.active);
      
      if (startup <= 0) continue;
      
      // For each possible active frame
      for (let activeFrame = 1; activeFrame <= Math.min(totalActiveFrames, 10); activeFrame++) {
        // Formula: wait + effectivePrefixFrames + startup + (activeFrame - 1) = kdAdv
        // So: wait = kdAdv - effectivePrefixFrames - startup - (activeFrame - 1)
        const timing = kdAdv - prefix.effectiveFrames - startup - (activeFrame - 1);
        
        if (timing < 0) continue; // Can't start before knockdown
        if (timing > 40) continue; // Too long to wait
        
        // Total frames consumed from knockdown
        const totalFrames = timing + prefix.effectiveFrames + startup + (activeFrame - 1);
        
        // Check if this beats opponent's reversal
        // Our hit frame = kdAdv (we calculated timing to hit exactly on wake-up)
        // Opponent's reversal active frame = kdAdv + opponentReversalStartup
        // We beat them if our active hits before their active starts
        const ourActiveFrame = timing + prefix.effectiveFrames + startup + (activeFrame - 1);
        const beatsReversal = ourActiveFrame < opponentFirstActive;
        
        results.push({
          move,
          prefix: prefix.name,
          prefixFrames: prefix.frames,
          effectivePrefixFrames: prefix.effectiveFrames,
          timing,
          activeFrameHit: activeFrame,
          totalFrames,
          beatsReversal,
        });
      }
    }
  }
  
  // Sort: prefer meaty (timing=0), then by total frames, then without prefix
  return results
    .sort((a, b) => {
      if (a.timing !== b.timing) return a.timing - b.timing;
      if (a.prefixFrames !== b.prefixFrames) return a.prefixFrames - b.prefixFrames;
      return 0;
    })
    .slice(0, 30);
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
</script>

<template>
  <div class="oki-view container">
    <h1 class="page-title">压起身计算器</h1>
    <p class="page-desc">
      选择角色和击倒招式，计算最佳压起身组合（支持前冲+招式组合）
    </p>
    
    <!-- Character Stats -->
    <div v-if="stats" class="stats-bar">
      <span class="stat-item">
        <span class="stat-label">前冲</span>
        <span class="stat-value">{{ stats.forwardDash }}F</span>
        <span class="stat-bonus">(+{{ DASH_BONUS }}有利 = {{ effectiveDashFrames }}F)</span>
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
        选择击倒招式
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
          <span>击倒优势:</span>
          <input 
            type="number" 
            v-model.number="customKnockdownAdv" 
            min="1" 
            max="100"
            placeholder="如40"
          />
          <span>F</span>
        </div>
      </div>
      
      <div v-if="knockdownMoves.length === 0 && !useCustomKnockdown" class="empty-state">
        <p>该角色暂无击倒招式数据，请使用自定义输入</p>
      </div>
      
      <div v-else-if="!useCustomKnockdown" class="knockdown-grid">
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
        计算结果
      </h2>
      
      <div class="oki-settings">
        <div class="setting-row">
          <div class="setting-group">
            <label class="setting-label">击倒优势</label>
            <div class="setting-value highlight">
              <span class="frame-positive">+{{ effectiveKnockdownAdv }}F</span>
              <span v-if="selectedKnockdownMove" class="setting-move-name">
                ({{ selectedKnockdownMove.name }})
              </span>
              <span v-else class="setting-move-name">(自定义)</span>
            </div>
          </div>
          
          <div class="setting-group">
            <label class="setting-label" for="reversalStartup">对手最快反击</label>
            <div class="setting-input-wrapper">
              <input 
                id="reversalStartup"
                type="number" 
                v-model.number="opponentReversalStartup" 
                min="1" 
                max="20"
                class="setting-input"
              />
              <span class="input-suffix">F 发生</span>
            </div>
          </div>
          
          <div class="setting-group">
            <label class="setting-label">对手反击Active</label>
            <div class="setting-value">
              第 <strong class="frame-negative">{{ opponentWakeupFrame + opponentReversalStartup }}F</strong>
            </div>
          </div>
        </div>
        
        <div class="formula-info">
          <p><strong>公式:</strong> 等待 + 前冲({{ stats?.forwardDash }}F - {{ DASH_BONUS }}F有利) + 发生 + (Active-1) = 击倒优势</p>
          <p class="hint">✓ 表示我方Active早于对手反击Active</p>
        </div>
      </div>
      
      <!-- Results Table -->
      <div v-if="okiResults.length > 0" class="results-table">
        <div class="result-header">
          <span>组合</span>
          <span>发生</span>
          <span>Active</span>
          <span>等待</span>
          <span>有效帧</span>
          <span></span>
        </div>
        
        <div 
          v-for="result in okiResults" 
          :key="`${result.prefix}${result.move.name}-${result.activeFrameHit}`"
          :class="['result-row', { 'beats-reversal': result.beatsReversal, 'has-prefix': result.prefix }]"
        >
          <div class="result-combo">
            <span v-if="result.prefix" class="combo-prefix">
              {{ result.prefix }}
              <span class="prefix-detail">({{ result.prefixFrames }}-{{ DASH_BONUS }}={{ result.effectivePrefixFrames }}F)</span>
            </span>
            <span v-if="result.prefix" class="combo-arrow">→</span>
            <span class="move-name">{{ result.move.name }}</span>
            <span class="move-input">{{ result.move.input }}</span>
          </div>
          <span>{{ result.move.startup }}F</span>
          <span>{{ result.activeFrameHit }}/{{ result.move.active }}</span>
          <span :class="result.timing === 0 ? 'frame-positive' : ''">
            {{ result.timing }}F
          </span>
          <span class="total-frames">{{ result.totalFrames }}F</span>
          <span class="result-notes">
            <span v-if="result.beatsReversal" class="beat-badge">✓</span>
            <span v-if="result.timing === 0 && !result.prefix" class="meaty-badge">MEATY</span>
          </span>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <p>没有符合条件的压制组合</p>
      </div>
    </section>
    
    <!-- No Data State -->
    <div v-else-if="selectedCharacterId && !loading && !frameData" class="error-state">
      <p>暂无该角色的帧数据，请先运行数据脚本</p>
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

.stat-bonus {
  font-size: var(--font-size-xs);
  color: var(--color-positive);
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
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-sm);
  max-height: 250px;
  overflow-y: auto;
}

.knockdown-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-sm) var(--space-md);
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
  color: var(--color-text-primary);
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

/* Settings */
.oki-settings {
  margin-bottom: var(--space-lg);
  padding: var(--space-md);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
}

.setting-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xl);
  align-items: flex-start;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.setting-label {
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.setting-value {
  font-family: var(--font-mono);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.setting-move-name {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.setting-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.setting-input {
  width: 60px;
  padding: var(--space-xs) var(--space-sm);
  text-align: center;
  font-family: var(--font-mono);
  font-weight: 600;
}

.input-suffix {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.formula-info {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-border-light);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.formula-info .hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  margin-top: var(--space-xs);
}

/* Results */
.results-section {
  border-color: var(--color-accent);
}

.results-table {
  overflow-x: auto;
}

.result-header,
.result-row {
  display: grid;
  grid-template-columns: 3fr 1fr 1fr 1fr 1fr 0.5fr;
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

.result-row.beats-reversal {
  background: rgba(63, 185, 80, 0.08);
}

.result-row.has-prefix {
  background: rgba(0, 212, 255, 0.05);
}

.result-row.has-prefix.beats-reversal {
  background: linear-gradient(90deg, rgba(0, 212, 255, 0.08), rgba(63, 185, 80, 0.08));
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

.prefix-detail {
  font-size: 10px;
  opacity: 0.8;
}

.combo-arrow {
  color: var(--color-text-muted);
}

.result-combo .move-name {
  font-weight: 500;
}

.result-combo .move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.total-frames {
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}

.result-notes {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.beat-badge {
  color: var(--color-positive);
  font-weight: 700;
  font-size: var(--font-size-lg);
}

.meaty-badge {
  background: var(--color-positive);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
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
  
  .stat-bonus {
    display: none;
  }
  
  .knockdown-grid {
    grid-template-columns: 1fr 1fr;
  }
  
  .setting-row {
    flex-direction: column;
    gap: var(--space-md);
  }
  
  .result-header,
  .result-row {
    grid-template-columns: 2.5fr 1fr 1fr 1fr;
  }
  
  .result-header > :nth-child(5),
  .result-header > :nth-child(6),
  .result-row > :nth-child(5),
  .result-row > :nth-child(6) {
    display: none;
  }
  
  .prefix-detail {
    display: none;
  }
}
</style>
