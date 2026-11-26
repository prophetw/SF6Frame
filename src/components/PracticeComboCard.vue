<script setup lang="ts">
import { computed } from 'vue';
import type { PracticeCombo } from '../types';

const props = defineProps<{ route: PracticeCombo }>();
const oki = computed(() => props.route.oki);
const hasOkiDetails = computed(() => {
  const followup = oki.value;
  return followup && (
    followup.alternateEnder || followup.corner || followup.onHit || followup.onBlock || followup.calculator
  );
});
const calculatorLink = computed(() => {
  const calculator = oki.value?.calculator;
  if (!calculator) return;
  return {
    name: 'oki',
    query: { character: calculator.characterId, move: calculator.moveInput, advantage: calculator.advantage },
  };
});
</script>

<template>
  <article class="route">
    <span class="level">{{ route.difficulty }}</span>
    <p>{{ route.when }}</p>
    <code>{{ route.input }}</code>
    <section v-if="oki" class="route-oki">
      <h4>击倒后怎么打</h4>
      <p>{{ oki.setup }}</p>
      <details v-if="hasOkiDetails" class="route-oki-details">
        <summary>更多后续</summary>
        <dl v-if="oki.alternateEnder || oki.corner || oki.onHit || oki.onBlock">
          <template v-if="oki.alternateEnder">
            <dt>同一起手换收尾</dt>
            <dd>
              <code>{{ oki.alternateEnder.input }}</code>
              <p>{{ oki.alternateEnder.setup }}</p>
            </dd>
          </template>
          <template v-if="oki.corner">
            <dt>版边变化</dt>
            <dd>{{ oki.corner }}</dd>
          </template>
          <template v-if="oki.onHit">
            <dt>命中后</dt>
            <dd>{{ oki.onHit }}</dd>
          </template>
          <template v-if="oki.onBlock">
            <dt>被防后</dt>
            <dd>{{ oki.onBlock }}</dd>
          </template>
        </dl>
        <RouterLink v-if="oki.calculator && calculatorLink" :to="calculatorLink" class="calculator-link">
          压起身计算器 · {{ oki.calculator.moveInput }} +{{ oki.calculator.advantage }}F
        </RouterLink>
      </details>
    </section>
    <a v-if="route.source" :href="route.source.url" target="_blank" rel="noopener noreferrer">{{ route.source.label }} ↗</a>
  </article>
</template>

<style scoped>
.route { margin: var(--space-sm) 0 var(--space-md); }
.route > p { margin: var(--space-xs) 0 var(--space-sm); }
.level, .route a { font-size: var(--font-size-sm); }
.level { color: var(--color-text-secondary); }
.route code {
  display: block;
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
.route-oki {
  margin-top: var(--space-sm);
  padding: var(--space-sm);
  border-inline-start: 2px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--color-bg-tertiary);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}
.route-oki h4 { font-size: inherit; }
.route-oki p { margin-top: var(--space-xs); }
.route-oki-details { margin-top: var(--space-xs); }
.route-oki-details summary { cursor: pointer; color: var(--color-accent-hover); }
.route-oki-details dt { margin-top: var(--space-sm); font-weight: 600; }
.route-oki-details code { margin-top: var(--space-xs); }
.calculator-link { display: inline-block; margin-top: var(--space-sm); }
</style>
