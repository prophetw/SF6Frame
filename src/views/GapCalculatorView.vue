<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData } from '../types';

// State
const selectedCharId = ref<string>('ryu'); // Default to Ryu
const frameData = ref<FrameData | null>(null);
const loading = ref(false);

const move1 = ref<Move | null>(null);
const move2 = ref<Move | null>(null);

// Calculation Mode
const calculationMode = ref<'link' | 'cancel'>('link');
const calculationType = ref<'block' | 'hit'>('block'); // New: Block (Gap) vs Hit (Combo)
const hitState = ref<'normal' | 'ch' | 'pc'>('normal'); // New: Hit State

const cancelFrame = ref(1); // 1-based index (1 = 1st active frame)

// Search
const search1 = ref('');
const search2 = ref('');
const showDropdown1 = ref(false);
const showDropdown2 = ref(false);

// Character Data Handling
const characterModules = import.meta.glob('../data/characters/*.json');

async function loadCharacterData(charId: string) {
  if (!charId) {
    frameData.value = null;
    return;
  }
  
  loading.value = true;
  try {
    const path = `../data/characters/${charId}.json`;
    const loader = characterModules[path];
    if (!loader) {
      console.error(`Character data not found for: ${charId}`);
      frameData.value = null;
      return;
    }

    const module = await loader() as { default: FrameData };
    frameData.value = module.default;
    
    // Reset selections on character change
    move1.value = null;
    move2.value = null;
    search1.value = '';
    search2.value = '';
    cancelFrame.value = 1;
  } catch (e) {
    console.error(`Failed to load character data for ${charId}:`, e);
    frameData.value = null;
  } finally {
    loading.value = false;
  }
}

watch(selectedCharId, (newId) => {
  loadCharacterData(newId);
});

onMounted(() => {
  loadCharacterData(selectedCharId.value);
});

// Move Filtering
const allMoves = computed(() => {
  if (!frameData.value) return [];
  return frameData.value.moves;
});

function filterMoves(query: string) {
  if (!allMoves.value) return [];
  const q = query.toLowerCase();
  if (!q) return allMoves.value.slice(0, 50);
  
  return allMoves.value.filter(m => 
    m.name.toLowerCase().includes(q) || 
    m.input.toLowerCase().includes(q)
  ).slice(0, 50);
}

const filteredMoves1 = computed(() => filterMoves(search1.value));
const filteredMoves2 = computed(() => filterMoves(search2.value));

function selectMove1(move: Move) {
  move1.value = move;
  search1.value = move.name;
  showDropdown1.value = false;
  cancelFrame.value = 1; // Reset cancel frame
}

function selectMove2(move: Move) {
  move2.value = move;
  search2.value = move.name;
  showDropdown2.value = false;
}

function handleBlur1() {
  setTimeout(() => {
    showDropdown1.value = false;
  }, 200);
}

function handleBlur2() {
  setTimeout(() => {
    showDropdown2.value = false;
  }, 200);
}

// Helpers
function parseFrameValue(val: string | number | undefined): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const parsed = parseInt(val);
  return isNaN(parsed) ? 0 : parsed;
}

// Calculation Logic
const calculationResult = computed(() => {
  if (!move1.value || !move2.value) return null;
  
  const adv1Block = parseFrameValue(move1.value.onBlock);
  const adv1Hit = parseFrameValue(move1.value.onHit); // Base OnHit
  const startup2Num = parseFrameValue(move2.value.startup);
  
  let adv1Num = calculationType.value === 'block' ? adv1Block : adv1Hit;

  if (calculationType.value === 'hit') {
    // Apply modifiers
    if (hitState.value === 'ch') adv1Num += 2;
    if (hitState.value === 'pc') adv1Num += 4; // Using +4 modifier standard
  }
  
  // Basic validation (only strictly need startup for logic)
  if (isNaN(startup2Num)) {
    return {
       valid: false,
       error: '无法获取有效的帧数数据'
    };
  }

  let gap = 0;
  let formulaDesc = '';
  let blockstun = 0;
  let status = '';
  let statusClass = '';
  let description = '';
  
  // === COMBO MODE (HIT) ===
  if (calculationType.value === 'hit') {
    // Formula: Link = Advantage - Startup
    // Logic: If I am +7, and startup is 6. 7 - 6 = +1 (1 frame wiggle room implies link? No).
    // Standard Link logic:
    // If I am +7. I recover at T. Opponent recovers at T+7.
    // Move 2 starts at T. Active at T + Startup - 1 ? No.
    // Move 2 Startup 6 -> Active on 6th frame. 1,2,3,4,5 (Start), 6 (Active).
    // So it hits at T + 5.
    // Opponent is stunned until T + 7.
    // Since T + 5 < T + 7, it combos.
    // Surplus = Advantage - (Startup - 1)?
    // Let's verify: +7 adv, 6 startup.
    // Startup Frames: 5. Active: 6.
    // Time available: 7.
    // 7 >= 6? No.
    // Usually: Link if Advantage >= Startup.
    // Example: Ryu 5MP (+7). 2MP (6). +7 >= 6. Link!
    // Example: Ryu 5MP (+7). 5HP (10). +7 < 10. No Link.
    
    // Gap/Surplus = Advantage - Startup.
    // If >= 0: Link.
    // If < 0: No link.
    
    // Wait, cancel logic for combo?
    if (calculationMode.value === 'cancel') {
        // Cancel Combo Logic
        // Advantage is irrelevant.
        // We cancel recovery.
        // Hitstun is key.
        // Hitstun = Active + Recovery + OnHit(Adv) (Derived) or Raw.Hitstun.
        const m1 = move1.value;
        const active1 = parseFrameValue(m1.active);
        const recovery1 = parseFrameValue(m1.recovery);
        let hitstun = 0;
        
        // Try getting raw hitstun
        if (m1.raw && typeof m1.raw.hitstun === 'number') {
           hitstun = m1.raw.hitstun;
        } else {
           hitstun = active1 + recovery1 + adv1Hit;
        }
        
        // Modifiers for Hitstun?
        // CH adds +2 to advantage, but does it add to hitstun? Yes.
        if (hitState.value === 'ch') hitstun += 2;
        if (hitState.value === 'pc') hitstun += 4;

        // Cancel Gap:
        // We cancel at cancelFrame.
        // Move 2 comes out relative to Cancel Point.
        // Move 2 hits at: cancelFrame + (Startup2 - 1).
        // Hitstun ends at: Hitstun duration.
        // Wait, active frames started at 1.
        // Hitstun starts at 1 (first active hit).
        // Condition: (cancelFrame + Startup2 - 1) <= hitstun.
        // Surplus = Hitstun - (cancelFrame + Startup2 - 1).
        
        const hitFrame = cancelFrame.value + startup2Num - 1;
        const surplus = hitstun - hitFrame;
        gap = surplus; // Reusing "gap" variable name for "surplus/result"
        
        formulaDesc = `${hitstun} (Hitstun) - (${cancelFrame} + ${startup2Num} - 1)`;
    } else {
        // Link Combo Logic
        // Surplus = Advantage - Startup
        // Wait, standard is Advantage >= Startup.
        // e.g. +4 adv, 4 startup.
        // Recover at T. Opponent stuck until T+4.
        // Start at T. Active at T+4-1 = T+3? No.
        // Startup 4 means inactive 1,2,3. Active 4.
        // So hits at T+3 (relative 0)? No.
        // Let's count.
        // Frame 1: Startup
        // Frame 2: Startup
        // Frame 3: Startup
        // Frame 4: Active.
        // You are +4. Opponent cannot block until Frame 5.
        // Your move hits at Frame 4.
        // 4 <= 4. Yes.
        // So Advantage >= Startup.
        
        gap = adv1Num - startup2Num;
        // Actually, let's call it "surplus".
        // If 0, it means Exact Link (Just Frame if strictly equal? No, standard 1F link).
        // If +1, 2F window.
        
        formulaDesc = `${adv1Num} (Adv) - ${startup2Num} (Startup)`;
    }

    if (gap >= 0) {
        status = '连招成立 (Combo)';
        statusClass = 'status-safe'; // Green
        description = `余流 ${gap} 帧 (Link Window: ${gap + 1}F?)。`; // Gap 0 = 1F link? 
        // If Gap = 0 (Adv 4, Startup 4), you must hit exactly 1 frame perfect?
        // Actually in SF6 there is input buffer so it's easier.
        // Let's just say "Successful Link".
        description = '可以连上。';
    } else {
        status = '连招失败 (No Combo)';
        statusClass = 'status-danger';
        description = `差 ${Math.abs(gap)} 帧。`;
    }

  } 
  // === BLOCK MODE (GAP) ===
  else {
      // Logic from previous step
      if (calculationMode.value === 'link') {
        gap = startup2Num - adv1Num - 1;
        formulaDesc = `${startup2Num} (Startup) - ${adv1Num} (Adv) - 1`;
      } else {
        const m1 = move1.value;
        const active1 = parseFrameValue(m1.active);
        const recovery1 = parseFrameValue(m1.recovery);
        
        if (m1.raw && typeof m1.raw.blockstun === 'number') {
          blockstun = m1.raw.blockstun;
        } else {
          blockstun = active1 + recovery1 + adv1Num; // adv1Num is OnBlock here
        }
        const cFrame = cancelFrame.value;
        gap = cFrame + (startup2Num - 1) - blockstun;
        formulaDesc = `${cFrame} (CancelFrame) + ${startup2Num - 1} (Startup-1) - ${blockstun} (Blockstun)`;
      }

      if (gap <= 0) {
        status = '连防 (True Blockstring)';
        statusClass = 'status-safe';
        description = '对手无法在两招之间做出任何动作。';
      } else if (gap < 4) {
        status = 'Frame Trap (伪连/打康陷阱)';
        statusClass = 'status-trap';
        description = '对手最快普通技（4F）无法抢动。';
      } else if (gap >= 4 && gap <= 9) {
        status = '可插动 (Interruptible)';
        statusClass = 'status-warning';
        description = '对手可以使用轻攻击抢动或相杀。';
      } else {
        status = '高风险 / 易被插 (High Risk)';
        statusClass = 'status-danger';
        description = '间隙过大，容易被无敌技或大伤害技确反。';
      }
  }
  
  return {
    valid: true,
    gap,
    status,
    statusClass,
    description,
    adv1: adv1Num,
    startup2: startup2Num,
    formulaDesc,
    blockstun,
    type: calculationType.value // Pass type to template
  };
});

</script>

<template>
  <div class="gap-calculator-view container">
    <header class="page-header">
      <h1>连招间隙计算器 (Gap Calculator)</h1>
      <p class="subtitle">计算两个攻击动作之间的帧数空隙，判断是否为伪连或连防。</p>
    </header>
    
    <!-- Character Selection -->
    <section class="selection-section">
      <div class="form-group">
        <label>选择角色</label>
        <select v-model="selectedCharId" class="select-input">
          <option v-for="char in SF6_CHARACTERS" :key="char.id" :value="char.id">
            {{ char.name }}
          </option>
        </select>
      </div>
    </section>
    
    <!-- Calculation Type Switcher -->
    <div class="card type-selector">
        <button 
          class="type-btn" 
          :class="{ active: calculationType === 'block' }"
          @click="calculationType = 'block'"
        >
          🛡️ 压制空隙 (Gap/Block)
        </button>
        <button 
          class="type-btn" 
          :class="{ active: calculationType === 'hit' }"
          @click="calculationType = 'hit'"
        >
          👊 连招确认 (Link/Combo)
        </button>
    </div>

    <!-- Mode Selection -->
    <div class="card mode-selector">
      <div class="radio-group">
        <label class="radio-label" :class="{ active: calculationMode === 'link' }">
          <input type="radio" v-model="calculationMode" value="link">
          <span class="mode-title">普通链接 (Link)</span>
        </label>
        <label class="radio-label" :class="{ active: calculationMode === 'cancel' }">
          <input type="radio" v-model="calculationMode" value="cancel">
          <span class="mode-title">必杀/连招取消 (Cancel)</span>
        </label>
      </div>
    </div>
    
    <div v-if="loading" class="loading">加载数据中...</div>
    
    <div v-else class="calculator-grid">
      <!-- Move 1 Input -->
      <div class="card input-card">
        <h2>第 1 招 ({{ calculationType === 'block' ? '被防' : '命中' }})</h2>
        <div class="move-selector">
          <input 
            v-model="search1" 
            type="text" 
            placeholder="搜索招式 (如: 5MP)"
            class="search-input"
            @focus="showDropdown1 = true"
            @blur="handleBlur1"
          />
          <div v-if="showDropdown1" class="dropdown-list">
            <div 
              v-for="move in filteredMoves1" 
              :key="move.name"
              class="dropdown-item"
              @mousedown="selectMove1(move)"
            >
              <span class="move-name">{{ move.name }}</span>
              <span class="move-input">{{ move.input }}</span>
            </div>
          </div>
        </div>
        
        <div v-if="move1" class="move-stats">
          <!-- Block/Hit Stats based on Type -->
          <div v-if="calculationType === 'block'" class="stat-row">
            <span class="label">被防帧数 (On Block):</span>
            <span class="value" :class="parseInt(move1.onBlock) >= 0 ? 'plus' : 'minus'">
              {{ move1.onBlock }}
            </span>
          </div>
          
          <div v-if="calculationType === 'hit'" class="stat-row">
            <span class="label">命中帧数 (On Hit):</span>
            <span class="value" :class="parseInt(move1.onHit) >= 0 ? 'plus' : 'minus'">
              {{ move1.onHit }}
            </span>
          </div>

          <div class="stat-row">
            <span class="label">发生 (Startup):</span>
            <span class="value">{{ move1.startup }}</span>
          </div>
           <div class="stat-row">
            <span class="label">持续 (Active):</span>
            <span class="value">{{ move1.active }}</span>
          </div>
          <div class="stat-row">
            <span class="label">全体硬直 (Recovery):</span>
            <span class="value">{{ move1.recovery }}</span>
          </div>
          
          <!-- Hit Modifiers (Only for Combo Mode + Link) -->
          <div v-if="calculationType === 'hit'" class="hit-modifiers">
             <hr class="separator">
             <label class="control-label">命中状态:</label>
             <div class="modifier-chips">
               <button 
                 class="mod-chip" 
                 :class="{ active: hitState === 'normal' }"
                 @click="hitState = 'normal'"
               >
                 Normal
               </button>
               <button 
                 class="mod-chip counter" 
                 :class="{ active: hitState === 'ch' }"
                 @click="hitState = 'ch'"
               >
                 Counter (+2)
               </button>
               <button 
                 class="mod-chip punish" 
                 :class="{ active: hitState === 'pc' }"
                 @click="hitState = 'pc'"
               >
                 Punish (+4)
               </button>
             </div>
          </div>
          
          <!-- Cancel Frame Input -->
          <div v-if="calculationMode === 'cancel'" class="cancel-frame-control">
            <hr class="separator">
            <label class="control-label">
              取消位置 (Active Frame):
              <span class="highlight">{{ cancelFrame }}</span>
            </label>
            <input 
              type="range" 
              v-model.number="cancelFrame" 
              min="1" 
              :max="parseFrameValue(move1.active) || 10" 
              class="slider"
            >
            <div class="slider-hint">
              在第 {{ cancelFrame }} 帧判定时取消
            </div>
          </div>
        </div>
      </div>
      
      <!-- Arrow -->
      <div class="arrow-connector">
        <span>➡️</span>
        <span class="mode-badge">{{ calculationMode === 'link' ? 'Link' : 'Cancel' }}</span>
        <span v-if="calculationType === 'hit' && hitState !== 'normal'" class="state-badge">
           {{ hitState === 'ch' ? 'CH' : 'PC' }}
        </span>
      </div>
      
      <!-- Move 2 Input -->
      <div class="card input-card">
        <h2>第 2 招 (后续)</h2>
        <div class="move-selector">
          <input 
            v-model="search2" 
            type="text" 
            placeholder="搜索招式 (如: 2MP)"
            class="search-input"
            @focus="showDropdown2 = true"
            @blur="handleBlur2"
          />
          <div v-if="showDropdown2" class="dropdown-list">
            <div 
              v-for="move in filteredMoves2" 
              :key="move.name"
              class="dropdown-item"
              @mousedown="selectMove2(move)"
            >
              <span class="move-name">{{ move.name }}</span>
              <span class="move-input">{{ move.input }}</span>
            </div>
          </div>
        </div>
        
        <div v-if="move2" class="move-stats">
          <div class="stat-row">
            <span class="label">发生帧数 (Startup):</span>
            <span class="value">{{ move2.startup }}</span>
          </div>
          <div class="stat-row">
            <span class="label">持续帧数 (Active):</span>
            <span class="value">{{ move2.active }}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Result Section -->
    <section v-if="calculationResult && calculationResult.valid" class="result-section">
      <div class="result-card" :class="calculationResult.statusClass">
        <div class="result-header">
          <span class="gap-value">{{ calculationResult.gap }}F</span>
          <span class="gap-label">Gap (空隙)</span>
        </div>
        
        <div class="result-details">
          <h3>{{ calculationResult.status }}</h3>
          <p>{{ calculationResult.description }}</p>
          
          <div class="calculation-breakdown">
             <div class="formula-label">计算公式 ({{ calculationMode }})</div>
            <code>{{ calculationResult.formulaDesc }} = {{ calculationResult.gap }}</code>
          </div>
        </div>
      </div>
    </section>
    
    <section v-else-if="move1 && move2" class="error-section">
      <p class="error-text">{{ calculationResult?.error || '无法计算' }}</p>
    </section>
  </div>
</template>

<style scoped>
.gap-calculator-view {
  padding-bottom: var(--space-2xl);
}

.page-header {
  margin-bottom: var(--space-xl);
  text-align: center;
}

.subtitle {
  color: var(--color-text-muted);
  margin-top: var(--space-xs);
}

.selection-section {
  max-width: 400px;
  margin: 0 auto var(--space-xl);
}

.calculator-grid {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.input-card {
  flex: 1;
  min-width: 300px;
  max-width: 400px;
  padding: var(--space-lg);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
}

.input-card h2 {
  font-size: var(--font-size-lg);
  margin-bottom: var(--space-md);
  color: var(--color-text-primary);
  text-align: center;
}

.arrow-connector {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  padding-top: var(--space-xl);
}

.move-selector {
  position: relative;
  margin-bottom: var(--space-md);
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
  max-height: 300px;
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

.move-stats {
  margin-top: var(--space-md);
  background: var(--color-bg-primary);
  padding: var(--space-md);
  border-radius: var(--radius-md);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-xs);
}

.value.plus {
  color: var(--color-success);
}

.value.minus {
  color: var(--color-danger);
}

/* Results */
.result-section {
  margin-top: var(--space-2xl);
  display: flex;
  justify-content: center;
}

.result-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  max-width: 600px;
  width: 100%;
  text-align: center;
  border-left: 8px solid transparent;
}

.status-safe {
  border-left-color: var(--color-success);
  background: rgba(var(--color-success-rgb), 0.05); /* Assuming variables exist or fallback */
}

.status-trap {
  border-left-color: var(--color-accent); /* Blue/Purple usually */
  background: rgba(var(--color-accent-rgb), 0.05);
}

.status-warning {
  border-left-color: var(--color-warning);
  background: rgba(var(--color-warning-rgb), 0.05);
}

.status-danger {
  border-left-color: var(--color-danger);
  background: rgba(var(--color-danger-rgb), 0.05);
}

.result-header {
  margin-bottom: var(--space-lg);
}

.gap-value {
  display: block;
  font-size: 4rem;
  font-weight: 800;
  line-height: 1;
}

.gap-label {
  font-size: 1.2rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.result-details h3 {
  font-size: 1.5rem;
  margin-bottom: var(--space-sm);
}

.result-details p {
  color: var(--color-text-secondary);
  margin-bottom: var(--space-md);
}

.calculation-breakdown code {
  background: rgba(0,0,0,0.2);
  padding: 4px 8px;
  border-radius: 4px;
}

.select-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 1rem;
}

@media (max-width: 768px) {
  .arrow-connector {
    transform: rotate(90deg);
    padding: var(--space-xs);
  }
}

.mode-selector {
  margin: 0 auto var(--space-md);
  max-width: 400px;
  padding: var(--space-xs);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-full);
}

.radio-group {
  display: flex;
  background: var(--color-bg-primary);
  border-radius: var(--radius-full);
  padding: 4px;
}

.radio-label {
  flex: 1;
  text-align: center;
  padding: var(--space-sm);
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: all 0.2s;
  position: relative;
}

.radio-label input {
  display: none;
}

.radio-label.active {
  background: var(--color-accent);
  color: white;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(var(--color-accent-rgb), 0.3);
}

.cancel-frame-control {
  margin-top: var(--space-md);
}

.separator {
  border: 0;
  border-top: 1px dashed var(--color-border);
  margin: var(--space-md) 0;
}

.control-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-xs);
  font-size: 0.9rem;
}

.highlight {
  color: var(--color-accent);
  font-weight: bold;
}

.slider {
  width: 100%;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.slider-hint {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  margin-top: 4px;
  text-align: right;
}

.mode-badge {
  font-size: 0.8rem;
  background: var(--color-bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  display: block;
}

.formula-label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.type-selector {
  display: flex;
  margin: 0 auto var(--space-md);
  max-width: 500px;
  padding: 4px;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-full);
  gap: var(--space-xs);
}

.type-btn {
  flex: 1;
  padding: var(--space-sm);
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: all 0.2s;
}

.type-btn.active {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  font-weight: 600;
}

.hit-modifiers {
  margin-top: var(--space-md);
}

.modifier-chips {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.mod-chip {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  border-radius: var(--radius-full);
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 0.2s;
}

.mod-chip.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.mod-chip.counter.active {
  background: #e6a23c; /* Orange for Counter */
  border-color: #e6a23c;
}

.mod-chip.punish.active {
  background: #f56c6c; /* Red for Punish */
  border-color: #f56c6c;
}

.state-badge {
  font-size: 0.8rem;
  background: #f56c6c;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 4px;
  display: block;
}
</style>
