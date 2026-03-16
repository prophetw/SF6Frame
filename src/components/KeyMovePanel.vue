<script setup lang="ts">
import { computed } from 'vue';
import { getMoveDisplayName } from '../i18n';
import type { FrameData, KeyMoveData, Move } from '../types';

const props = defineProps<{
  frameData: FrameData;
  data: KeyMoveData;
}>();

const resolvedKeyMoves = computed(() => {
  return props.data.keyMoves.map(entry => {
    const move = props.frameData.moves.find(candidate => candidate.input === entry.moveInput)
      ?? props.frameData.moves.find(candidate => candidate.name === entry.moveName);

    return {
      entry,
      move,
    };
  });
});

function formatAdvantage(value: string | undefined): string {
  if (!value) return '-';
  const normalized = value.replace(/[−–—]/g, '-').trim();
  const match = normalized.match(/-?\d+/);
  if (!match || !match[0]) return normalized;
  const parsed = parseInt(match[0], 10);
  if (Number.isNaN(parsed)) return normalized;
  return parsed > 0 ? `+${parsed}` : String(parsed);
}

function getCategoryLabel(move: Move | undefined): string {
  if (!move) return '未匹配';

  const labels: Record<string, string> = {
    normal: '通常技',
    unique: '特殊技',
    special: '必杀技',
    super: '超必杀',
    throw: '投技',
  };

  return labels[move.category] ?? move.category;
}
</script>

<template>
  <section class="section-panel key-move-panel">
    <div class="section-head">
      <div>
        <p class="section-kicker">Key Moves</p>
        <h2 class="section-title">核心招式</h2>
      </div>
      <span :class="['source-badge', data.source]">
        {{ data.source === 'manual' ? '手工整理' : '规则提炼' }}
      </span>
    </div>

    <p v-if="data.notes" class="panel-note">
      {{ data.notes }}
    </p>

    <div v-if="resolvedKeyMoves.length > 0" class="key-move-grid">
      <article
        v-for="item in resolvedKeyMoves"
        :key="`${item.entry.role}-${item.entry.moveInput}`"
        class="key-move-card"
      >
        <div class="card-head">
          <span class="role-badge">{{ item.entry.role }}</span>
          <span class="category-badge">{{ getCategoryLabel(item.move) }}</span>
        </div>

        <div class="move-identity">
          <h3 class="move-title">{{ item.move ? getMoveDisplayName(item.move) : (item.entry.moveName || item.entry.moveInput) }}</h3>
          <code class="move-input">{{ item.entry.moveInput }}</code>
        </div>

        <div v-if="item.move" class="move-stats">
          <span class="stat-chip">发生 {{ item.move.startup }}F</span>
          <span class="stat-chip">防御 {{ formatAdvantage(item.move.onBlock) }}</span>
          <span class="stat-chip">命中 {{ formatAdvantage(item.move.onHit) }}</span>
          <span class="stat-chip">伤害 {{ item.move.damage }}</span>
        </div>

        <p class="move-reason">{{ item.entry.reason }}</p>

        <div v-if="item.entry.tags && item.entry.tags.length > 0" class="tag-row">
          <span
            v-for="tag in item.entry.tags"
            :key="tag"
            class="move-tag"
          >
            {{ tag }}
          </span>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <p>当前角色还没有整理出核心招式。</p>
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

.source-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--radius-full, 999px);
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.source-badge.manual {
  background: rgba(63, 185, 80, 0.14);
  color: var(--color-positive);
}

.source-badge.generated {
  background: rgba(210, 153, 34, 0.18);
  color: var(--color-warning);
}

.panel-note {
  margin-top: var(--space-md);
  color: var(--color-text-secondary);
  max-width: 72ch;
}

.key-move-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-md);
  margin-top: var(--space-lg);
}

.key-move-card {
  padding: var(--space-lg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(180deg, rgba(255, 107, 53, 0.08) 0%, rgba(255, 107, 53, 0) 100%),
    var(--color-bg-secondary);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.role-badge,
.category-badge,
.move-tag,
.stat-chip {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-full, 999px);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.role-badge {
  padding: 4px 10px;
  background: var(--color-accent-light);
  color: var(--color-accent);
  font-weight: 700;
}

.category-badge {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
}

.move-identity {
  margin-top: var(--space-md);
}

.move-title {
  font-size: var(--font-size-lg);
}

.move-input {
  display: inline-block;
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
}

.move-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}

.stat-chip {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.move-reason {
  margin-top: var(--space-md);
  color: var(--color-text-primary);
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}

.move-tag {
  padding: 4px 10px;
  background: rgba(0, 212, 255, 0.12);
  color: #7fe9ff;
}

.empty-state {
  margin-top: var(--space-lg);
  padding: var(--space-xl);
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
}

@media (max-width: 640px) {
  .section-panel {
    padding: var(--space-lg);
  }

  .section-head {
    flex-direction: column;
  }

  .section-title {
    font-size: var(--font-size-xl);
  }
}
</style>
