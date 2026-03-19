<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ComboList from '../components/ComboList.vue';
import KeyMovePanel from '../components/KeyMovePanel.vue';
import MoveTable from '../components/MoveTable.vue';
import { getMoveDisplayName } from '../i18n';
import { buildKeyMoveData } from '../utils/keyMoves';
import { calculateMoveTotalFrames } from '../utils/frameTotals';
import { calculateMoveStats } from '../utils/gapCalculator';
import {
  SF6_CHARACTERS,
  type ComboData,
  type FrameData,
  type KeyMoveData,
  type MoveCategory,
} from '../types';

const route = useRoute();
const router = useRouter();

type JsonModuleMap = Record<string, () => Promise<unknown>>;

const frameModules = import.meta.glob('../data/characters/*.json');
const comboModules = import.meta.glob('../data/combos/*.json');
const keyMoveModules = import.meta.glob('../data/key-moves/*.json');

const frameData = ref<FrameData | null>(null);
const comboData = ref<ComboData | null>(null);
const manualKeyMoveData = ref<KeyMoveData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const searchQuery = ref('');
const selectedCategory = ref<MoveCategory | 'all'>('all');
const startupFilter = ref<number | ''>('');
const sortKey = ref<string>('startup');
const sortOrder = ref<'asc' | 'desc'>('asc');

const character = computed(() => {
  const id = route.params.id as string;
  return SF6_CHARACTERS.find(candidate => candidate.id === id);
});

const resolvedKeyMoveData = computed(() => {
  if (!frameData.value) return null;
  return buildKeyMoveData(frameData.value, manualKeyMoveData.value);
});

const overviewStats = computed(() => {
  if (!frameData.value) return [];

  return [
    {
      label: '已收录招式',
      value: String(frameData.value.moves.length),
    },
    {
      label: '核心招式',
      value: String(resolvedKeyMoveData.value?.keyMoves.length ?? 0),
    },
    {
      label: '常用连段',
      value: String(comboData.value?.combos.length ?? 0),
    },
  ];
});

function parseFrameValue(val: string | number | undefined): number {
  if (val === undefined || val === null || val === '-') return -999;
  if (typeof val === 'number') return val;
  const match = String(val).match(/-?\d+/);
  return match ? parseInt(match[0], 10) : -999;
}

const filteredMoves = computed(() => {
  if (!frameData.value) return [];

  let moves = [...frameData.value.moves];

  if (selectedCategory.value !== 'all') {
    moves = moves.filter(move => move.category === selectedCategory.value);
  }

  if (searchQuery.value) {
    const queryRaw = searchQuery.value.trim();
    const queryLower = queryRaw.toLowerCase();
    moves = moves.filter(move =>
      move.name.toLowerCase().includes(queryLower)
      || (move.nameZh && move.nameZh.includes(queryRaw))
      || move.input.toLowerCase().includes(queryLower),
    );
  }

  if (startupFilter.value !== '') {
    moves = moves.filter(move => {
      const startup = parseFrameValue(move.startup);
      return startup > 0 && startup <= (startupFilter.value as number);
    });
  }

  if (sortKey.value) {
    moves.sort((a, b) => {
      let valueA: number | string = -999;
      let valueB: number | string = -999;

      if (sortKey.value === 'hitstun') {
        valueA = calculateMoveStats(a).hitstun;
        valueB = calculateMoveStats(b).hitstun;
      } else if (sortKey.value === 'blockstun') {
        valueA = calculateMoveStats(a).blockstun;
        valueB = calculateMoveStats(b).blockstun;
      } else if (sortKey.value === 'total') {
        valueA = calculateMoveTotalFrames(a) ?? -999;
        valueB = calculateMoveTotalFrames(b) ?? -999;
      } else {
        valueA = parseFrameValue((a as Record<string, unknown>)[sortKey.value] as string | number | undefined);
        valueB = parseFrameValue((b as Record<string, unknown>)[sortKey.value] as string | number | undefined);
      }

      if (sortKey.value === 'name' || sortKey.value === 'input') {
        valueA = sortKey.value === 'name' ? getMoveDisplayName(a) : a.input;
        valueB = sortKey.value === 'name' ? getMoveDisplayName(b) : b.input;

        return sortOrder.value === 'asc'
          ? String(valueA).localeCompare(String(valueB))
          : String(valueB).localeCompare(String(valueA));
      }

      if (valueA === -999 && valueB !== -999) return 1;
      if (valueB === -999 && valueA !== -999) return -1;

      return sortOrder.value === 'asc'
        ? (valueA as number) - (valueB as number)
        : (valueB as number) - (valueA as number);
    });
  }

  return moves;
});

function handleSort(key: string) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
    sortOrder.value = 'asc';
  }
}

const categories: { value: MoveCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'normal', label: '通常技' },
  { value: 'unique', label: '特殊技' },
  { value: 'special', label: '必杀技' },
  { value: 'super', label: '超必杀' },
  { value: 'throw', label: '投技' },
];

async function loadJson<T>(modules: JsonModuleMap, path: string): Promise<T | null> {
  const loader = modules[path];
  if (!loader) return null;

  const module = await loader() as { default: T };
  return module.default;
}

async function loadCharacterData() {
  const id = route.params.id as string;
  loading.value = true;
  error.value = null;

  try {
    const nextFrameData = await loadJson<FrameData>(frameModules, `../data/characters/${id}.json`);
    if (!nextFrameData) {
      throw new Error(`暂无 ${character.value?.name || id} 的帧数据，请先运行抓取脚本`);
    }

    frameData.value = nextFrameData;
    comboData.value = await loadJson<ComboData>(comboModules, `../data/combos/${id}.json`);
    manualKeyMoveData.value = await loadJson<KeyMoveData>(keyMoveModules, `../data/key-moves/${id}.json`);
  } catch (err) {
    error.value = err instanceof Error
      ? err.message
      : `暂无 ${character.value?.name || id} 的帧数据，请先运行抓取脚本`;
    frameData.value = null;
    comboData.value = null;
    manualKeyMoveData.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.params.id,
  async () => {
    if (!character.value) {
      router.push('/');
      return;
    }

    await loadCharacterData();
  },
  { immediate: true },
);
</script>

<template>
  <div class="character-view container">
    <div class="view-header">
      <RouterLink to="/" class="back-btn">
        ← 返回
      </RouterLink>

      <div v-if="character" class="character-info">
        <div>
          <h1 class="character-name">{{ character.name }}</h1>
          <span v-if="character.nameJp" class="character-name-jp">{{ character.nameJp }}</span>
        </div>

        <a
          v-if="character.wikiUrl"
          :href="character.wikiUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="wiki-link"
          title="SuperCombo Wiki"
        >
          <span class="icon">📖</span> Wiki
        </a>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>加载角色数据中...</p>
    </div>

    <div v-else-if="error" class="error-state">
      <span class="error-icon">📊</span>
      <p>{{ error }}</p>
      <code class="script-hint">pnpm tsx scripts/scraper.ts {{ route.params.id }}</code>
    </div>

    <div v-else-if="frameData" class="frame-content">
      <section class="overview-band">
        <div class="overview-copy">
          <p class="section-kicker">Character Snapshot</p>
          <h2 class="overview-title">实战速览</h2>
          <p class="overview-desc">
            先看核心招式和常用连段，再往下查完整帧表和具体数值。
          </p>
        </div>

        <div class="overview-grid">
          <article
            v-for="stat in overviewStats"
            :key="stat.label"
            class="overview-card"
          >
            <span class="overview-label">{{ stat.label }}</span>
            <strong class="overview-value">{{ stat.value }}</strong>
          </article>
        </div>
      </section>

      <KeyMovePanel
        v-if="resolvedKeyMoveData"
        :frame-data="frameData"
        :data="resolvedKeyMoveData"
      />

      <section class="section-panel frame-section">
        <div class="section-head">
          <div>
            <p class="section-kicker">Frame Data</p>
            <h2 class="section-title">完整帧表</h2>
          </div>
          <p class="section-desc">
            支持按发生、类别、优势和关键字快速筛选。
          </p>
        </div>

        <div class="filters">
          <div class="filters-row">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索招式..."
              class="search-input"
            />

            <div class="filter-item">
              <span class="filter-label">发生 ≤</span>
              <input
                v-model.number="startupFilter"
                type="number"
                class="small-input"
                placeholder="F"
                min="1"
              />
            </div>
          </div>

          <div class="category-filters">
            <button
              v-for="cat in categories"
              :key="cat.value"
              :class="['filter-btn', { active: selectedCategory === cat.value }]"
              @click="selectedCategory = cat.value"
            >
              {{ cat.label }}
            </button>
          </div>
        </div>

        <MoveTable
          :moves="filteredMoves"
          :stats="frameData.stats"
          :sort-key="sortKey"
          :sort-order="sortOrder"
          @update:sort="handleSort"
        />

        <p v-if="frameData.lastUpdated" class="last-updated">
          帧数数据更新于 {{ frameData.lastUpdated }}
        </p>
      </section>

      <ComboList
        :character-id="character?.id ?? String(route.params.id)"
        :data="comboData"
      />
    </div>
  </div>
</template>

<style scoped>
.character-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.view-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  width: fit-content;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  transition: color var(--transition-fast);
}

.back-btn:hover {
  color: var(--color-accent);
}

.character-info {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-xl);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at top right, rgba(255, 107, 53, 0.18), transparent 30%),
    linear-gradient(135deg, rgba(255, 107, 53, 0.06), transparent 55%),
    var(--color-bg-card);
}

.character-name {
  font-size: var(--font-size-3xl);
  background: var(--gradient-fire);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.character-name-jp {
  display: inline-block;
  margin-top: 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-lg);
}

.wiki-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full, 999px);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-decoration: none;
  transition: all var(--transition-fast);
}

.wiki-link:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-accent);
  color: var(--color-accent);
  transform: translateY(-1px);
}

.loading-state,
.error-state {
  text-align: center;
  padding: var(--space-2xl);
  color: var(--color-text-muted);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  margin: 0 auto var(--space-md);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: var(--space-md);
}

.script-hint {
  display: inline-block;
  margin-top: var(--space-md);
  background: var(--color-bg-tertiary);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

.frame-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.overview-band,
.section-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  padding: var(--space-xl);
}

.overview-band {
  display: grid;
  grid-template-columns: minmax(240px, 1.2fr) minmax(0, 1.8fr);
  gap: var(--space-lg);
  align-items: stretch;
}

.section-kicker {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.overview-title,
.section-title {
  margin-top: 2px;
}

.overview-desc,
.section-desc {
  margin-top: var(--space-sm);
  color: var(--color-text-secondary);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}

.overview-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  min-height: 120px;
  padding: var(--space-lg);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, rgba(0, 212, 255, 0.08), transparent 100%),
    var(--color-bg-secondary);
  border: 1px solid rgba(0, 212, 255, 0.08);
}

.overview-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.overview-value {
  font-size: 2.2rem;
  color: var(--color-text-primary);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
}

.frame-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.filters-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  align-items: center;
}

.search-input {
  flex: 1;
  min-width: 200px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  background: var(--color-bg-tertiary);
  padding: 4px 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

.filter-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.small-input {
  width: 60px;
  padding: 2px 4px;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border-light);
  text-align: center;
}

.small-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.category-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.filter-btn {
  padding: var(--space-xs) var(--space-md);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
}

.filter-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.filter-btn.active {
  background: var(--color-accent-light);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.last-updated {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: right;
}

@media (max-width: 900px) {
  .overview-band {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .character-info,
  .section-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .character-name {
    font-size: var(--font-size-2xl);
  }

  .overview-band,
  .section-panel {
    padding: var(--space-lg);
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
