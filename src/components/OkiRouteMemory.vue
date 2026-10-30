<script setup lang="ts">
import { computed } from 'vue';
import {
  getCompatibleKnockdownGroups,
  type OkiFrameRange,
  type OkiMemoryKnockdown,
} from '../utils/okiPressure';

const props = defineProps<{
  route: string;
  range: OkiFrameRange | null;
  knockdowns: OkiMemoryKnockdown[];
  currentWakeupFrame: number;
  opponentStartup: number;
}>();

const groups = computed(() => getCompatibleKnockdownGroups(props.knockdowns, props.range));
</script>

<template>
  <section class="route-memory">
    <h4>速记：一套路线，多个击倒</h4>
    <template v-if="range">
      <p class="memory-rule">
        <strong>{{ route }}</strong>
        <span>记作「+{{ range.start - 1 }}~+{{ range.end - 1 }}F 击倒 → 这套路线」</span>
      </p>
      <p class="memory-context">
        对 {{ opponentStartup }}F 普通抢招，覆盖起身 {{ range.start }}~{{ range.end }}F；同帧相杀不计入。
        复用时仍需满足原路线的距离、版边等条件，被防/命中优势随命中时机变化。
      </p>
      <ul v-if="groups.length" class="memory-groups">
        <li v-for="group in groups" :key="group.advantage" :class="{ current: group.wakeupFrame === currentWakeupFrame }">
          <span class="memory-advantage">+{{ group.advantage }}F <small>起身 {{ group.wakeupFrame }}F</small></span>
          <span class="memory-moves">
            <span v-for="move in group.moves" :key="JSON.stringify([move.name, move.input])">
              {{ move.name }} <small v-if="move.input">{{ move.input }}</small>
            </span>
          </span>
          <span v-if="group.wakeupFrame === currentWakeupFrame" class="memory-current">当前</span>
        </li>
      </ul>
      <p v-else class="memory-context">本角色预设暂无对应击倒，可用上方区间对照自己的连招击倒优势。</p>
    </template>
    <p v-else class="memory-context">当前抢招设置下，没有可复用的安全压制区间。</p>
  </section>
</template>

<style scoped>
.route-memory {
  padding: var(--space-md);
  margin-top: var(--space-md);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-align: left;
}

.route-memory h4 { margin: 0 0 var(--space-sm); color: var(--color-text-primary); }
.memory-rule { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin: 0 0 var(--space-sm); }
.memory-rule strong { color: var(--color-accent); }
.memory-context { margin: 0; color: var(--color-text-secondary); font-size: var(--font-size-sm); line-height: 1.6; }
.memory-groups { display: flex; flex-direction: column; gap: var(--space-xs); list-style: none; padding: 0; margin: var(--space-sm) 0 0; }
.memory-groups li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-sm); padding: var(--space-xs); border-radius: var(--radius-sm); }
.memory-groups li.current { background: rgba(63, 185, 80, 0.1); }
.memory-advantage { color: var(--color-positive); white-space: nowrap; }
.memory-moves { display: flex; flex-wrap: wrap; gap: var(--space-sm); overflow-wrap: anywhere; }
.memory-groups small { color: var(--color-text-muted); }
.memory-current { color: var(--color-positive); font-size: var(--font-size-xs); }
</style>
