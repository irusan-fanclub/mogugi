<script setup lang="ts">
import { computed, ref } from 'vue';
import { condNameMap, region } from '@/store';
import { availableCCs, reorder, reorderWithin } from '@/lib/ccTracking';
import { ccIconUrl, ccName } from '@/lib/util';
import DIconButton from '../../ui/DIconButton.vue';
import DReorderList from '../../ui/DReorderList.vue';
import DSwitch from '../../ui/DSwitch.vue';
import DTextField from '../../ui/DTextField.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { ccMenuItems, removeCc, setCcHidden, trackCc } from './ccGroupActions';
import CcIconGrid from './CcIconGrid.vue';
import CcPicker from './CcPicker.vue';
import { ccPickMode } from './ccPickMode';

// One group (BOSS or 自身) of the DPS chart's tracked CCs: on the timeline, coverage only, or neither.
const props = defineProps<{
    title: string;
    addTitle: string;
    placeholder: string;
    rowAttr: string;
    tracked: number[];
    hidden: Set<number>;
    // CCs seen on this group's actor, for 只顯示出現過.
    seen: Iterable<number>;
    defaults?: number[];
    setTracked: (list: number[]) => void;
    setHidden: (hidden: Set<number>) => void;
}>();

const items = computed(() => props.tracked.map(id => ({
    key: id,
    label: `${ccName(condNameMap.value, id)} ${id}`,
    icon: ccIconUrl(region.value, id),
})));
const onChart = computed(() => props.tracked.filter(id => !props.hidden.has(id)));
const coverageOnly = computed(() => props.tracked.filter(id => props.hidden.has(id)));

const withHidden = (id: number, on: boolean) => setCcHidden(props, id, on);
const remove = (id: number) => removeCc(props, id);
const track = (id: number, chart: boolean) => trackCc(props, id, chart);

const reorderGroup = (chart: boolean, from: number, to: number) =>
    props.setTracked(reorderWithin(props.tracked, id => props.hidden.has(id) !== chart, from, to));

const menu = useContextMenu();
const openMenu = (id: number, e: MouseEvent) => menu.open(e, ccMenuItems(props, id));

const seenOnly = ref(true);
const search = ref('');
const candidates = computed(() => availableCCs({
    tracked: props.tracked,
    targetCCIds: [...props.seen],
    catalogue: seenOnly.value ? null : Object.keys(condNameMap.value).map(Number),
    search: search.value,
    nameOf: id => ccName(condNameMap.value, id),
    defaults: props.defaults,
}));
</script>

<template>
  <div class="group">
    <div class="sub"><span>{{ title }}</span></div>
    <div v-if="ccPickMode === 'list'" class="scroll tall">
      <DReorderList :items="items" @reorder="(f, t) => setTracked(reorder(tracked, f, t))">
        <template #actions="{ item }">
          <DIconButton
            icon="mdi-chart-timeline-variant"
            :title="hidden.has(item.key as number) ? '只算覆蓋率，點擊上圖' : '上圖並算覆蓋率，點擊從圖上隱藏'"
            :active="!hidden.has(item.key as number)"
            data-chart-toggle
            @click="withHidden(item.key as number, !hidden.has(item.key as number))"
          />
          <DIconButton icon="mdi-close" title="移除" data-remove @click="remove(item.key as number)" />
        </template>
      </DReorderList>
    </div>
    <div v-else class="icons">
      <div class="lane" data-on-chart>
        <span class="lname">時間軸</span>
        <CcIconGrid :ids="onChart" draggable empty-text="無" @menu="openMenu" @reorder="(f, t) => reorderGroup(true, f, t)" />
      </div>
      <div class="lane" data-coverage-only>
        <span class="lname">僅覆蓋率</span>
        <CcIconGrid :ids="coverageOnly" draggable empty-text="無" @menu="openMenu" @reorder="(f, t) => reorderGroup(false, f, t)" />
      </div>
    </div>

    <div class="sub add">
      <span>{{ addTitle }}</span>
      <DSwitch v-model="seenOnly" label="只顯示出現過" />
    </div>
    <DTextField v-model="search" clearable :placeholder="placeholder" />
    <div class="scroll short">
      <CcPicker
        :ids="candidates.list"
        :overflow="candidates.overflow"
        :row-attr="rowAttr"
        @pick="id => track(id, true)"
        @menu="openMenu"
      />
    </div>
  </div>
</template>

<style scoped>
.group { display: flex; flex-direction: column; gap: var(--space-3); }
.sub {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: var(--space-2); border-bottom: 1px solid var(--c-line);
    color: var(--c-text); font-size: var(--fs-md); font-weight: 600;
}
.sub :deep(label), .sub :deep([role="switch"]) { font-weight: normal; }
.add { margin-top: var(--space-2); }
.scroll { overflow-y: auto; }
.tall { max-height: 320px; }
.short { max-height: 220px; }
.icons { display: flex; flex-direction: column; gap: var(--space-2); }
.lane { display: flex; align-items: flex-start; gap: var(--space-3); }
.lname { flex: none; width: 4.5em; line-height: 26px; color: var(--c-text-dim); font-size: var(--fs-xs); }
/* One icon row high, so 無 lines up with its label. */
.lane :deep(.empty) { line-height: 26px; }
</style>
