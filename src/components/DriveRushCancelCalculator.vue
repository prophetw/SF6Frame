<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FrameData, Move } from '../types';
import { getMoveDisplayName } from '../i18n';
import { isCancelValid, isDriveRushCancelMove } from '../utils/gapCalculator';
import { calculateDriveRushCancelPressure, getDriveRushCancelFrame, isDriveRushCancelNormal } from '../utils/driveRushCancel';

const props = defineProps<{ frameData: FrameData }>();
const sourceIndex = ref(-1);
const followUpIndex = ref(-1);
const extraDelay = ref(0);
const isOpponentBurnout = ref(false);
const driveRush = computed(() => props.frameData.moves.find(isDriveRushCancelMove));
const sourceMoves = computed(() => props.frameData.moves
  .map((move, index) => ({ move, index }))
  .filter(({ move }) => isDriveRushCancelNormal(move) && driveRush.value && isCancelValid(move, driveRush.value)));
const followUpMoves = computed(() => props.frameData.moves
  .map((move, index) => ({ move, index }))
  .filter(({ move }) => isDriveRushCancelNormal(move)));
const move1 = computed(() => props.frameData.moves[sourceIndex.value]);
const move2 = computed(() => props.frameData.moves[followUpIndex.value]);
const cancelFrame = computed(() => move1.value ? getDriveRushCancelFrame(move1.value) : null);

watch(() => props.frameData, () => {
  sourceIndex.value = sourceMoves.value.find(({ move }) => move.input === '2MK')?.index ?? sourceMoves.value[0]?.index ?? -1;
  followUpIndex.value = followUpMoves.value.find(({ move }) => move.input === '5LP')?.index ?? followUpMoves.value[0]?.index ?? -1;
  extraDelay.value = 0;
  isOpponentBurnout.value = false;
}, { immediate: true });

function calculate(followUp: Move) {
  if (!move1.value || !driveRush.value) return null;
  return calculateDriveRushCancelPressure({
    move1: move1.value,
    move2: followUp,
    driveRush: driveRush.value,
    extraDelay: extraDelay.value,
    isOpponentBurnout: isOpponentBurnout.value,
  });
}

const result = computed(() => move2.value ? calculate(move2.value) : null);
const comparisonRows = computed(() => followUpMoves.value.map(entry => ({ ...entry, result: calculate(entry.move) })));
const ryuPresets = computed(() => {
  if (props.frameData.character.id !== 'ryu' || !sourceMoves.value.some(({ move }) => move.input === '2MK')) return [];
  return followUpMoves.value.filter(({ move }) => ['5LP', '5HP'].includes(move.input));
});

function selectPreset(index: number) {
  const source = sourceMoves.value.find(({ move }) => move.input === '2MK');
  if (!source) return;
  sourceIndex.value = source.index;
  followUpIndex.value = index;
  extraDelay.value = 0;
  isOpponentBurnout.value = false;
}

function formatFrames(value: number | undefined) {
  return value === undefined ? '—' : `${value > 0 ? '+' : ''}${value}F`;
}
</script>

<template>
  <section class="drive-rush-calculator card" aria-labelledby="drive-rush-title">
    <h2 id="drive-rush-title">招式 → 绿冲取消 → 后续招式</h2>
    <p class="hint">首招和后续招式均被防御。分别计算两次接触之间的空隙，以及后续招式被防后的优势帧。</p>

    <div v-if="ryuPresets.length" class="presets">
      <span>隆的示例：</span>
      <button v-for="entry in ryuPresets" :key="entry.index" type="button" @click="selectPreset(entry.index)">
        2MK → 绿冲取消 → {{ entry.move.input }}
      </button>
    </div>

    <p v-if="!driveRush" class="error-text" role="alert">当前角色缺少绿冲取消数据，无法计算。</p>
    <p v-else-if="!sourceMoves.length || !followUpMoves.length" class="error-text" role="alert">当前角色没有可用的绿冲取消招式数据。</p>
    <template v-else>
      <div class="move-inputs">
        <div class="move-field">
          <label for="drc-source">首招（被防）</label>
          <select id="drc-source" v-model="sourceIndex">
            <option v-for="entry in sourceMoves" :key="entry.index" :value="entry.index">
              {{ entry.move.input }} · {{ getMoveDisplayName(entry.move) }}
            </option>
          </select>
          <p v-if="move1" class="hint">持续 {{ move1.active }}F · 原始被防 {{ move1.onBlock }}F</p>
        </div>

        <div class="rush-step">
          <strong>绿冲取消</strong>
          <span>{{ driveRush.startup }}F</span>
          <small v-if="cancelFrame !== null">首招取消位置：{{ cancelFrame }}F</small>
        </div>

        <div class="move-field">
          <label for="drc-follow-up">后续招式（被防）</label>
          <select id="drc-follow-up" v-model="followUpIndex">
            <option v-for="entry in followUpMoves" :key="entry.index" :value="entry.index">
              {{ entry.move.input }} · {{ getMoveDisplayName(entry.move) }}
            </option>
          </select>
          <p v-if="move2" class="hint">发生 {{ move2.startup }}F · 原始被防 {{ move2.onBlock }}F · 绿冲加成 +4F</p>
        </div>
      </div>

      <p v-if="move1?.notes && cancelFrame !== 1" class="timing-note">首招取消限制：{{ move1.notes }}</p>
      <div class="conditions">
        <label for="drc-delay">额外延迟（F）
          <input id="drc-delay" v-model.number="extraDelay" type="number" min="0" step="1">
        </label>
        <label class="checkbox-label">
          <input v-model="isOpponentBurnout" type="checkbox">
          对方处于燃尽（每次防御硬直 +4F）
        </label>
      </div>

      <div v-if="result?.valid" class="pressure-result" aria-live="polite">
        <p class="sequence">{{ move1?.input }} → 绿冲取消 → {{ move2?.input }}</p>
        <div class="result-metrics">
          <div>
            <span>中间空隙（Gap）</span>
            <strong data-testid="drc-gap">{{ result.displayValue }}</strong>
            <p :class="result.statusClass">{{ result.status }}</p>
          </div>
          <div>
            <span>后续招式被防后优势</span>
            <strong data-testid="drc-advantage" :class="(result.onBlockAdvantage ?? 0) >= 0 ? 'plus' : 'minus'">{{ formatFrames(result.onBlockAdvantage) }}</strong>
            <p>{{ move2?.input }} 被防后，{{ result.onBlockAdvantage === 0 ? '双方同时可动' : (result.onBlockAdvantage ?? 0) > 0 ? '我方先动' : '对方先动' }}</p>
          </div>
        </div>
        <p>{{ result.description }}</p>
        <details>
          <summary>查看计算过程</summary>
          <p>空隙：{{ result.formulaDesc }} = {{ result.gap }}F</p>
          <p>被防优势：{{ result.onBlockFormula }} = {{ formatFrames(result.onBlockAdvantage) }}</p>
        </details>
        <p class="hint">{{ result.formulaNote }}</p>
      </div>
      <p v-else-if="result" class="error-text" role="alert">{{ result.error }}</p>

      <div v-if="result?.valid" class="comparison">
        <h3>同一首招的后续招式对比</h3>
        <p class="hint">沿用当前额外延迟与燃尽条件，点击招式查看详情。</p>
        <div class="table-scroll">
          <table>
            <thead><tr><th>后续招式</th><th>发生</th><th>空隙</th><th>压制判定</th><th>被防优势</th></tr></thead>
            <tbody>
              <tr v-for="row in comparisonRows" :key="row.index" :class="{ selected: row.index === followUpIndex }">
                <td><button type="button" @click="followUpIndex = row.index">{{ row.move.input }} · {{ getMoveDisplayName(row.move) }}</button></td>
                <td>{{ row.move.startup }}F</td>
                <td>{{ row.result?.valid ? row.result.displayValue : '—' }}</td>
                <td :class="row.result?.statusClass">{{ row.result?.valid ? row.result.status : row.result?.error }}</td>
                <td>{{ row.result?.valid ? formatFrames(row.result.onBlockAdvantage) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.drive-rush-calculator {
  padding: var(--space-lg);
}

h2, h3 { margin-bottom: var(--space-sm); }
.hint, .timing-note { color: var(--color-text-muted); font-size: 0.9rem; margin-top: var(--space-sm); }
.presets, .conditions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-md); margin: var(--space-lg) 0; }
.presets button, td button { color: var(--color-accent); cursor: pointer; background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-xs) var(--space-sm); }
.move-inputs { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: var(--space-lg); margin-top: var(--space-lg); }
.move-field label { display: block; margin-bottom: var(--space-xs); }
select, input[type="number"] { border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-primary); color: var(--color-text-primary); padding: var(--space-sm); font: inherit; }
select { width: 100%; }
input[type="number"] { width: 5rem; margin-left: var(--space-xs); }
.rush-step { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: var(--space-xs); color: var(--color-accent); }
.checkbox-label { display: flex; align-items: center; gap: var(--space-xs); }
.pressure-result { padding: var(--space-lg); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-secondary); }
.sequence { text-align: center; color: var(--color-text-secondary); }
.result-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-lg); text-align: center; margin: var(--space-lg) 0; }
.result-metrics strong { display: block; font-size: 2.5rem; margin: var(--space-sm) 0; }
.plus, .status-safe { color: var(--color-success); }
.minus, .status-danger, .error-text { color: var(--color-danger); }
.status-trap { color: var(--color-accent); }
.status-warning { color: var(--color-warning); }
details { margin-top: var(--space-md); overflow-wrap: anywhere; }
summary { cursor: pointer; color: var(--color-accent); }
details p { margin-top: var(--space-xs); }
.comparison { margin-top: var(--space-xl); }
.table-scroll { overflow-x: auto; margin-top: var(--space-sm); }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: var(--space-sm); border-bottom: 1px solid var(--color-border); }
th { white-space: nowrap; color: var(--color-text-muted); }
tr.selected { background: var(--color-bg-secondary); }
td button { text-align: left; }
@media (max-width: 640px) {
  .move-inputs, .result-metrics { grid-template-columns: minmax(0, 1fr); }
  .rush-step { padding: var(--space-sm); }
}
</style>
