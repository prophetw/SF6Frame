<script setup lang="ts">
import type { Move, CharacterStats } from '../types';
import { calculateMoveStats } from '../utils/gapCalculator';
import { getMoveDisplayName } from '../i18n';

const props = defineProps<{
  moves: Move[];
  stats?: CharacterStats;
  sortKey?: string;
  sortOrder?: 'asc' | 'desc';
}>();

const emit = defineEmits<{
  (e: 'update:sort', key: string): void;
}>();

function handleSort(key: string) {
  emit('update:sort', key);
}

function getSortIcon(key: string) {
  if (props.sortKey !== key) return '↕';
  return props.sortOrder === 'asc' ? '↑' : '↓';
}

function formatFrameValue(val: string): string {
  const num = parseInt(val);
  if (isNaN(num)) return val;
  return num > 0 ? `+${num}` : String(num);
}

function getFrameClass(val: string): string {
  const num = parseInt(val);
  if (isNaN(num)) return '';
  if (num > 0) return 'frame-positive';
  if (num < 0) return 'frame-negative';
  return 'frame-neutral';
}

function getCategoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    normal: '通常',
    unique: '特殊',
    special: '必杀',
    super: '超必',
    throw: '投技',
  };
  return labels[cat] || cat;
}

function getMoveStats(move: Move) {
  return calculateMoveStats(move);
}

function getTotalFrames(move: Move): string {
  if (move.raw && move.raw.total !== undefined) {
    return String(move.raw.total);
  }
  
  // Calculate if not available in raw
  const startup = parseInt(move.startup);
  const active = parseInt(move.active);
  const recovery = parseInt(move.recovery);
  
  if (!isNaN(startup) && !isNaN(active) && !isNaN(recovery)) {
    return String(startup + active + recovery - 1);
  }
  
  return '-';
}
</script>

<template>
  <div class="move-table-container">
    <!-- Stats Bar -->
    <div v-if="stats" class="stats-bar">
      <div class="stat-item">
        <span class="stat-label">前冲</span>
        <span class="stat-value">{{ stats.forwardDash }}F</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">后冲</span>
        <span class="stat-value">{{ stats.backDash }}F</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">体力</span>
        <span class="stat-value">{{ stats.health }}</span>
      </div>
    </div>
    
    <div class="move-table-wrapper">
      <div v-if="moves.length === 0" class="empty-state">
        <p>没有找到匹配的招式</p>
      </div>
      
      <table v-else class="move-table">
        <thead>
          <tr>
            <th class="col-name" @click="handleSort('name')">招式 <span class="sort-icon">{{ getSortIcon('name') }}</span></th>
            <th class="col-input" @click="handleSort('input')">指令 <span class="sort-icon">{{ getSortIcon('input') }}</span></th>
            <th class="col-damage" @click="handleSort('damage')">伤害 <span class="sort-icon">{{ getSortIcon('damage') }}</span></th>
            <th class="col-startup" @click="handleSort('startup')">发生 <span class="sort-icon">{{ getSortIcon('startup') }}</span></th>
            <th class="col-active" @click="handleSort('active')">持续 <span class="sort-icon">{{ getSortIcon('active') }}</span></th>
            <th class="col-recovery" @click="handleSort('recovery')">硬直 <span class="sort-icon">{{ getSortIcon('recovery') }}</span></th>
            <th class="col-total" @click="handleSort('total')">总帧数 <span class="sort-icon">{{ getSortIcon('total') }}</span></th>
            <th class="col-onblock" @click="handleSort('onBlock')">防御 <span class="sort-icon">{{ getSortIcon('onBlock') }}</span></th>
            <th class="col-onhit" @click="handleSort('onHit')">命中 <span class="sort-icon">{{ getSortIcon('onHit') }}</span></th>
            <th class="col-blockstun" @click="handleSort('blockstun')">防硬 <span class="sort-icon">{{ getSortIcon('blockstun') }}</span></th>
            <th class="col-hitstun" @click="handleSort('hitstun')">命硬 <span class="sort-icon">{{ getSortIcon('hitstun') }}</span></th>
            <th class="col-cancels">取消</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="move in moves" :key="`${move.name}-${move.input}`" class="move-row">
            <td class="col-name" data-label="招式">
              <div class="move-name-wrap">
                <span class="move-name">{{ getMoveDisplayName(move) }}</span>
                <span :class="['move-category', `cat-${move.category}`]">
                  {{ getCategoryLabel(move.category) }}
                </span>
              </div>
            </td>
            <td class="col-input" data-label="指令">
              <code class="input-code">{{ move.input }}</code>
            </td>
            <td class="col-damage" data-label="伤害">{{ move.damage }}</td>
            <td class="col-startup" data-label="发生">{{ move.startup }}</td>
            <td class="col-active" data-label="持续">{{ move.active }}</td>
            <td class="col-recovery" data-label="硬直">{{ move.recovery }}</td>
            <td class="col-total" data-label="总帧数">{{ getTotalFrames(move) }}</td>
            <td class="col-onblock" data-label="防御差" :class="getFrameClass(move.onBlock)">
              {{ formatFrameValue(move.onBlock) }}
            </td>
            <td class="col-onhit" data-label="命中差" :class="getFrameClass(move.onHit)">
              {{ formatFrameValue(move.onHit) }}
            </td>
            <!-- Derived Stats -->
            <td class="col-blockstun" data-label="防御硬直">
              {{ getMoveStats(move).blockstun }}
            </td>
             <td class="col-hitstun" data-label="命中硬直">
              {{ getMoveStats(move).hitstun }}
            </td>

            <td class="col-cancels" data-label="取消">
              <span v-if="move.cancels && move.cancels.length > 0" class="cancel-tags">
                <span 
                  v-for="cancel in move.cancels" 
                  :key="cancel"
                  :class="['cancel-tag', `cancel-${cancel.toLowerCase().replace(' ', '-')}`]"
                >
                  {{ cancel }}
                </span>
              </span>
              <span v-else class="no-cancel">-</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.move-table-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* Stats Bar */
.stats-bar {
  display: flex;
  gap: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
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

.move-table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.empty-state {
  padding: var(--space-xl);
  text-align: center;
  color: var(--color-text-muted);
}

.move-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.move-table th,
.move-table td {
  padding: var(--space-sm) var(--space-md);
  text-align: left;
  border-bottom: 1px solid var(--color-border-light);
}

.move-table th {
  background: var(--color-bg-tertiary);
  font-weight: 600;
  color: var(--color-text-secondary);
  position: sticky;
  top: 0;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.move-table th:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}

.sort-icon {
  display: inline-block;
  margin-left: 4px;
  font-size: 0.8em;
  opacity: 0.7;
}

.move-row:hover {
  background: var(--color-bg-secondary);
}

.move-name-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.move-name {
  font-weight: 500;
  color: var(--color-text-primary);
}

.move-category {
  display: inline-block;
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  width: fit-content;
}

.cat-normal { background: rgba(139, 148, 158, 0.2); }
.cat-unique { background: rgba(210, 153, 34, 0.2); color: var(--color-warning); }
.cat-special { background: rgba(0, 212, 255, 0.2); color: #00d4ff; }
.cat-super { background: rgba(255, 107, 53, 0.2); color: var(--color-accent); }
.cat-throw { background: rgba(123, 47, 247, 0.2); color: #7b2ff7; }

.input-code {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  background: var(--color-bg-tertiary);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.col-startup,
.col-active,
.col-recovery,
.col-damage,
.col-total {
  text-align: center;
}

.col-onblock,
.col-onhit {
  text-align: center;
  font-weight: 600;
}

/* Cancel Tags */
.cancel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cancel-tag {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.cancel-special { background: rgba(0, 212, 255, 0.15); color: #00d4ff; }
.cancel-super { background: rgba(255, 107, 53, 0.15); color: var(--color-accent); }
.cancel-sa1 { background: rgba(255, 180, 53, 0.15); color: #ffb435; }
.cancel-sa2 { background: rgba(255, 140, 53, 0.15); color: #ff8c35; }
.cancel-sa3 { background: rgba(255, 100, 53, 0.15); color: #ff6435; }
.cancel-chain { background: rgba(139, 148, 158, 0.15); color: var(--color-text-secondary); }
.cancel-target-combo { background: rgba(210, 153, 34, 0.15); color: var(--color-warning); }

.no-cancel {
  color: var(--color-text-muted);
}

/* Mobile responsive - card layout */
@media (max-width: 768px) {
  .stats-bar {
    flex-wrap: wrap;
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
  }
  
  .move-table {
    display: block;
  }
  
  .move-table thead {
    display: none;
  }
  
  .move-table tbody {
    display: block;
  }
  
  .move-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-xs);
    padding: var(--space-md);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-card);
    margin-bottom: var(--space-sm);
    border-radius: var(--radius-md);
  }
  
  .move-row td {
    border: none;
    padding: var(--space-xs);
  }
  
  .move-row td::before {
    content: attr(data-label);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    display: block;
    margin-bottom: 2px;
  }
  
  .col-name {
    grid-column: 1 / -1;
  }
  
  .col-input {
    grid-column: 1 / -1;
  }
  
  .col-cancels {
    grid-column: 1 / -1;
  }
}
</style>
