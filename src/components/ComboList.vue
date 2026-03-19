<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Combo, ComboData } from '../types';

const props = defineProps<{
  characterId: string;
  data: ComboData | null;
}>();

const searchQuery = ref('');
const selectedSection = ref('all');
const selectedDifficulty = ref('all');
const selectedPosition = ref('all');
const selectedTrigger = ref('all');
const isExpanded = ref(false);

const triggerOptions = [
  { value: 'all', label: '全部' },
  { value: 'di', label: 'DI' },
  { value: 'pc', label: 'PC' },
  { value: 'dr', label: 'DR' },
  { value: 'jump', label: 'Jump-in' },
];

const allCombos = computed(() => props.data?.combos ?? []);

const sectionOptions = computed(() => {
  return [...new Set(allCombos.value.map(combo => combo.section).filter(Boolean))];
});

const difficultyOptions = computed(() => {
  return [...new Set(allCombos.value.map(combo => combo.difficulty).filter(Boolean) as string[])];
});

const positionOptions = computed(() => {
  return [...new Set(allCombos.value.map(combo => combo.position).filter(Boolean) as string[])];
});

function getSearchableText(combo: Combo): string {
  return [
    combo.combo,
    combo.section,
    combo.starter,
    combo.notes,
    combo.position,
    combo.difficulty,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesTrigger(combo: Combo, trigger: string): boolean {
  if (trigger === 'all') return true;

  const text = getSearchableText(combo);

  if (trigger === 'di') return /\bdi\b|drive impact/.test(text);
  if (trigger === 'pc') return /\bpc\b|punish counter/.test(text);
  if (trigger === 'dr') return /\bdr\b|\bdrc\b|drive rush/.test(text);
  if (trigger === 'jump') return /\bj\./.test(text) || /jump/.test(text);

  return true;
}

const filteredCombos = computed(() => {
  return allCombos.value.filter(combo => {
    const query = searchQuery.value.trim().toLowerCase();
    if (query && !getSearchableText(combo).includes(query)) return false;
    if (selectedSection.value !== 'all' && combo.section !== selectedSection.value) return false;
    if (selectedDifficulty.value !== 'all' && combo.difficulty !== selectedDifficulty.value) return false;
    if (selectedPosition.value !== 'all' && combo.position !== selectedPosition.value) return false;
    if (!matchesTrigger(combo, selectedTrigger.value)) return false;
    return true;
  });
});

const groupedCombos = computed(() => {
  const grouped = new Map<string, Combo[]>();

  for (const combo of filteredCombos.value) {
    const section = combo.section || 'Combos';
    const list = grouped.get(section) ?? [];
    list.push(combo);
    grouped.set(section, list);
  }

  return Array.from(grouped.entries()).map(([section, combos]) => ({
    section,
    combos,
  }));
});

function getMetaChips(combo: Combo): string[] {
  const chips: string[] = [];
  if (combo.damage) chips.push(`伤害 ${combo.damage}`);
  if (combo.position) chips.push(combo.position);
  if (combo.difficulty) chips.push(combo.difficulty);
  if (combo.superMeter) chips.push(`SA ${combo.superMeter}`);
  if (combo.driveMeter) chips.push(`Drive ${combo.driveMeter}`);
  return chips;
}
</script>

<template>
  <section class="section-panel combo-panel">
    <div class="section-head" @click="isExpanded = !isExpanded" style="cursor: pointer; user-select: none;">
      <div>
        <p class="section-kicker">Combos</p>
        <h2 class="section-title">常用连段</h2>
      </div>
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div class="summary-chip">
          {{ filteredCombos.length }} / {{ allCombos.length }} 条
        </div>
        <span class="collapse-icon" style="color: var(--color-text-muted);">{{ isExpanded ? '▼' : '▶' }}</span>
      </div>
    </div>

    <div v-show="isExpanded" class="combo-collapsible-wrapper">

    <template v-if="data">
      <p v-if="data.comboTheory" class="combo-theory">
        {{ data.comboTheory }}
      </p>

      <div class="filters">
        <div class="filter-grid">
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="搜索指令、备注、Starter..."
          />

          <select v-model="selectedSection">
            <option value="all">全部分类</option>
            <option
              v-for="section in sectionOptions"
              :key="section"
              :value="section"
            >
              {{ section }}
            </option>
          </select>

          <select v-model="selectedDifficulty">
            <option value="all">全部难度</option>
            <option
              v-for="difficulty in difficultyOptions"
              :key="difficulty"
              :value="difficulty"
            >
              {{ difficulty }}
            </option>
          </select>

          <select v-model="selectedPosition">
            <option value="all">全部位置</option>
            <option
              v-for="position in positionOptions"
              :key="position"
              :value="position"
            >
              {{ position }}
            </option>
          </select>
        </div>

        <div class="trigger-row">
          <button
            v-for="option in triggerOptions"
            :key="option.value"
            :class="['trigger-chip', { active: selectedTrigger === option.value }]"
            @click="selectedTrigger = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="groupedCombos.length > 0" class="combo-sections">
        <section
          v-for="group in groupedCombos"
          :key="group.section"
          class="combo-section"
        >
          <div class="combo-section-head">
            <h3>{{ group.section }}</h3>
            <span>{{ group.combos.length }} 条</span>
          </div>

          <article
            v-for="combo in group.combos"
            :key="`${group.section}-${combo.combo}`"
            class="combo-card"
          >
            <div class="combo-top">
              <code class="combo-string">{{ combo.combo }}</code>
              <a
                v-if="combo.videoUrl"
                :href="combo.videoUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="video-link"
              >
                Video
              </a>
            </div>

            <div v-if="combo.starter" class="starter-row">
              <span class="starter-label">Starter</span>
              <span class="starter-value">{{ combo.starter }}</span>
            </div>

            <div class="meta-row">
              <span
                v-for="chip in getMetaChips(combo)"
                :key="chip"
                class="meta-chip"
              >
                {{ chip }}
              </span>
            </div>

            <p v-if="combo.notes" class="combo-notes">
              {{ combo.notes }}
            </p>
          </article>
        </section>
      </div>

      <div v-else class="empty-state">
        <p>没有找到符合条件的连段。</p>
      </div>

      <p v-if="data.lastUpdated" class="last-updated">
        连段数据更新于 {{ data.lastUpdated }}
      </p>
    </template>

    <div v-else class="empty-state missing-data">
      <p>当前角色还没有抓取连段数据。</p>
      <code class="script-hint">pnpm exec tsx scripts/scraper-combos.ts {{ characterId }} --connect</code>
    </div>
    </div>
  </section>
</template>

<style scoped>
.section-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  padding: var(--space-xl);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  transition: opacity var(--transition-fast);
}

.section-head:hover {
  opacity: 0.8;
}

.combo-collapsible-wrapper {
  display: flex;
  flex-direction: column;
  margin-top: var(--space-lg);
}

.section-kicker {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-title {
  margin-top: 2px;
  font-size: var(--font-size-2xl);
}

.summary-chip {
  padding: 6px 12px;
  border-radius: var(--radius-full, 999px);
  background: rgba(255, 107, 53, 0.12);
  color: var(--color-accent);
  font-weight: 700;
  white-space: nowrap;
}

.combo-theory {
  margin-top: var(--space-md);
  padding: var(--space-md);
  border-left: 3px solid var(--color-accent);
  background: rgba(255, 107, 53, 0.06);
  color: var(--color-text-secondary);
}

.filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin-top: var(--space-lg);
}

.filter-grid {
  display: grid;
  grid-template-columns: minmax(220px, 1.6fr) repeat(3, minmax(160px, 1fr));
  gap: var(--space-md);
}

.search-input {
  min-width: 0;
}

.trigger-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.trigger-chip {
  padding: 8px 12px;
  border-radius: var(--radius-full, 999px);
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.trigger-chip:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.trigger-chip.active {
  background: var(--color-accent-light);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.combo-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  margin-top: var(--space-lg);
}

.combo-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.combo-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--color-border);
}

.combo-section-head h3 {
  font-size: var(--font-size-lg);
}

.combo-section-head span {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.combo-card {
  padding: var(--space-lg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}

.combo-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
}

.combo-string {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: var(--font-size-md);
  color: var(--color-text-primary);
}

.video-link {
  white-space: nowrap;
  font-size: var(--font-size-sm);
}

.starter-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}

.starter-label {
  padding: 4px 8px;
  border-radius: var(--radius-full, 999px);
  background: rgba(0, 212, 255, 0.12);
  color: #7fe9ff;
  font-size: var(--font-size-xs);
  font-weight: 700;
}

.starter-value {
  color: var(--color-text-secondary);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}

.meta-chip {
  padding: 4px 10px;
  border-radius: var(--radius-full, 999px);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.combo-notes {
  margin-top: var(--space-md);
  color: var(--color-text-secondary);
}

.empty-state {
  margin-top: var(--space-lg);
  padding: var(--space-xl);
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
}

.missing-data .script-hint {
  display: inline-block;
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
}

.last-updated {
  margin-top: var(--space-lg);
  text-align: right;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

@media (max-width: 900px) {
  .filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .section-panel {
    padding: var(--space-lg);
  }

  .section-head,
  .combo-top,
  .combo-section-head {
    flex-direction: column;
  }

  .section-title {
    font-size: var(--font-size-xl);
  }

  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
