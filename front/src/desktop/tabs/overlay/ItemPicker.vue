<script lang="ts">
import { computed, ref } from 'vue';

export interface PickerItem { id: number; name: string; sub?: string }
export type PickerMark = '' | 'added' | 'cur';
type View = 'grid' | 'list';
// Remembered for the session, shared by every picker.
const view = ref<View>('grid');
</script>

<script setup lang="ts">
import DButton from '../../ui/DButton.vue';
import DSegmented from '../../ui/DSegmented.vue';

const props = defineProps<{
    title: string;
    items: PickerItem[];
    iconOf: (id: number) => string;
    markOf: (id: number) => PickerMark;
    sources?: { value: string; label: string }[];
    source?: string;
}>();
const emit = defineEmits<{ pick: [id: number]; close: []; 'update:source': [v: string] }>();

const VIEWS: { value: View; label: string }[] = [{ value: 'grid', label: '圖示' }, { value: 'list', label: '清單' }];
const q = ref('');
const hover = ref<PickerItem | null>(null);
const shown = computed(() => {
    const s = q.value.trim();
    return s ? props.items.filter(x => x.name.includes(s) || String(x.id).includes(s)) : props.items;
});
const choose = (x: PickerItem) => { if (props.markOf(x.id) !== 'added') emit('pick', x.id); };
const TAG: Record<PickerMark, string> = { '': '', added: '已加入', cur: '使用中' };
</script>

<template>
  <div class="picker" data-picker>
    <div class="ph">
      <b>{{ title }}</b>
      <DSegmented
        v-if="sources" :model-value="source ?? sources[0]?.value ?? ''" :options="sources" data-picker-source
        @update:model-value="(v: string) => emit('update:source', v)"
      />
      <DSegmented v-model="view" :options="VIEWS" data-picker-view />
      <DButton size="sm" data-picker-close @click="emit('close')">關閉</DButton>
    </div>
    <div class="pq"><input v-model="q" class="q" placeholder="搜尋名稱或 ID" data-picker-q></div>
    <div class="pb">
      <div v-if="shown.length === 0" class="empty">找不到符合的項目</div>
      <div v-else-if="view === 'grid'" class="pgrid" data-picker-grid>
        <div
          v-for="x in shown" :key="x.id" class="pcell" :class="markOf(x.id)" :data-pick="x.id" :title="x.name"
          @click="choose(x)" @mouseenter="hover = x" @mouseleave="hover = null"
        >
          <img :src="iconOf(x.id)" alt="" loading="lazy">
        </div>
      </div>
      <div v-else data-picker-list>
        <div v-for="x in shown" :key="x.id" class="prow" :class="markOf(x.id)" :data-pick="x.id" @click="choose(x)">
          <img :src="iconOf(x.id)" alt="" loading="lazy">
          <span class="pn">{{ x.name }}</span>
          <span class="pid">{{ x.sub ?? x.id }}</span>
          <span v-if="markOf(x.id)" class="ok">{{ TAG[markOf(x.id)] }}</span>
        </div>
      </div>
    </div>
    <div class="pf" data-picker-foot>
      <template v-if="view === 'grid'">{{ hover ? `${hover.name}（${hover.sub ?? hover.id}）` : '' }}</template>
      <template v-else>共 {{ shown.length }} 項</template>
    </div>
  </div>
</template>

<style scoped>
.picker { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; background: var(--c-bg); }
.ph { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--c-line); }
.ph b { margin-right: auto; font-size: var(--fs-md); }
.pq { padding: var(--space-3) var(--space-4); }
.q { width: 100%; padding: 4px 8px; background: var(--c-bg-deep); border: 1px solid var(--c-line); border-radius: var(--radius); color: var(--c-text); font: inherit; }
.pb { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--space-4) var(--space-3); }
.pf { min-height: 30px; padding: var(--space-2) var(--space-4); border-top: 1px solid var(--c-line); color: var(--c-text-dim); font-size: var(--fs-sm); }
.empty { padding: var(--space-6, 24px) 0; color: var(--c-text-dim); text-align: center; }
.pgrid { display: grid; grid-template-columns: repeat(auto-fill, 40px); gap: 6px; }
.pcell { position: relative; width: 40px; height: 40px; border: 2px solid transparent; border-radius: 4px; cursor: pointer; }
.pcell:hover { border-color: var(--c-accent); }
.pcell img { display: block; width: 100%; height: 100%; border-radius: 2px; }
.pcell.cur { border-color: var(--c-accent); }
.pcell.added::after { content: "✓"; position: absolute; right: -2px; bottom: -2px; padding: 0 3px; border-radius: 3px; background: var(--c-ok); color: #08200c; font-size: 10px; font-weight: 700; }
.prow { display: flex; align-items: center; gap: var(--space-3); padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: var(--fs-sm); }
.prow:hover { background: var(--c-surface-2); }
.prow img { width: 26px; height: 26px; border-radius: 3px; }
.prow .pn { flex: 1; min-width: 0; }
.prow .pid { color: var(--c-text-dim); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
.prow .ok { color: var(--c-ok); font-size: var(--fs-xs); }
.prow.cur { background: var(--c-surface-2); box-shadow: inset 2px 0 0 var(--c-accent); }
.prow.added, .pcell.added { opacity: .4; cursor: default; }
.pcell.added:hover { border-color: transparent; }
</style>
