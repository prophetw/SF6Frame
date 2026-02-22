<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { SF6_CHARACTERS, type Move, type FrameData } from '../types';
import { getMoveDisplayName } from '../i18n';
import { 
  calculateGap, 
  calculateMoveStats, 
  parseFrameValue, 
  findRecommendedMoves,
  isCancelValid,
  type CalculationResult,
  type RecommendedMove 
} from '../utils/gapCalculator';

// State
const selectedCharId = ref<string>('ryu'); // Default to Ryu
const frameData = ref<FrameData | null>(null);
const loading = ref(false);

const move1 = ref<Move | null>(null);
const move2 = ref<Move | null>(null);
const followUpMove = ref<Move | null>(null);

type CustomStepType = 'move' | 'custom';
type StepTransitionMode = 'link' | 'cancel';

interface ComboStep {
  id: number;
  type: CustomStepType;
  transitionMode: StepTransitionMode;
  move: Move | null;
  customName: string;
  customStartup: number;
  customAdvantage: number;
}

// Calculation Mode
const calculationMode = ref<'link' | 'cancel'>('link');
const calculationType = ref<'block' | 'hit'>('block'); // New: Block (Gap) vs Hit (Combo)
const hitState = ref<'normal' | 'ch' | 'pc'>('normal'); // New: Hit State
const isOpponentBurnout = ref(false);
const isDriveRush = ref(false);

const cancelFrame = ref(1); // 1-based index (1 = 1st active frame)

// Search
const search1 = ref('');
const search2 = ref('');
const showDropdown1 = ref(false);
const showDropdown2 = ref(false);
const sequenceSearch = ref('');
const showSequenceDropdown = ref(false);
const stepIdCounter = ref(1);

const comboSteps = ref<ComboStep[]>([]);
const newStepType = ref<CustomStepType>('move');
const newStepTransitionMode = ref<StepTransitionMode>('link');
const newStepMove = ref<Move | null>(null);
const newStepCustomName = ref('自定义动作');
const newStepCustomStartup = ref(10);
const newStepCustomAdvantage = ref(0);

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
    isOpponentBurnout.value = false;
    isDriveRush.value = false;
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

function filterMoves(query: string, sourceMove?: Move | null, mode?: 'link' | 'cancel') {
  if (!allMoves.value) return [];
  
  let candidates = allMoves.value;

  // Filter by Cancel Validity if in Cancel mode
  if (mode === 'cancel' && sourceMove) {
    candidates = candidates.filter(m => isCancelValid(sourceMove, m));
  }

  const qRaw = query.trim();
  const qLower = qRaw.toLowerCase();
  if (!qRaw) return candidates.slice(0, 50);
  
  return candidates.filter(m => 
    m.name.toLowerCase().includes(qLower) || 
    (m.nameZh && m.nameZh.includes(qRaw)) ||
    m.input.toLowerCase().includes(qLower)
  ).slice(0, 50);
}

const filteredMoves1 = computed(() => filterMoves(search1.value));
const filteredMoves2 = computed(() => filterMoves(search2.value, move1.value, calculationMode.value));

function selectMove1(move: Move) {
  const oldMove2 = move2.value; // Store current move2
  move1.value = move;
  search1.value = getMoveDisplayName(move);
  showDropdown1.value = false;
  cancelFrame.value = 1; // Reset cancel frame
  
  // Determine if we should clear move2
  let keepMove2 = false;
  if (oldMove2) {
    if (calculationMode.value === 'link') {
      // Keep for Link mode (user manually selected)
      keepMove2 = true;
    } else if (calculationMode.value === 'cancel') {
      // Keep if valid cancel
      if (isCancelValid(move, oldMove2)) {
        keepMove2 = true;
      }
    }
  }

  if (!keepMove2) {
    move2.value = null; 
    search2.value = '';
    followUpMove.value = null;
  }
}

function selectMove2(move: Move) {
  move2.value = move;
  search2.value = getMoveDisplayName(move);
  showDropdown2.value = false;
  followUpMove.value = null;
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

function isSameMove(a?: Move | null, b?: Move | null): boolean {
  if (!a || !b) return false;
  return a.name === b.name && a.input === b.input;
}

function formatAdvantage(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '-') return '-';
  const match = String(val).match(/^[+-]?\d+/);
  if (!match) return String(val);
  const num = parseInt(match[0], 10);
  return num > 0 ? `+${num}` : `${num}`;
}

function getAdvantageClass(val: string | number | undefined): string {
  const match = String(val ?? '').match(/^[+-]?\d+/);
  if (!match) return 'adv-neutral';
  const num = parseInt(match[0], 10);
  if (num > 0) return 'adv-plus';
  if (num < 0) return 'adv-minus';
  return 'adv-neutral';
}

// Helpers - Imported from utils/gapCalculator

const move1Stats = computed(() => {
  if (!move1.value) return null;
  return calculateMoveStats(move1.value);
});

// Calculation Logic
const calculationResult = computed<CalculationResult | null>(() => {
  if (!move1.value || !move2.value) return null;

  return calculateGap({
    move1: move1.value,
    move2: move2.value,
    type: calculationType.value,
    mode: calculationMode.value,
    hitState: hitState.value,
    cancelFrame: cancelFrame.value,
    isOpponentBurnout: isOpponentBurnout.value,
    isDriveRush: isDriveRush.value
  });
});

// Recommendations
const recommendedMoves = computed<RecommendedMove[]>(() => {
  if (!move1.value || !allMoves.value) return [];
  
  return findRecommendedMoves(
    move1.value,
    allMoves.value,
    calculationType.value,
    calculationMode.value,
    hitState.value,
    cancelFrame.value,
    isOpponentBurnout.value,
    isDriveRush.value
  );
});

const recommendationTitle = computed(() => {
  if (calculationMode.value === 'cancel') return '推荐取消连招 (Cancel)';
  if (calculationType.value === 'hit') return '推荐连招 (Link)';
  return '安全压制 (Pressure/Gap)';
});

// Follow-up Recommendations (based on surplus)
const validFollowUps = computed(() => {
  if (
    calculationType.value !== 'hit' || 
    !calculationResult.value || 
    calculationResult.value.gap < 0 ||
    !allMoves.value
  ) {
    return [];
  }

  const surplus = calculationResult.value.gap;
  
  return allMoves.value
    .filter(m => {
       // Filter out throws and non-hitting moves usually
       if (m.category === 'throw') return false;
       // Fix: Jump category might not be explicit, usage name check
       if (m.name.includes('Jump') || m.input.includes('8') || m.input.startsWith('u+')) return false;

       const startup = parseFrameValue(m.startup);
       if (startup <= 0) return false;
       
       return startup <= surplus;
    })
    .sort((a, b) => {
        // 1. Prioritize Drive Rush (66 cancel)
        const isDRA = a.name.includes('Drive Rush') || a.input.includes('66 (cancel)');
        const isDRB = b.name.includes('Drive Rush') || b.input.includes('66 (cancel)');
        if (isDRA && !isDRB) return -1;
        if (!isDRA && isDRB) return 1;

        // 2. Prioritize Normals and Unique moves (Command Normals)
        const isNormalA = a.category === 'normal' || a.category === 'unique';
        const isNormalB = b.category === 'normal' || b.category === 'unique';
        
        if (isNormalA && !isNormalB) return -1;
        if (!isNormalA && isNormalB) return 1;

        // 3. Then Startup asc
        const startA = parseFrameValue(a.startup);
        const startB = parseFrameValue(b.startup);
        return startA - startB;
    })
    .slice(0, 20); // Increased limit to 20 to show more options
});

function selectFollowUp(move: Move) {
    followUpMove.value = move;
}

function createCustomMove(step: ComboStep): Move {
  return {
    name: step.customName || `自定义${step.id}`,
    input: step.customName || `自定义${step.id}`,
    damage: '0',
    startup: String(step.customStartup),
    active: '1',
    recovery: '0',
    onBlock: String(step.customAdvantage),
    onHit: String(step.customAdvantage),
    category: 'unique'
  };
}

function getStepMove(step: ComboStep): Move | null {
  if (step.type === 'move') return step.move;
  return createCustomMove(step);
}

const filteredSequenceMoves = computed(() => filterMoves(sequenceSearch.value));

function addComboStep() {
  const type = newStepType.value;
  if (type === 'move' && !newStepMove.value) return;

  const step: ComboStep = {
    id: stepIdCounter.value++,
    type,
    transitionMode: newStepTransitionMode.value,
    move: type === 'move' ? newStepMove.value : null,
    customName: newStepCustomName.value.trim() || `自定义${stepIdCounter.value}`,
    customStartup: Math.max(1, Math.floor(newStepCustomStartup.value || 1)),
    customAdvantage: Math.floor(newStepCustomAdvantage.value || 0)
  };

  comboSteps.value.push(step);
  sequenceSearch.value = '';
  newStepMove.value = null;
  showSequenceDropdown.value = false;
}

function removeComboStep(stepId: number) {
  comboSteps.value = comboSteps.value.filter(step => step.id !== stepId);
}

function selectSequenceMove(move: Move) {
  newStepMove.value = move;
  sequenceSearch.value = getMoveDisplayName(move);
  showSequenceDropdown.value = false;
}

function handleSequenceBlur() {
  setTimeout(() => {
    showSequenceDropdown.value = false;
  }, 200);
}

const comboStepCalculations = computed(() => {
  if (comboSteps.value.length < 2) return [];

  const rows: Array<{
    key: string;
    fromLabel: string;
    toLabel: string;
    transitionMode: StepTransitionMode;
    result: CalculationResult | null;
    nextAdvantage: number;
  }> = [];

  for (let i = 1; i < comboSteps.value.length; i++) {
    const prev = comboSteps.value[i - 1];
    const curr = comboSteps.value[i];
    if (!prev || !curr) continue;

    const prevMove = getStepMove(prev);
    const currMove = getStepMove(curr);

    if (!prevMove || !currMove) continue;

    rows.push({
      key: `${prev.id}-${curr.id}`,
      fromLabel: getMoveDisplayName(prevMove),
      toLabel: getMoveDisplayName(currMove),
      transitionMode: curr.transitionMode,
      result: calculateGap({
        move1: prevMove,
        move2: currMove,
        type: 'hit',
        mode: curr.transitionMode,
        hitState: 'normal',
        cancelFrame: 1,
        isOpponentBurnout: false,
        isDriveRush: false
      }),
      nextAdvantage: parseFrameValue(currMove.onHit)
    });
  }

  return rows;
});
</script>

<template>
  <div class="gap-calculator-view container">
    <header class="page-header">
      <h1>连招间隙计算器 (Gap Calculator)</h1>
      <p class="subtitle">计算两个攻击动作之间的帧数空隙，判断是否为伪连或连防。</p>
      <div class="explanation-content explanation-inline">
        <h4>Gap 机制科普：为何有空隙就能插动？</h4>
        <p>SF6 允许你把无敌反击（OD 升龙/无敌超必）在 blockstun 结束前最多提前 <strong>4F</strong> 缓冲，一旦进入第一帧可动就会立刻启动。（起身场景缓冲更大，可达 7F）。</p>
        <p><strong>结论：</strong></p>
        <ul>
          <li>如果对手在两下之间有任何可动帧（哪怕只有 1 帧），他就能把 OD 升龙“卡在第一帧可动”启动。</li>
          <li>依靠“启动第 1 帧就有无敌”的性质，可以穿掉你的下一次攻击。</li>
          <li>简单来说：<strong>只要你的攻击没有覆盖到对手防御硬直的最后一帧，对手就可以在恢复的第一帧使用无敌技反击。</strong></li>
          <li>下方的 Gap 0表示的是，参照街霸6帧数表，没有黑色的块，己方第二招攻击的第一帧落在了对手防御硬直完之后可动的第一帧，对方可以释放无敌技</li>
          <li>下方的 Gap -1 表示的是，己方第二招攻击的第一帧落在了对手防御硬直的最后一帧，对方无法做任何操作</li>
        </ul>
      </div>
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
            <span class="label">招数后硬直(Recovery):</span>
            <span class="value">{{ move1.recovery }}</span>
          </div>
          
           <!-- Derived Stats -->
          <div class="stat-row derived">
            <span class="label">命中硬直 (Hitstun):</span>
            <span class="value">{{ move1Stats?.hitstun }}</span>
          </div>
          <div class="stat-row derived">
            <span class="label">防御硬直 (Blockstun):</span>
            <span class="value">{{ move1Stats?.blockstun }}</span>
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
          
          <!-- Block Modifiers -->
          <div v-if="calculationType === 'block'" class="hit-modifiers">
             <hr class="separator">
             <label class="control-label">防御状态:</label>
             <div class="modifier-chips">
               <button 
                 class="mod-chip burnout" 
                 :class="{ active: isOpponentBurnout }"
                 @click="isOpponentBurnout = !isOpponentBurnout"
               >
                 对方白了（仅防御 +4）
               </button>
               <button 
                 class="mod-chip burnout" 
                 :class="{ active: isDriveRush }"
                 @click="isDriveRush = !isDriveRush"
               >
                 己方绿冲（命中/防御 +4）
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
        
        <!-- Recommendations -->
        <div v-if="move1 && recommendedMoves.length > 0" class="recommendation-box">
           <h3 class="rec-title">{{ recommendationTitle }}</h3>
           <div class="tags-container">
             <button 
               v-for="(rec, index) in recommendedMoves" 
               :key="`${rec.move.name}-${rec.move.input}-${index}`"
               class="rec-tag"
               :class="{ active: isSameMove(move2, rec.move) }"
             @click="selectMove2(rec.move)"
           >
               <span class="rec-name">{{ getMoveDisplayName(rec.move) }}</span>
               <span class="rec-input">{{ rec.move.input }}</span>
               <span class="rec-gap" :class="rec.gap <= 0 ? 'safe' : 'unsafe'">
                 {{ calculationType === 'hit' ? 'Surplus' : 'Gap' }}({{ rec.gap > 0 ? '+' : ''}}{{ rec.gap }})
               </span>
               <span
                 v-if="calculationType === 'block'"
                 class="rec-onblock"
                 :class="getAdvantageClass(rec.move.onBlock)"
               >
                 被防({{ formatAdvantage(rec.move.onBlock) }})
               </span>
             </button>
           </div>
        </div>
      </div>
    </div>
    
    <!-- Result Section -->
    <section v-if="calculationResult && calculationResult.valid" class="result-section">
      <div class="result-card" :class="calculationResult.statusClass">
        <div class="result-header">
          <span class="gap-value">{{ calculationResult.displayValue }}</span>
          <span class="gap-label">{{ calculationResult.displayLabel }}</span>
        </div>
        
        <div class="result-details">
          <h3>{{ calculationResult.status }}</h3>
          <p>{{ calculationResult.description }}</p>
          
          <div class="calculation-breakdown">
             <div class="formula-label">计算公式 ({{ calculationMode }})</div>
            <code>{{ calculationResult.formulaDesc }} = {{ calculationResult.gap }}</code>
             <div v-if="calculationResult.formulaNote" class="formula-note">
               ℹ️ {{ calculationResult.formulaNote }}
             </div>
          </div>
        </div>
      </div>

       <!-- Follow-up Recommendations List -->
       <div v-if="validFollowUps.length > 0" class="result-card follow-up-card">
          <div class="rec-header">
             <h3>可在窗口内命中的招式 (+{{ calculationResult.gap }}F)</h3>
             <span class="subtitle-text">后续可以连的招数列表</span>
          </div>
          
          <div class="tags-container follow-up-tags">
             <button 
               v-for="(move, index) in validFollowUps" 
               :key="`${move.name}-${move.input}-${index}`"
               class="rec-tag"
               :class="{ active: isSameMove(followUpMove, move) }"
               @click="selectFollowUp(move)"
             >
               <span class="rec-name">{{ getMoveDisplayName(move) }}</span>
               <span class="rec-input">{{ move.input }}</span>
               <span class="rec-dmg">{{ parseFrameValue(move.startup) }}f</span>
             </button>
          </div>
       </div>

    </section>
    
    <section v-else-if="move1 && move2" class="error-section">
      <p class="error-text">{{ calculationResult?.error || '无法计算' }}</p>
    </section>

    <section v-if="!loading" class="combo-builder-section card">
      <div class="combo-builder-header">
        <h2>自定义连段帧优势</h2>
        <p>可持续追加动作，逐段计算每一步的窗口与下一步可用帧差。</p>
      </div>

      <div class="combo-builder-form">
        <div class="form-group">
          <label>类型</label>
          <select v-model="newStepType" class="select-input">
            <option value="move">招数</option>
            <option value="custom">自定义</option>
          </select>
        </div>

        <div class="form-group" v-if="comboSteps.length > 0">
          <label>连接方式</label>
          <select v-model="newStepTransitionMode" class="select-input">
            <option value="link">普通 (Link)</option>
            <option value="cancel">连招取消 (Cancel)</option>
          </select>
        </div>

        <div v-if="newStepType === 'move'" class="move-selector">
          <input
            v-model="sequenceSearch"
            type="text"
            placeholder="搜索要添加的招式"
            class="search-input"
            @focus="showSequenceDropdown = true"
            @blur="handleSequenceBlur"
          />
          <div v-if="showSequenceDropdown" class="dropdown-list">
            <div
              v-for="(move, index) in filteredSequenceMoves"
              :key="`combo-builder-${move.name}-${move.input}-${index}`"
              class="dropdown-item"
              @mousedown="selectSequenceMove(move)"
            >
              <span class="move-name">{{ getMoveDisplayName(move) }}</span>
              <span class="move-input">{{ move.input }}</span>
            </div>
          </div>
        </div>

        <div v-else class="custom-step-fields">
          <input v-model="newStepCustomName" type="text" class="search-input" placeholder="自定义动作名称" />
          <input v-model.number="newStepCustomStartup" type="number" min="1" class="search-input" placeholder="发生帧数" />
          <input v-model.number="newStepCustomAdvantage" type="number" class="search-input" placeholder="命中帧差" />
        </div>

        <button class="type-btn add-step-btn" @click="addComboStep">添加</button>
      </div>

      <div v-if="comboSteps.length > 0" class="combo-steps-list">
        <div v-for="(step, index) in comboSteps" :key="step.id" class="combo-step-row">
          <div class="combo-step-title">
            <span class="step-index">{{ index + 1 }}.</span>
            <span>
              {{ step.type === 'move' ? (step.move ? getMoveDisplayName(step.move) : '-') : step.customName }}
            </span>
            <span class="move-input" v-if="step.type === 'move' && step.move">{{ step.move.input }}</span>
            <span class="move-input" v-else>Startup {{ step.customStartup }}F / OnHit {{ step.customAdvantage >= 0 ? '+' : '' }}{{ step.customAdvantage }}</span>
          </div>
          <button class="remove-step-btn" @click="removeComboStep(step.id)">移除</button>
        </div>
      </div>

      <div v-if="comboStepCalculations.length > 0" class="combo-calc-list">
        <div v-for="row in comboStepCalculations" :key="row.key" class="combo-calc-row">
          <div class="combo-calc-main">
            <span>{{ row.fromLabel }} → {{ row.toLabel }}</span>
            <span class="mode-badge">{{ row.transitionMode === 'link' ? 'Link' : 'Cancel' }}</span>
          </div>
          <div class="combo-calc-result" :class="row.result?.gap !== undefined && row.result.gap >= 0 ? 'plus' : 'minus'">
            {{ row.result?.displayLabel || '结果' }}：{{ row.result?.displayValue || '-' }}
          </div>
          <div class="combo-calc-next">
            当前招命中后帧差：{{ row.nextAdvantage >= 0 ? '+' : '' }}{{ row.nextAdvantage }}
          </div>
        </div>
      </div>
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


.combo-builder-section {
  margin-top: var(--space-xl);
}

.combo-builder-header {
  margin-bottom: var(--space-md);
}

.combo-builder-form {
  display: grid;
  gap: var(--space-sm);
}

.custom-step-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-xs);
}

.add-step-btn {
  background: var(--color-accent);
  color: #fff;
}

.combo-steps-list,
.combo-calc-list {
  margin-top: var(--space-md);
  display: grid;
  gap: var(--space-xs);
}

.combo-step-row,
.combo-calc-row {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  background: var(--color-bg-primary);
}

.combo-step-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
}

.combo-step-title {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
  flex-wrap: wrap;
}

.step-index {
  color: var(--color-text-muted);
}

.remove-step-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-sm);
  cursor: pointer;
}

.combo-calc-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.combo-calc-next {
  font-size: 0.85rem;
  color: var(--color-text-muted);
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

.formula-note {
  margin-top: 8px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  font-style: italic;
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

/* Follow Up Card */
.follow-up-card {
  margin-top: var(--space-md);
  margin-left: var(--space-md);
  text-align: left;
  max-width: 400px;
}

@media (max-width: 1024px) {
  .result-section {
    flex-direction: column;
    align-items: center;
  }
  .follow-up-card {
    margin-left: 0;
    margin-top: var(--space-lg);
    max-width: 600px;
  }
}

.rec-header h3 {
  font-size: 1.1rem;
  margin-bottom: 4px;
}

.subtitle-text {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  display: block;
  margin-bottom: var(--space-md);
}

.follow-up-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rec-dmg {
  font-size: 0.75rem;
  color: var(--color-danger);
  margin-left: auto;
  padding-left: 8px;
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

.mod-chip.burnout.active {
  background: #909399; /* Grey for Burnout */
  border-color: #909399;
  color: white;
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

.recommendation-box {
  margin-top: var(--space-md);
  border: 1px solid var(--color-danger);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  background: rgba(245, 108, 108, 0.05);
}

.rec-title {
  font-size: 0.9rem;
  color: var(--color-danger);
  margin-bottom: var(--space-sm);
  font-weight: 600;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.rec-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-primary);
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--color-text-primary);
  transition: all 0.2s;
}

.rec-tag:hover {
  border-color: var(--color-accent);
  background: var(--color-bg-secondary);
}

.rec-tag.active {
  border-color: var(--color-accent);
  background: rgba(var(--color-accent-rgb), 0.1); /* Assuming variable exists or fallback */
  background: var(--color-accent); /* Fallback */
  color: white;
}

.rec-tag.active .rec-gap {
  background: white;
  color: var(--color-accent);
}

.rec-input {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  background: rgba(0,0,0,0.1);
  padding: 0 4px;
  border-radius: 3px;
}

.rec-tag.active .rec-input {
  color: rgba(255,255,255,0.9);
  background: rgba(255,255,255,0.2);
}

.rec-gap {
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  background: var(--color-text-muted);
  color: white;
}

.rec-gap.safe {
  background: var(--color-success);
}

.rec-gap.unsafe {
  background: var(--color-danger);
}

.rec-onblock {
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.75rem;
  background: var(--color-text-muted);
  color: white;
}

.rec-onblock.adv-plus {
  background: var(--color-success);
}

.rec-onblock.adv-minus {
  background: var(--color-danger);
}

.rec-onblock.adv-neutral {
  background: var(--color-text-muted);
}
.explanation-card {
  margin-bottom: var(--space-md);
  text-align: left;
}

.explanation-card summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--color-accent);
  padding: var(--space-sm);
  user-select: none;
}

.explanation-content {
  padding: var(--space-md);
  color: var(--color-text-secondary);
  font-size: 0.9em;
  background: rgba(0,0,0,0.2);
  border-radius: var(--radius-md);
  margin-top: var(--space-sm);
}

.explanation-inline {
  max-width: 900px;
  margin: var(--space-md) auto 0;
  text-align: left;
}

.explanation-content h4 {
  color: var(--color-text-primary);
  margin-bottom: var(--space-sm);
}

.explanation-content ul {
  padding-left: var(--space-lg);
  margin-top: var(--space-sm);
}

.explanation-content li {
  margin-bottom: 4px;
}
</style>
