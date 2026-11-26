<script setup lang="ts">
import { computed } from 'vue';
import type { ComboGuide } from '../types';
import PracticeComboCard from './PracticeComboCard.vue';

const props = defineProps<{ guide: ComboGuide }>();

const groups = [
  { key: 'normal', label: '常规命中' },
  { key: 'punish', label: '常规确反' },
  { key: 'rush', label: '立回绿冲' },
] as const;
const scenarios = computed(() => groups.map(({ key, label }) => {
  const [first, ...more] = props.guide[key];
  return { key, label, first, more, hasMoreOki: more.some(route => route.oki) };
}));
</script>

<template>
  <section class="practice" aria-labelledby="combo-practice-title">
    <header>
      <h2 id="combo-practice-title">常用连段 · 先练这 3 条</h2>
      <span>经典操作</span>
    </header>
    <div class="practice-grid">
      <section v-for="group in scenarios" :key="group.key" class="scenario">
        <h3>{{ group.label }}</h3>
        <PracticeComboCard :route="group.first" />
        <details v-if="group.more.length" class="more-routes">
          <summary>
            更多{{ group.label }}（{{ group.more.length }}）
            <span v-if="group.hasMoreOki" class="has-oki">含击倒后续</span>
          </summary>
          <PracticeComboCard v-for="route in group.more" :key="route.input" :route="route" />
        </details>
      </section>
    </div>
    <section class="pressure-panel" aria-labelledby="practice-pressure-title">
      <h3 id="practice-pressure-title">常用压制 · 打乱动</h3>
      <p class="pressure-hint">看对手防住哪一招后喜欢按键。这里的 4F 指最快的普通打击，无敌反击要单独防。</p>
      <div class="pressure-grid">
        <article v-for="route in guide.pressure" :key="route.input" class="pressure-card">
          <code>{{ route.input }}</code>
          <p>{{ route.when }}</p>
          <a :href="route.source.url" target="_blank" rel="noopener noreferrer">{{ route.source.label }} ↗</a>
        </article>
      </div>
    </section>
    <footer>
      <details class="notation">
        <summary>怎么看按键？</summary>
        <p>角色朝右时，2 是下，4 是后，5 是站立，6 是前。看数字方向可以对照小键盘。</p>
        <pre aria-label="数字方向">7 ↖   8 ↑   9 ↗
4 ←   5 ·   6 →
1 ↙   2 ↓   3 ↘</pre>
        <p>LP / MP / HP 是轻拳 / 中拳 / 重拳，LK / MK / HK 是轻脚 / 中脚 / 重脚。P、K 表示任意强度，PP、KK 表示同时按两个拳或脚，PPP 表示三拳同按。</p>
        <p>例如 2LP 是蹲轻拳，236MK 是 ↓↘→ 加中脚。按箭头顺序出招，~ 表示派生或连续输入，j. 表示跳跃中，[ ] 表示蓄力或按住。</p>
        <p>确反指打中对方的收招硬直。例如挡住 -4F 的招时，如果距离够近，我方发生 4 帧的招可以确反。</p>
        <p>DRC 是普通技取消绿冲（通常消耗 3 格斗气），裸 DR 是从招架直接绿冲（消耗 1 格）。DI 是斗气迸发。SA1 / SA2 / SA3 是对应等级的超必杀。</p>
      </details>
      <details class="sources">
        <summary>路线来源</summary>
        <a v-for="source in guide.sources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.label }} ↗</a>
      </details>
    </footer>
  </section>
</template>

<style scoped>
.practice {
  padding: var(--space-xl);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-bg-card);
}
header, footer {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
header span, footer, summary { font-size: var(--font-size-sm); }
header span, footer { color: var(--color-text-secondary); }
.practice-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  gap: var(--space-md);
  margin: var(--space-md) 0;
}
.scenario {
  padding: var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
}
.scenario h3 { color: var(--color-accent-hover); }
.practice code, pre { font-family: var(--font-mono); }
.practice code {
  display: block;
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  overflow-wrap: anywhere;
}
.pressure-panel { margin-bottom: var(--space-lg); }
.pressure-hint, .pressure-card a { font-size: var(--font-size-sm); }
.pressure-hint { color: var(--color-text-secondary); margin: var(--space-xs) 0 var(--space-sm); }
.pressure-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: var(--space-md); }
.pressure-card { padding: var(--space-md); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.pressure-card p { margin: var(--space-sm) 0; }
summary { cursor: pointer; }
.sources a { display: block; margin-top: var(--space-xs); }
.more-routes { border-top: 1px solid var(--color-border); padding-top: var(--space-sm); }
.more-routes > .route:last-child { margin-bottom: 0; }
.has-oki { color: var(--color-accent-hover); }
.notation { flex: 1 1 16rem; }
.notation p, pre { margin-top: var(--space-sm); }
@media (max-width: 800px) {
  .practice { padding: var(--space-lg); }
  .practice-grid { grid-template-columns: 1fr; }
}
</style>
