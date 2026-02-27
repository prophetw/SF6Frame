<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { getMoveDisplayName } from '../i18n';
import { SF6_CHARACTERS, type FrameData, type Move } from '../types';
import { calculateTradeAdvantage, getEffectiveHitstun } from '../utils/trade';

const characterModules = import.meta.glob('../data/characters/*.json');

const characterAId = ref('ryu');
const characterBId = ref('ken');
const frameDataA = ref<FrameData | null>(null);
const frameDataB = ref<FrameData | null>(null);

const selectedMoveAName = ref('');
const selectedMoveBName = ref('');

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
  await loadCharacterData(newId, 'A');
});

watch(characterBId, async (newId) => {
  selectedMoveBName.value = '';
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

const selectedMoveA = computed<Move | null>(() => {
  return movesA.value.find((move) => move.name === selectedMoveAName.value) ?? null;
});

const selectedMoveB = computed<Move | null>(() => {
  return movesB.value.find((move) => move.name === selectedMoveBName.value) ?? null;
});

const tradeAdvantage = computed<number | null>(() => {
  if (!selectedMoveA.value || !selectedMoveB.value) {
    return null;
  }

  return calculateTradeAdvantage(selectedMoveA.value, selectedMoveB.value);
});

const effectiveHitstunA = computed(() => {
  if (!selectedMoveA.value) return null;
  return getEffectiveHitstun(selectedMoveA.value);
});

const effectiveHitstunB = computed(() => {
  if (!selectedMoveB.value) return null;
  return getEffectiveHitstun(selectedMoveB.value);
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
            <select v-model="selectedMoveAName" :disabled="loadingA || movesA.length === 0">
              <option value="">请选择招式</option>
              <option v-for="move in movesA" :key="`${move.name}-${move.input}`" :value="move.name">
                {{ getMoveDisplayName(move) }} ({{ move.input }})
              </option>
            </select>
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
            <select v-model="selectedMoveBName" :disabled="loadingB || movesB.length === 0">
              <option value="">请选择招式</option>
              <option v-for="move in movesB" :key="`${move.name}-${move.input}`" :value="move.name">
                {{ getMoveDisplayName(move) }} ({{ move.input }})
              </option>
            </select>
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

@media (max-width: 768px) {
  .selection-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
