<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { getMoveDisplayName } from '../i18n';
import { SF6_CHARACTERS, type FrameData, type Move } from '../types';
import { calculateTradeAdvantage, getEffectiveHitstun, parseHitstun, type FATMoveMinimal } from '../utils/trade';

const characterModules = import.meta.glob('../data/characters/*.json');

const characterAId = ref('ryu');
const characterBId = ref('ken');
const frameDataA = ref<FrameData | null>(null);
const frameDataB = ref<FrameData | null>(null);

const selectedMoveAName = ref('');
const selectedMoveBName = ref('');
const moveASearchQuery = ref('');
const moveBSearchQuery = ref('');
const showMoveADropdown = ref(false);
const showMoveBDropdown = ref(false);

const loadingA = ref(false);
const loadingB = ref(false);

async function loadCharacterData(charId: string, target: 'A' | 'B') {
  const loadingRef = target === 'A' ? loadingA : loadingB;
  const dataRef = target === 'A' ? frameDataA : frameDataB;

  if (!charId) {
    dataRef.value = null;
    return;
  }

  loadingRef.value = true;
  try {
    const path = `../data/characters/${charId}.json`;
    const loader = characterModules[path];

    if (!loader) {
      dataRef.value = null;
      return;
    }

    const module = (await loader()) as { default: FrameData };
    dataRef.value = module.default;
  } catch (error) {
    console.error(`Failed to load character data for ${charId}`, error);
    dataRef.value = null;
  } finally {
    loadingRef.value = false;
  }
}

watch(characterAId, async (newId) => {
  selectedMoveAName.value = '';
  moveASearchQuery.value = '';
  showMoveADropdown.value = false;
  await loadCharacterData(newId, 'A');
});

watch(characterBId, async (newId) => {
  selectedMoveBName.value = '';
  moveBSearchQuery.value = '';
  showMoveBDropdown.value = false;
  await loadCharacterData(newId, 'B');
});

onMounted(async () => {
  await Promise.all([
    loadCharacterData(characterAId.value, 'A'),
    loadCharacterData(characterBId.value, 'B'),
  ]);
});

const movesA = computed(() => frameDataA.value?.moves ?? []);
const movesB = computed(() => frameDataB.value?.moves ?? []);

const filteredMovesA = computed(() => {
  const queryRaw = moveASearchQuery.value.trim();
  const queryLower = queryRaw.toLowerCase();
  if (!queryRaw) return movesA.value.slice(0, 30);

  return movesA.value.filter((move) => {
    return getMoveDisplayName(move).toLowerCase().includes(queryLower)
      || move.name.toLowerCase().includes(queryLower)
      || (move.nameZh?.includes(queryRaw) ?? false)
      || move.input.toLowerCase().includes(queryLower);
  }).slice(0, 30);
});

const filteredMovesB = computed(() => {
  const queryRaw = moveBSearchQuery.value.trim();
  const queryLower = queryRaw.toLowerCase();
  if (!queryRaw) return movesB.value.slice(0, 30);

  return movesB.value.filter((move) => {
    return getMoveDisplayName(move).toLowerCase().includes(queryLower)
      || move.name.toLowerCase().includes(queryLower)
      || (move.nameZh?.includes(queryRaw) ?? false)
      || move.input.toLowerCase().includes(queryLower);
  }).slice(0, 30);
});

const selectedMoveA = computed<Move | null>(() => {
  return movesA.value.find((move) => move.name === selectedMoveAName.value) ?? null;
});

const selectedMoveB = computed<Move | null>(() => {
  return movesB.value.find((move) => move.name === selectedMoveBName.value) ?? null;
});

function selectMoveA(move: Move) {
  selectedMoveAName.value = move.name;
  moveASearchQuery.value = getMoveDisplayName(move);
  showMoveADropdown.value = false;
}

function selectMoveB(move: Move) {
  selectedMoveBName.value = move.name;
  moveBSearchQuery.value = getMoveDisplayName(move);
  showMoveBDropdown.value = false;
}

watch(selectedMoveA, (newVal) => {
  if (newVal) {
    moveASearchQuery.value = getMoveDisplayName(newVal);
  }
});

watch(selectedMoveB, (newVal) => {
  if (newVal) {
    moveBSearchQuery.value = getMoveDisplayName(newVal);
  }
});

function handleMoveABlur() {
  setTimeout(() => {
    showMoveADropdown.value = false;
  }, 200);
}

function handleMoveBBlur() {
  setTimeout(() => {
    showMoveBDropdown.value = false;
  }, 200);
}

function getTradeSource(move: Move | null): FATMoveMinimal | null {
  if (!move) return null;
  return (move.raw ?? move) as FATMoveMinimal;
}

const tradeSourceA = computed<FATMoveMinimal | null>(() => getTradeSource(selectedMoveA.value));
const tradeSourceB = computed<FATMoveMinimal | null>(() => getTradeSource(selectedMoveB.value));

const tradeAdvantage = computed<number | null>(() => {
  if (!tradeSourceA.value || !tradeSourceB.value) {
    return null;
  }

  return calculateTradeAdvantage(tradeSourceA.value, tradeSourceB.value);
});

const effectiveHitstunA = computed(() => {
  if (!tradeSourceA.value) return null;
  return getEffectiveHitstun(tradeSourceA.value);
});

const effectiveHitstunB = computed(() => {
  if (!tradeSourceB.value) return null;
  return getEffectiveHitstun(tradeSourceB.value);
});

const tradeCalculation = computed<{
  stepA: string;
  stepB: string;
  finalStep: string;
} | null>(() => {
  if (!selectedMoveA.value || !selectedMoveB.value || !tradeSourceA.value || !tradeSourceB.value || tradeAdvantage.value === null) {
    return null;
  }

  const effA = getEffectiveHitstun(tradeSourceA.value);
  const effB = getEffectiveHitstun(tradeSourceB.value);

  const baseA = effA.type === 'blockstun'
    ? parseHitstun(tradeSourceA.value.blockstun)
    : parseHitstun(tradeSourceA.value.hitstun);
  const baseB = effB.type === 'blockstun'
    ? parseHitstun(tradeSourceB.value.blockstun)
    : parseHitstun(tradeSourceB.value.hitstun);

  const sourceA = effA.type === 'blockstun' ? 'Blockstun' : 'Hitstun';
  const sourceB = effB.type === 'blockstun' ? 'Blockstun' : 'Hitstun';

  return {
    stepA: `角色A ${getMoveDisplayName(selectedMoveA.value)}: ${sourceA} ${baseA} + 2(CH) = ${effA.value}F`,
    stepB: `角色B ${getMoveDisplayName(selectedMoveB.value)}: ${sourceB} ${baseB} + 2(CH) = ${effB.value}F`,
    finalStep: `相杀有利 = ${effA.value} - ${effB.value} = ${tradeAdvantage.value > 0 ? '+' : ''}${tradeAdvantage.value}F`,
  };
});

const advantageText = computed(() => {
  if (tradeAdvantage.value === null) return '请选择双方招式';
  if (tradeAdvantage.value === 0) return '双方相杀后五五开 (0F)';
  if (tradeAdvantage.value > 0) return `角色A 相杀后有利 +${tradeAdvantage.value}F`;
  return `角色B 相杀后有利 ${tradeAdvantage.value}F`;
});

const advantageClass = computed(() => {
  if (tradeAdvantage.value === null || tradeAdvantage.value === 0) return 'frame-neutral';
  return tradeAdvantage.value > 0 ? 'frame-positive' : 'frame-negative';
});
</script>

<template>
  <div class="trade-calculator container">
    <section class="hero">
      <h1>相杀计算器</h1>
      <p>选择双方角色和招式后，实时计算相杀后的帧数优势。</p>
    </section>

    <section class="card selection-card">
      <div class="selection-grid">
        <div class="selection-column">
          <h2>角色 A</h2>
          <label>
            <span>选择角色 A</span>
            <select v-model="characterAId">
              <option v-for="character in SF6_CHARACTERS" :key="character.id" :value="character.id">
                {{ character.name }}
              </option>
            </select>
          </label>

          <label>
            <span>选择角色 A 招式</span>
            <div class="move-search">
              <input
                v-model="moveASearchQuery"
                type="text"
                class="move-search-input"
                placeholder="选择或搜索角色 A 招式..."
                :disabled="loadingA || movesA.length === 0"
                @focus="showMoveADropdown = true"
                @blur="handleMoveABlur"
                @input="selectedMoveAName = ''"
              />
              <div v-if="showMoveADropdown" class="move-dropdown">
                <button
                  v-for="move in filteredMovesA"
                  :key="`${move.name}-${move.input}`"
                  class="move-option"
                  @click="selectMoveA(move)"
                >
                  <span class="move-name">{{ getMoveDisplayName(move) }}</span>
                  <span class="move-input">{{ move.input }}</span>
                  <span class="move-startup">{{ move.startup }}F</span>
                </button>
                <div v-if="filteredMovesA.length === 0" class="move-empty">无匹配招式</div>
              </div>
            </div>
          </label>
        </div>

        <div class="selection-column">
          <h2>角色 B</h2>
          <label>
            <span>选择角色 B</span>
            <select v-model="characterBId">
              <option v-for="character in SF6_CHARACTERS" :key="character.id" :value="character.id">
                {{ character.name }}
              </option>
            </select>
          </label>

          <label>
            <span>选择角色 B 招式</span>
            <div class="move-search">
              <input
                v-model="moveBSearchQuery"
                type="text"
                class="move-search-input"
                placeholder="选择或搜索角色 B 招式..."
                :disabled="loadingB || movesB.length === 0"
                @focus="showMoveBDropdown = true"
                @blur="handleMoveBBlur"
                @input="selectedMoveBName = ''"
              />
              <div v-if="showMoveBDropdown" class="move-dropdown">
                <button
                  v-for="move in filteredMovesB"
                  :key="`${move.name}-${move.input}`"
                  class="move-option"
                  @click="selectMoveB(move)"
                >
                  <span class="move-name">{{ getMoveDisplayName(move) }}</span>
                  <span class="move-input">{{ move.input }}</span>
                  <span class="move-startup">{{ move.startup }}F</span>
                </button>
                <div v-if="filteredMovesB.length === 0" class="move-empty">无匹配招式</div>
              </div>
            </div>
          </label>
        </div>
      </div>
    </section>

    <section class="card result-card">
      <h2>相杀结果</h2>
      <p class="advantage-text" :class="advantageClass">{{ advantageText }}</p>

      <div class="detail-grid" v-if="selectedMoveA && selectedMoveB">
        <div>
          <h3>角色 A（{{ getMoveDisplayName(selectedMoveA) }}）</h3>
          <p>有效硬直: {{ effectiveHitstunA?.value }}F</p>
          <p v-if="effectiveHitstunA?.type === 'blockstun'">使用 blockstun 回退计算</p>
        </div>
        <div>
          <h3>角色 B（{{ getMoveDisplayName(selectedMoveB) }}）</h3>
          <p>有效硬直: {{ effectiveHitstunB?.value }}F</p>
          <p v-if="effectiveHitstunB?.type === 'blockstun'">使用 blockstun 回退计算</p>
        </div>
      </div>

      <div class="calc-steps" v-if="tradeCalculation">
        <h3>相杀计算步骤</h3>
        <ol>
          <li>{{ tradeCalculation.stepA }}</li>
          <li>{{ tradeCalculation.stepB }}</li>
          <li class="calc-final" :class="advantageClass">{{ tradeCalculation.finalStep }}</li>
        </ol>
      </div>
    </section>
  </div>
</template>

<style scoped>
.trade-calculator {
  display: grid;
  gap: var(--space-lg);
}

.hero p {
  color: var(--color-text-muted);
  margin-top: var(--space-xs);
}

.selection-grid {
  display: grid;
  gap: var(--space-lg);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.selection-column {
  display: grid;
  gap: var(--space-md);
}

label {
  display: grid;
  gap: var(--space-xs);
}

label span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.move-search {
  position: relative;
  min-width: 0;
}

.move-search-input {
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
}

.move-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  z-index: 20;
}

.move-option {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-xs);
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

.move-input {
  font-family: var(--font-mono);
  white-space: nowrap;
}

.move-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-startup {
  white-space: nowrap;
  color: var(--color-text-muted);
}

.move-empty {
  padding: var(--space-sm);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.advantage-text {
  font-size: var(--font-size-lg);
  font-weight: 700;
  margin: var(--space-sm) 0 var(--space-md);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-lg);
}

.detail-grid h3 {
  font-size: var(--font-size-md);
  margin-bottom: var(--space-xs);
}

.detail-grid p {
  color: var(--color-text-secondary);
}

.calc-steps {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-border);
}

.calc-steps h3 {
  margin-bottom: var(--space-xs);
}

.calc-steps ol {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: var(--space-xs);
}

.calc-steps li {
  color: var(--color-text-secondary);
}

.calc-steps .calc-final {
  font-weight: 700;
}

@media (max-width: 768px) {
  .selection-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
