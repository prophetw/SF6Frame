<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { SF6_CHARACTERS, type FrameData, type MoveCategory } from '../types';
import MoveTable from '../components/MoveTable.vue';

const route = useRoute();
const router = useRouter();

const frameData = ref<FrameData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const searchQuery = ref('');
const selectedCategory = ref<MoveCategory | 'all'>('all');

const character = computed(() => {
  const id = route.params.id as string;
  return SF6_CHARACTERS.find(c => c.id === id);
});

const startupFilter = ref<number | ''>('');
const sortKey = ref<string>('startup');
const sortOrder = ref<'asc' | 'desc'>('asc');

// Helper to parse frame values for sorting/filtering
function parseFrameValue(val: string | number | undefined): number {
  if (val === undefined || val === null || val === '-') return -999;
  if (typeof val === 'number') return val;
  // Handle "12+3" or "10~15"
  const match = String(val).match(/-?\d+/);
  return match ? parseInt(match[0]) : -999;
}

const filteredMoves = computed(() => {
  if (!frameData.value) return [];
  
  let moves = [...frameData.value.moves];
  
  // Filter by category
  if (selectedCategory.value !== 'all') {
    moves = moves.filter(m => m.category === selectedCategory.value);
  }
  
  // Filter by search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    moves = moves.filter(m => 
      m.name.toLowerCase().includes(query) ||
      m.input.toLowerCase().includes(query)
    );
  }

  // Filter by startup (max)
  if (startupFilter.value !== '') {
    moves = moves.filter(m => {
      const s = parseFrameValue(m.startup);
      return s > 0 && s <= (startupFilter.value as number);
    });
  }
  
  // Sorting
  if (sortKey.value) {
    moves.sort((a, b) => {
      let valA: number | string = parseFrameValue((a as any)[sortKey.value]);
      let valB: number | string = parseFrameValue((b as any)[sortKey.value]);
      
      // Special handling for string fields like name/input if needed, but primary use is frames
      if (sortKey.value === 'name' || sortKey.value === 'input') {
        valA = (a as any)[sortKey.value] || '';
        valB = (b as any)[sortKey.value] || '';
        return sortOrder.value === 'asc' 
          ? String(valA).localeCompare(String(valB)) 
          : String(valB).localeCompare(String(valA));
      }

      if (valA === -999 && valB !== -999) return 1; // pushing undefined to bottom
      if (valB === -999 && valA !== -999) return -1;

      return sortOrder.value === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
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

async function loadFrameData() {
  const id = route.params.id as string;
  loading.value = true;
  error.value = null;
  
  try {
    // Try to load from local JSON
    const module = await import(`../data/characters/${id}.json`);
    frameData.value = module.default as FrameData;
  } catch (e) {
    // If not found, show placeholder
    error.value = `暂无 ${character.value?.name || id} 的帧数据，请先运行抓取脚本`;
    frameData.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (!character.value) {
    router.push('/');
    return;
  }
  loadFrameData();
});
</script>

<template>
  <div class="character-view container">
    <!-- Back Button & Header -->
    <div class="view-header">
      <RouterLink to="/" class="back-btn">
        ← 返回
      </RouterLink>
      
      <div class="character-info" v-if="character">
        <h1 class="character-name">{{ character.name }}</h1>
        <span class="character-name-jp" v-if="character.nameJp">{{ character.nameJp }}</span>
      </div>
    </div>
    
    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>加载帧数据中...</p>
    </div>
    
    <!-- Error State -->
    <div v-else-if="error" class="error-state">
      <span class="error-icon">📊</span>
      <p>{{ error }}</p>
      <code class="script-hint">pnpm tsx scripts/scraper.ts {{ route.params.id }}</code>
    </div>
    
    <!-- Frame Data Content -->
    <div v-else-if="frameData" class="frame-content">
      <!-- Filters -->
      <div class="filters">
        <div class="filters-row">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索招式..."
            class="search-input"
          />
          <div class="filter-item">
            <span class="filter-label">发生 &le;</span>
            <input 
              type="number" 
              v-model.number="startupFilter" 
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
      
      <!-- Move Table -->
      <MoveTable 
        :moves="filteredMoves" 
        :stats="frameData.stats" 
        :sort-key="sortKey"
        :sort-order="sortOrder"
        @update:sort="handleSort"
      />
      
      <!-- Last Updated -->
      <p class="last-updated" v-if="frameData.lastUpdated">
        最后更新: {{ frameData.lastUpdated }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.view-header {
  margin-bottom: var(--space-xl);
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--space-md);
  transition: color var(--transition-fast);
}

.back-btn:hover {
  color: var(--color-accent);
}

.character-info {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
}

.character-name {
  font-size: var(--font-size-3xl);
  background: var(--gradient-fire);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.character-name-jp {
  color: var(--color-text-muted);
  font-size: var(--font-size-lg);
}

/* Loading & Error States */
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
  to { transform: rotate(360deg); }
}

.error-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: var(--space-md);
}

.script-hint {
  display: block;
  margin-top: var(--space-md);
  background: var(--color-bg-tertiary);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

/* Filters */
.filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
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
  max-width: 300px;
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
  margin-top: var(--space-lg);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: right;
}

/* Mobile */
@media (max-width: 640px) {
  .character-info {
    flex-direction: column;
    gap: var(--space-xs);
  }
  
  .character-name {
    font-size: var(--font-size-2xl);
  }
  
  .filters {
    gap: var(--space-sm);
  }
  
  .search-input {
    max-width: none;
  }
}
</style>
