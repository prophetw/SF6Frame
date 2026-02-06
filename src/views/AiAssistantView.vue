<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData } from '../types';
import { getMoveDisplayName } from '../i18n';
import { 
  calculateGap, 
  parseFrameValue, 
  type CalculationResult 
} from '../utils/gapCalculator';

// State - Characters
const opponentCharId = ref<string>('ryu');
const myCharId = ref<string>('ken');
const opponentFrameData = ref<FrameData | null>(null);
const myFrameData = ref<FrameData | null>(null);
const loading = ref(false);

// State - Moves
const opponentMove1 = ref<Move | null>(null);
const opponentMove2 = ref<Move | null>(null);

// Search
const search1 = ref('');
const search2 = ref('');
const showDropdown1 = ref(false);
const showDropdown2 = ref(false);

// Result
const analysisResult = ref<CalculationResult | null>(null);

// Character Data Handling
const characterModules = import.meta.glob('../data/characters/*.json');

async function loadCharacterData(charId: string): Promise<FrameData | null> {
  const path = `../data/characters/${charId}.json`;
  const loader = characterModules[path];
  if (!loader) {
    console.error(`Character data not found for: ${charId}`);
    return null;
  }
  const module = await loader() as { default: FrameData };
  return module.default;
}

async function loadBothCharacters() {
  loading.value = true;
  try {
    const [oppData, myData] = await Promise.all([
      loadCharacterData(opponentCharId.value),
      loadCharacterData(myCharId.value)
    ]);
    opponentFrameData.value = oppData;
    myFrameData.value = myData;
    resetMoves();
  } finally {
    loading.value = false;
  }
}

function resetMoves() {
  opponentMove1.value = null;
  opponentMove2.value = null;
  search1.value = '';
  search2.value = '';
  analysisResult.value = null;
}

watch([opponentCharId, myCharId], () => {
  loadBothCharacters();
});

onMounted(() => {
  loadBothCharacters();
});

// Opponent Moves
const opponentMoves = computed(() => {
  if (!opponentFrameData.value) return [];
  return opponentFrameData.value.moves;
});

// My Moves (for counter recommendations)
const myMoves = computed(() => {
  if (!myFrameData.value) return [];
  return myFrameData.value.moves;
});

// Filtered Moves for Search
function filterMoves(moves: Move[], query: string): Move[] {
  const qRaw = query.trim();
  const qLower = qRaw.toLowerCase();
  if (!qRaw) return moves.slice(0, 30);
  
  return moves.filter(m => 
    m.name.toLowerCase().includes(qLower) || 
    (m.nameZh && m.nameZh.includes(qRaw)) ||
    m.input.toLowerCase().includes(qLower)
  ).slice(0, 30);
}

const filteredMoves1 = computed(() => filterMoves(opponentMoves.value, search1.value));
const filteredMoves2 = computed(() => filterMoves(opponentMoves.value, search2.value));

function selectMove1(move: Move) {
  opponentMove1.value = move;
  search1.value = getMoveDisplayName(move);
  showDropdown1.value = false;
  opponentMove2.value = null;
  search2.value = '';
  analysisResult.value = null;
}

function selectMove2(move: Move) {
  opponentMove2.value = move;
  search2.value = getMoveDisplayName(move);
  showDropdown2.value = false;
}

function handleBlur1() {
  setTimeout(() => { showDropdown1.value = false; }, 200);
}

function handleBlur2() {
  setTimeout(() => { showDropdown2.value = false; }, 200);
}

// Analysis
function analyzeCombo() {
  if (!opponentMove1.value || !opponentMove2.value) return;
  
  analysisResult.value = calculateGap({
    move1: opponentMove1.value,
    move2: opponentMove2.value,
    type: 'block', // Assuming opponent's combo on block
    mode: 'link',
    hitState: 'normal',
    cancelFrame: 1,
    isBurnout: false
  });
}

// Counter Recommendations  
const counterMoves = computed(() => {
  if (!analysisResult.value || !analysisResult.value.valid) return [];
  
  const gap = analysisResult.value.gap;
  
  // If gap <= 0, it's true blockstring - only invincible reversals can work
  // If gap >= 1, moves with startup <= gap can interrupt
  
  return myMoves.value
    .filter(m => {
      // Only consider reversals (supers, dp-like moves) or fast normals
      const startup = parseFrameValue(m.startup);
      if (startup <= 0) return false;
      
      // For true blockstrings, only invincible moves can work
      if (gap <= 0) {
        // Check if it's a super or has invincibility in name
        return m.category === 'super' || 
               m.name.toLowerCase().includes('reversal') ||
               m.input.includes('623') || // DP motion
               m.name.includes('Super');
      }
      
      // For frame traps, only faster moves can interrupt
      return startup <= gap;
    })
    .sort((a, b) => {
      // Prioritize by startup (faster first)
      const startA = parseFrameValue(a.startup);
      const startB = parseFrameValue(b.startup);
      if (startA !== startB) return startA - startB;
      
      // Then by damage
      const dmgA = parseInt(a.damage) || 0;
      const dmgB = parseInt(b.damage) || 0;
      return dmgB - dmgA;
    })
    .slice(0, 15);
});

// Status Text
const gapStatusText = computed(() => {
  if (!analysisResult.value) return '';
  const gap = analysisResult.value.gap;
  
  if (gap <= 0) {
    return '真连防 - 只能用无敌技反击';
  } else if (gap < 4) {
    return `${gap}F 间隙 - 可被快速招打断`;
  } else {
    return `${gap}F 间隙 - 容易被打断`;
  }
});

const gapStatusClass = computed(() => {
  if (!analysisResult.value) return '';
  const gap = analysisResult.value.gap;
  
  if (gap <= 0) return 'status-danger';
  if (gap < 4) return 'status-warning';
  return 'status-safe';
});
</script>

<template>
  <div class="ai-assistant-view container">
    <header class="page-header">
      <h1>🤖 AI 对策助手</h1>
      <p class="subtitle">分析对手连招的间隙，推荐反制招式</p>
    </header>
    
    <!-- Character Selection -->
    <section class="char-selection">
      <div class="char-box">
        <label>对手角色</label>
        <select v-model="opponentCharId" class="select-input">
          <option v-for="char in SF6_CHARACTERS" :key="char.id" :value="char.id">
            {{ char.name }}
          </option>
        </select>
      </div>
      
      <div class="vs-badge">VS</div>
      
      <div class="char-box">
        <label>我的角色</label>
        <select v-model="myCharId" class="select-input">
          <option v-for="char in SF6_CHARACTERS" :key="char.id" :value="char.id">
            {{ char.name }}
          </option>
        </select>
      </div>
    </section>
    
    <div v-if="loading" class="loading">加载数据中...</div>
    
    <template v-else>
      <!-- Opponent Combo Input -->
      <section class="combo-input card">
        <h2>对手连招</h2>
        <div class="combo-row">
          <!-- Move 1 -->
          <div class="move-selector">
            <label>第1招</label>
            <input 
              v-model="search1" 
              type="text" 
              placeholder="搜索招式..."
              class="search-input"
              @focus="showDropdown1 = true"
              @blur="handleBlur1"
            />
            <div v-if="showDropdown1" class="dropdown-list">
              <div 
                v-for="(move, index) in filteredMoves1" 
                :key="`${move.name}-${move.input}-${index}`"
                class="dropdown-item"
                @mousedown="selectMove1(move)"
              >
                <span class="move-name">{{ getMoveDisplayName(move) }}</span>
                <span class="move-input">{{ move.input }}</span>
              </div>
            </div>
          </div>
          
          <span class="arrow">→</span>
          
          <!-- Move 2 -->
          <div class="move-selector">
            <label>第2招</label>
            <input 
              v-model="search2" 
              type="text" 
              placeholder="搜索招式..."
              class="search-input"
              @focus="showDropdown2 = true"
              @blur="handleBlur2"
            />
            <div v-if="showDropdown2" class="dropdown-list">
              <div 
                v-for="(move, index) in filteredMoves2" 
                :key="`${move.name}-${move.input}-${index}`"
                class="dropdown-item"
                @mousedown="selectMove2(move)"
              >
                <span class="move-name">{{ getMoveDisplayName(move) }}</span>
                <span class="move-input">{{ move.input }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <button 
          class="analyze-btn" 
          :disabled="!opponentMove1 || !opponentMove2"
          @click="analyzeCombo"
        >
          🔍 分析间隙
        </button>
      </section>
      
      <!-- Analysis Result -->
      <section v-if="analysisResult && analysisResult.valid" class="result-section">
        <div class="result-card" :class="gapStatusClass">
          <div class="result-header">
            <span class="gap-value">{{ analysisResult.gap }}F</span>
            <span class="gap-label">Gap (间隙)</span>
          </div>
          <div class="result-status">{{ gapStatusText }}</div>
          <div class="formula">
            <code>{{ analysisResult.formulaDesc }}</code>
          </div>
        </div>
        
        <!-- Counter Recommendations -->
        <div v-if="counterMoves.length > 0" class="counter-section card">
          <h3>🎯 可打断招式 ({{ myCharId.toUpperCase() }})</h3>
          <div class="counter-list">
            <div 
              v-for="(move, index) in counterMoves" 
              :key="`${move.name}-${move.input}-${index}`"
              class="counter-item"
            >
              <span class="counter-name">{{ getMoveDisplayName(move) }}</span>
              <span class="counter-input">{{ move.input }}</span>
              <span class="counter-startup">{{ move.startup }}F</span>
            </div>
          </div>
        </div>
        
        <div v-else-if="analysisResult.gap <= 0" class="counter-section card warning">
          <h3>⚠️ 真连防</h3>
          <p>这是真的连防，只能用无敌技 (OD 升龙/超必) 反击，或老实防守。</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ai-assistant-view {
  padding-bottom: var(--space-2xl);
}

.page-header {
  text-align: center;
  margin-bottom: var(--space-xl);
}

.page-header h1 {
  font-size: 2rem;
  margin-bottom: var(--space-xs);
}

.subtitle {
  color: var(--color-text-muted);
}

/* Character Selection */
.char-selection {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: var(--space-lg);
  margin-bottom: var(--space-xl);
  flex-wrap: wrap;
}

.char-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.char-box label {
  font-weight: 500;
  color: var(--color-text-secondary);
}

.vs-badge {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-accent);
  padding: var(--space-sm);
}

.select-input {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 1rem;
  min-width: 150px;
}

.loading {
  text-align: center;
  padding: var(--space-xl);
  color: var(--color-text-muted);
}

/* Combo Input */
.combo-input {
  padding: var(--space-lg);
  margin-bottom: var(--space-xl);
}

.combo-input h2 {
  margin-bottom: var(--space-md);
  font-size: var(--font-size-lg);
}

.combo-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-md);
  flex-wrap: wrap;
  margin-bottom: var(--space-md);
}

.move-selector {
  flex: 1;
  min-width: 200px;
  position: relative;
}

.move-selector label {
  display: block;
  margin-bottom: var(--space-xs);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.arrow {
  font-size: 1.5rem;
  color: var(--color-text-muted);
}

.search-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 1rem;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.dropdown-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 250px;
  overflow-y: auto;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.dropdown-item {
  padding: var(--space-sm) var(--space-md);
  display: flex;
  justify-content: space-between;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border-dim);
}

.dropdown-item:hover {
  background: var(--color-bg-secondary);
}

.dropdown-item:last-child {
  border-bottom: none;
}

.move-name {
  font-weight: 500;
}

.move-input {
  color: var(--color-text-muted);
  font-family: monospace;
}

.analyze-btn {
  width: 100%;
  padding: var(--space-md);
  background: var(--gradient-fire);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--transition-normal);
}

.analyze-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.analyze-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Result Section */
.result-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.result-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  text-align: center;
  border-left: 6px solid transparent;
}

.result-card.status-safe {
  border-left-color: var(--color-success);
}

.result-card.status-warning {
  border-left-color: var(--color-warning);
}

.result-card.status-danger {
  border-left-color: var(--color-danger);
}

.result-header {
  margin-bottom: var(--space-md);
}

.gap-value {
  display: block;
  font-size: 3rem;
  font-weight: 800;
}

.gap-label {
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.result-status {
  font-size: 1.2rem;
  margin-bottom: var(--space-md);
  color: var(--color-text-primary);
}

.formula code {
  background: rgba(0, 0, 0, 0.2);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

/* Counter Section */
.counter-section {
  padding: var(--space-lg);
}

.counter-section h3 {
  margin-bottom: var(--space-md);
  font-size: var(--font-size-lg);
}

.counter-section.warning {
  border-left: 4px solid var(--color-warning);
}

.counter-section.warning p {
  color: var(--color-text-secondary);
}

.counter-list {
  display: grid;
  gap: var(--space-sm);
}

.counter-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
}

.counter-name {
  flex: 1;
  font-weight: 500;
}

.counter-input {
  color: var(--color-text-muted);
  font-family: monospace;
}

.counter-startup {
  background: var(--color-accent);
  color: white;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

/* Card */
.card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

/* Mobile */
@media (max-width: 640px) {
  .char-selection {
    flex-direction: column;
    align-items: stretch;
  }
  
  .vs-badge {
    text-align: center;
  }
  
  .combo-row {
    flex-direction: column;
  }
  
  .arrow {
    transform: rotate(90deg);
    text-align: center;
  }
}
</style>
