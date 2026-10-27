<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FrameData, Move } from '../types';
import { getMoveDisplayName } from '../i18n';
import { isCancelValid, isDriveRushCancelMove, type CalculationType, type HitState } from '../utils/gapCalculator';
import { calculateDriveRushCancelPressure, getDriveRushCancelFrame, isDriveRushCancelNormal } from '../utils/driveRushCancel';

const props = defineProps<{ frameData: FrameData; type: CalculationType }>();
const sourceIndex = ref(-1);
const followUpIndex = ref(-1);
const extraDelay = ref(0);
const isOpponentBurnout = ref(false);
const hitState = ref<HitState>('normal');
const outcomeLabel = computed(() => props.type === 'hit' ? '命中' : '被防');
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
  hitState.value = 'normal';
}, { immediate: true });

function calculate(followUp: Move) {
  if (!move1.value || !driveRush.value) return null;
  return calculateDriveRushCancelPressure({
    move1: move1.value,
    move2: followUp,
    driveRush: driveRush.value,
    type: props.type,
    hitState: hitState.value,
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
  hitState.value = 'normal';
}

function formatFrames(value: number | undefined) {
  return value === undefined ? '—' : `${value > 0 ? '+' : ''}${value}F`;
}
</script>

<template>
  <section class="drive-rush-calculator card" aria-labelledby="drive-rush-title">
    <h2 id="drive-rush-title">招式 → 绿冲取消 → 后续招式</h2>
    <p v-if="type === 'block'" class="hint">首招和后续招式均被防御。分别计算两次接触之间的空隙，以及后续招式被防后的优势帧。</p>
    <p v-else class="hint">首招命中后，判断绿冲取消能否接上后续招式，并计算后续招式普通命中时的优势帧。可使用上方“打中 / 被防御”切换。</p>

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
          <label for="drc-source">首招（{{ outcomeLabel }}）</label>
          <select id="drc-source" v-model="sourceIndex">
            <option v-for="entry in sourceMoves" :key="entry.index" :value="entry.index">
              {{ entry.move.input }} · {{ getMoveDisplayName(entry.move) }}
            </option>
          </select>
          <p v-if="move1" class="hint">持续 {{ move1.active }}F · 原始{{ outcomeLabel }} {{ type === 'hit' ? move1.onHit : move1.onBlock }}F</p>
        </div>

        <div class="rush-step">
          <strong>绿冲取消</strong>
          <span>{{ driveRush.startup }}F</span>
          <small v-if="cancelFrame !== null">首招取消位置：{{ cancelFrame }}F</small>
        </div>

        <div class="move-field">
          <label for="drc-follow-up">后续招式（{{ outcomeLabel }}）</label>
          <select id="drc-follow-up" v-model="followUpIndex">
            <option v-for="entry in followUpMoves" :key="entry.index" :value="entry.index">
              {{ entry.move.input }} · {{ getMoveDisplayName(entry.move) }}
            </option>
          </select>
          <p v-if="move2" class="hint">发生 {{ move2.startup }}F · 原始{{ outcomeLabel }} {{ type === 'hit' ? move2.onHit : move2.onBlock }}F · 绿冲加成 +4F</p>
        </div>
      </div>

      <p v-if="move1?.notes && cancelFrame !== 1" class="timing-note">首招取消限制：{{ move1.notes }}</p>
      <fieldset v-if="type === 'hit'" class="hit-state-controls">
        <legend>首招命中状态</legend>
        <div class="modifier-options">
          <label class="checkbox-label"><input id="drc-hit-normal" v-model="hitState" type="radio" name="drc-hit-state" value="normal">普通命中</label>
          <label class="checkbox-label"><input id="drc-hit-ch" v-model="hitState" type="radio" name="drc-hit-state" value="ch">打康（+2F）</label>
          <label class="checkbox-label"><input id="drc-hit-pc" v-model="hitState" type="radio" name="drc-hit-state" value="pc">确反康（+4F）</label>
        </div>
        <p class="hint">打康与确反康互斥，只增加首招命中硬直；连招中的后续招式按普通命中计算。</p>
      </fieldset>
      <div class="conditions">
        <label for="drc-delay">额外延迟（F）
          <input id="drc-delay" v-model.number="extraDelay" type="number" min="0" step="1">
        </label>
        <label v-if="type === 'block'" class="checkbox-label">
          <input v-model="isOpponentBurnout" type="checkbox">
          打白（对方燃尽，被防 +4F）
        </label>
      </div>

      <div v-if="result?.valid" class="pressure-result" aria-live="polite">
        <p class="sequence">{{ move1?.input }} → 绿冲取消 → {{ move2?.input }}</p>
        <div class="result-metrics">
          <div>
            <span>{{ type === 'hit' ? result.displayLabel : '中间空隙（Gap）' }}</span>
            <strong data-testid="drc-gap">{{ result.displayValue }}</strong>
            <p :class="result.statusClass">{{ result.status }}</p>
          </div>
          <div>
            <span>后续招式{{ outcomeLabel }}后优势</span>
            <strong data-testid="drc-advantage" :class="(result.followUpAdvantage ?? 0) >= 0 ? 'plus' : 'minus'">{{ formatFrames(result.followUpAdvantage) }}</strong>
            <p>{{ move2?.input }} {{ outcomeLabel }}后，{{ result.followUpAdvantage === 0 ? '双方同时可动' : (result.followUpAdvantage ?? 0) > 0 ? '我方先动' : '对方先动' }}</p>
          </div>
        </div>
        <p>{{ result.description }}</p>
        <details>
          <summary>查看计算过程</summary>
          <p>{{ type === 'hit' ? '连招窗口' : '空隙' }}：{{ result.formulaDesc }} = {{ result.gap }}F</p>
          <p>{{ outcomeLabel }}优势：{{ result.followUpAdvantageFormula }} = {{ formatFrames(result.followUpAdvantage) }}</p>
        </details>
        <p class="hint">{{ result.formulaNote }}</p>
      </div>
      <p v-else-if="result" class="error-text" role="alert">{{ result.error }}</p>

      <div v-if="result?.valid" class="comparison">
        <h3>同一首招的后续招式对比</h3>
        <p class="hint">沿用当前{{ outcomeLabel }}状态与额外延迟，点击招式查看详情。{{ type === 'hit' ? '连招窗口正值为剩余帧数，负值为缺失帧数。' : '' }}</p>
        <div class="table-scroll">
          <table>
            <thead><tr><th>后续招式</th><th>发生</th><th>{{ type === 'hit' ? '连招窗口' : '空隙' }}</th><th>{{ type === 'hit' ? '连招判定' : '压制判定' }}</th><th>{{ outcomeLabel }}优势</th></tr></thead>
            <tbody>
              <tr v-for="row in comparisonRows" :key="row.index" :class="{ selected: row.index === followUpIndex }">
                <td><button type="button" @click="followUpIndex = row.index">{{ row.move.input }} · {{ getMoveDisplayName(row.move) }}</button></td>
                <td>{{ row.move.startup }}F</td>
                <td>{{ row.result?.valid ? (type === 'hit' ? formatFrames(row.result.gap) : row.result.displayValue) : '—' }}</td>
                <td :class="row.result?.statusClass">{{ row.result?.valid ? row.result.status : row.result?.error }}</td>
                <td>{{ row.result?.valid ? formatFrames(row.result.followUpAdvantage) : '—' }}</td>
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
.hit-state-controls { border: 0; padding: 0; min-width: 0; margin-top: var(--space-lg); }
.modifier-options { display: flex; flex-wrap: wrap; gap: var(--space-md); margin-top: var(--space-sm); }
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
