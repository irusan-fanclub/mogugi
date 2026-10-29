<script setup lang="ts">
import { computed } from 'vue';
import { arcanaIconUrl, arcanaTitle } from '@/lib/arcana';
import { formatMinSec, getMabiNameColor, humanReadableNumber } from '@/lib/util';
import DIconButton from '../../ui/DIconButton.vue';
import AliasName from './AliasName.vue';
import MusicCell from './MusicCell.vue';
import { numWidth } from './playerColumns';
import type { PlayerVM } from './battleTypes';

const BARD_ARCANA = 2;   // 聖詠者

const props = defineProps<{
    vm: PlayerVM;
    expanded: boolean;
    narrow: boolean;
    origin: number;
    knownRealNames: string[];
    /** This player's line colour on the DPS chart; the share bar uses it. */
    seriesColor?: string;
}>();
const editing = defineModel<boolean>('editing', { default: false });
const emit = defineEmits<{
    toggle: [];
    arcana: [];
    timeline: [];
    hits: [];
    menu: [e: MouseEvent];
}>();

// Layout contract at the 640px minimum, inline so tests can pin it.
const ROW_STYLE = { display: 'flex', flexWrap: 'nowrap', overflow: 'hidden' } as const;

const arcanaSrc = computed(() => arcanaIconUrl(props.vm.arcanaHidden ? 0 : props.vm.arcana));
const arcanaTip = computed(() => props.vm.arcanaHidden
    ? '秘法已隱藏，點擊顯示'
    : `${arcanaTitle(props.vm.arcana)}（點擊隱藏）`);
const sharePct = computed(() => `${(100 * props.vm.share).toFixed(1)}%`);
</script>

<template>
  <div class="player" :data-player="vm.realName">
    <div
      class="player-row joined"
      :class="{ open: expanded }"
      :style="ROW_STYLE"
      :aria-expanded="expanded"
      @click="emit('toggle')"
      @contextmenu="emit('menu', $event)"
    >
      <i class="mdi chev" data-chev :class="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'" />
      <img
        class="arcana"
        :data-hidden="String(vm.arcanaHidden)"
        :src="arcanaSrc"
        :title="arcanaTip"
        width="22"
        height="22"
        alt=""
        @click.stop="emit('arcana')"
      >
      <AliasName
        v-model:editing="editing"
        :real-name="vm.realName"
        :display-name="vm.name"
        :known-real-names="knownRealNames"
        name-width="7em"
      />
      <span class="btns" data-shot-hide>
        <DIconButton icon="mdi-chart-timeline" title="狀態時間軸" :disabled="!vm.hasCondition" @click.stop="emit('timeline')" />
      </span>
      <MusicCell :cell="vm.music" :compact="narrow" :origin="origin" :bard="vm.arcana === BARD_ARCANA" />
      <span class="num num-time" :style="{ width: numWidth('time') }">{{ formatMinSec(vm.spanSec) }}</span>
      <span class="num num-total" :style="{ width: numWidth('total') }">{{ humanReadableNumber(vm.total) }}</span>
      <span class="num num-dps" :style="{ width: numWidth('dps') }">{{ humanReadableNumber(vm.dps) }}</span>
      <span class="num num-active" :style="{ width: numWidth('active') }" data-active-dps title="活躍 DPS：排除開場 5 秒、BOSS 無敵與死亡">{{ vm.activeDps === null ? '-' : humanReadableNumber(vm.activeDps) }}</span>
      <span class="num num-share" :style="{ width: numWidth('share') }">{{ sharePct }}</span>
    </div>
    <div class="share-bar joined" :class="{ open: expanded }" @click.stop="emit('hits')">
      <div class="fill" :style="{ width: `${Math.round(100 * vm.share)}%`, background: seriesColor ?? getMabiNameColor(vm.name) }" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.player { margin-bottom: var(--space-3); }
.player-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--row-h);
    padding: 0 var(--space-3);
    overflow: hidden;
    border-radius: var(--radius);
    background: var(--c-surface);
    cursor: pointer;
}
/* Row + share bar read as one rounded rectangle: row keeps top corners, bar the bottom. */
.player-row.joined { border-radius: var(--radius) var(--radius) 0 0; }
.player-row:hover { background: var(--c-surface-2); }
.chev { flex: none; margin-right: calc(-1 * var(--space-2)); color: var(--c-text-dim); }
.arcana { flex: none; cursor: pointer; }
.btns { display: inline-flex; flex: none; margin-left: calc(var(--space-1) - var(--space-3)); }
/* The music column follows the name; margin-right: auto pushes the numbers right and the gap stays clickable row. */
.player-row :deep(.music) { margin-right: auto; }
/* Same box, glyph size and spacing as AliasName's edit/dice buttons. */
.btns :deep(.d-icon-btn) { width: 20px; height: 20px; font-size: var(--fs-md); }
.num {
    flex: none;
    text-align: right;
    font-family: var(--font-num);
    white-space: nowrap;
}
.num-time { color: var(--c-text-dim); }
.num-total { color: var(--c-number); }
.num-dps { color: var(--c-dps); }
.num-active { color: var(--c-dps); }
.num-share { color: var(--c-share); }
.share-bar {
    position: relative;
    height: 5px;
    margin-top: 0;
    overflow: hidden;
    border-radius: var(--radius);
    background: var(--c-surface-2);
    cursor: pointer;
}
.share-bar.joined { border-radius: 0 0 var(--radius) var(--radius); }
/* Expanded: the skill table hangs straight off the bar, so the bar loses its bottom corners. */
.share-bar.joined.open { border-radius: 0; }
.fill { position: absolute; inset: 0 auto 0 0; opacity: 0.6; }
</style>
