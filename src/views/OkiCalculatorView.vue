<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData, type OkiResult } from '../types';

const selectedCharacterId = ref<string>('');
const selectedKnockdownMove = ref<Move | null>(null);
const frameData = ref<FrameData | null>(null);
const loading = ref(false);

// Target active frame to hit (e.g., 5 = hit with 5th active frame)
const targetActiveFrame = ref<number>(1);

// Opponent's fastest reversal startup (e.g., 4 for 4f jab)
const opponentReversalStartup = ref<number>(4);

// Knockdown moves with their frame advantages
const knockdownMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter(m => m.knockdown && m.knockdown.type !== 'none');
});

// Common oki moves for calculation
const okiMoves = computed<Move[]>(() => {
  if (!frameData.value) return [];
  return frameData.value.moves.filter(m => 
    m.category === 'normal' || m.category === 'special'
  );
});

// Parse active frames (handles formats like "3", "2(5)3", etc.)
function parseActiveFrames(active: string): number {
  if (!active || active === '-') return 1;
  // Get the first number which is the initial active frames
  const match = String(active).match(/^\d+/);
  return match ? parseInt(match[0]) : 1;
}

// Calculate oki timing based on target active frame
const okiResults = computed<OkiResult[]>(() => {
  if (!selectedKnockdownMove.value?.knockdown) return [];
  
  const kdAdvantage = selectedKnockdownMove.value.knockdown.advantage;
  const targetActive = targetActiveFrame.value;
  const results: OkiResult[] = [];
  
  for (const move of okiMoves.value) {
    const startup = parseInt(move.startup) || 0;
    const totalActiveFrames = parseActiveFrames(move.active);
    
    if (startup <= 0) continue;
    if (targetActive > totalActiveFrames) continue; // Can't use this active frame
    
    // Calculate timing: kdAdvantage - startup - (targetActive - 1)
    // This ensures the targetActive-th frame hits on the opponent's first actionable frame
    const timing = kdAdvantage - startup - (targetActive - 1);
    
    if (timing >= 0 && timing <= 60) { // Reasonable oki window
      // Check if this beats opponent's reversal
      // When our active frame hits, opponent needs at least that many frames to start their move
      const beatsReversal = targetActive >= opponentReversalStartup.value;
      
      results.push({
        move,
        timing,
        activeFrameHit: targetActive,
        isMeaty: timing <= 2 && targetActive === 1,
        notes: generateTimingNote(timing, targetActive, beatsReversal),
      });
    }
  }
  
  // Sort by timing (prefer immediate or short wait)
  return results.sort((a, b) => a.timing - b.timing).slice(0, 15);
});

function generateTimingNote(timing: number, activeFrame: number, beatsReversal: boolean): string {
  let note = '';
  if (timing === 0) {
    note = '立即使用';
  } else {
    note = `等待 ${timing}F`;
  }
  
  if (activeFrame > 1) {
    note += ` (第${activeFrame}段active打击)`;
  }
  
  if (beatsReversal) {
    note += ' ✓';
  }
  
  return note;
}

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
  } catch {
    frameData.value = null;
  } finally {
    loading.value = false;
  }
}

function selectMove(move: Move) {
  selectedKnockdownMove.value = move;
}

function formatFrameValue(val: string | number): string {
  const num = typeof val === 'string' ? parseInt(val) : val;
  if (isNaN(num)) return String(val);
  return num > 0 ? `+${num}` : String(num);
}

function getFrameClass(val: string | number): string {
  const num = typeof val === 'string' ? parseInt(val) : val;
  if (isNaN(num)) return '';
  if (num > 0) return 'frame-positive';
  if (num < 0) return 'frame-negative';
  return 'frame-neutral';
}
</script>

<template>
  <div class="oki-view container">
    <h1 class="page-title">压起身计算器</h1>
    <p class="page-desc">
      选择角色和击倒招式，计算最佳压起身时机
    </p>
    
    <!-- Character Stats -->
    <div v-if="frameData?.stats" class="stats-bar">
      <span class="stat-item">
        <span class="stat-label">前冲</span>
        <span class="stat-value">{{ frameData.stats.forwardDash }}F</span>
      </span>
      <span class="stat-item">
        <span class="stat-label">后冲</span>
        <span class="stat-value">{{ frameData.stats.backDash }}F</span>
      </span>
      <span class="stat-item">
        <span class="stat-label">体力</span>
        <span class="stat-value">{{ frameData.stats.health }}</span>
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
      
      <div v-if="knockdownMoves.length === 0" class="empty-state">
        <p>该角色暂无击倒招式数据</p>
      </div>
      
      <div v-else class="knockdown-grid">
        <button
          v-for="move in knockdownMoves"
          :key="move.name"
          :class="['knockdown-card', { active: selectedKnockdownMove?.name === move.name }]"
          @click="selectMove(move)"
        >
          <span class="move-name">{{ move.name }}</span>
          <span class="move-input">{{ move.input }}</span>
          <span class="move-advantage" v-if="move.knockdown">
            KD: +{{ move.knockdown.advantage }}F
          </span>
        </button>
      </div>
    </section>
    
    <!-- Step 3: Settings & Results -->
    <section v-if="selectedKnockdownMove && frameData" class="oki-section results-section">
      <h2 class="section-title">
        <span class="step-number">3</span>
        设置 & 计算结果
      </h2>
      
      <div class="oki-settings">
        <div class="setting-group">
          <label class="setting-label">击倒招式</label>
          <div class="setting-value highlight">
            {{ selectedKnockdownMove.name }}
            <span class="frame-positive">+{{ selectedKnockdownMove.knockdown?.advantage }}F</span>
          </div>
        </div>
        
        <div class="setting-group">
          <label class="setting-label" for="targetActive">目标Active帧</label>
          <div class="setting-input-wrapper">
            <input 
              id="targetActive"
              type="number" 
              v-model.number="targetActiveFrame" 
              min="1" 
              max="10"
              class="setting-input"
            />
            <span class="input-suffix">帧打击</span>
          </div>
          <p class="setting-hint">设为5表示用招式第5段active帧打击对方</p>
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
            <span class="input-suffix">F (如4F轻拳)</span>
          </div>
          <p class="setting-hint">✓ 表示该压制能击败对手{{ opponentReversalStartup }}F招式</p>
        </div>
      </div>
      
      <!-- Results Table -->
      <div v-if="okiResults.length > 0" class="results-table">
        <div class="result-header">
          <span>招式</span>
          <span>发生</span>
          <span>Active</span>
          <span>等待</span>
          <span>备注</span>
        </div>
        
        <div 
          v-for="result in okiResults" 
          :key="result.move.name"
          :class="['result-row', { 'is-meaty': result.isMeaty }]"
        >
          <div class="result-move">
            <span class="move-name">{{ result.move.name }}</span>
            <span class="move-input">{{ result.move.input }}</span>
          </div>
          <span>{{ result.move.startup }}F</span>
          <span>{{ result.move.active }}</span>
          <span :class="result.timing === 0 ? 'frame-positive' : ''">
            {{ result.timing }}F
          </span>
          <span class="result-notes">
            {{ result.notes }}
            <span v-if="result.isMeaty" class="meaty-badge">MEATY</span>
          </span>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <p>没有符合条件的压制招式</p>
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

.knockdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-md);
  max-height: 300px;
  overflow-y: auto;
}

.knockdown-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md);
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
}

.knockdown-card .move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.knockdown-card .move-advantage {
  font-size: var(--font-size-sm);
  color: var(--color-positive);
  font-weight: 600;
}

/* Settings */
.oki-settings {
  display: grid;
  gap: var(--space-lg);
  margin-bottom: var(--space-xl);
  padding: var(--space-lg);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-md);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.setting-label {
  font-weight: 600;
  color: var(--color-text-primary);
}

.setting-value {
  font-family: var(--font-mono);
}

.setting-value.highlight {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.setting-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.setting-input {
  width: 80px;
  padding: var(--space-xs) var(--space-sm);
  text-align: center;
  font-family: var(--font-mono);
  font-weight: 600;
}

.input-suffix {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.setting-hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
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
  grid-template-columns: 2fr 1fr 1fr 1fr 2fr;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  align-items: center;
}

.result-header {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.result-row {
  border-bottom: 1px solid var(--color-border-light);
}

.result-row:last-child {
  border-bottom: none;
}

.result-row.is-meaty {
  background: rgba(63, 185, 80, 0.1);
}

.result-move {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-move .move-name {
  font-weight: 500;
}

.result-move .move-input {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.result-notes {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--font-size-sm);
}

.meaty-badge {
  background: var(--color-positive);
  color: white;
  font-size: var(--font-size-xs);
  font-weight: 700;
  padding: 2px 6px;
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
@media (max-width: 640px) {
  .stats-bar {
    flex-wrap: wrap;
    gap: var(--space-md);
  }
  
  .knockdown-grid {
    grid-template-columns: 1fr;
  }
  
  .result-header,
  .result-row {
    grid-template-columns: 1.5fr 1fr 1fr 1fr;
    font-size: var(--font-size-sm);
  }
  
  .result-header > :last-child,
  .result-row > :last-child {
    display: none;
  }
}
</style>
