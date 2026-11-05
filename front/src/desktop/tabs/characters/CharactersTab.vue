<script setup lang="ts">
import { computed, ref } from 'vue';
import { actorManager, itemNameMap, raceNameMap } from '@/store';
import { bodyText, listPcEntities, stripId } from '@/lib/entityView';
import { COLOR_KEYS, colorCode, slotName, sortByCharSlot } from '@/lib/charSlots';
import { buildStyle, encodeB64Url, noginogiUrl, prilusUrl } from '@/lib/charSimul';
import { openExternal } from '@/lib/openExternal';
import type { EntityActor, EntityItem } from '@/eventActor';
import DIconButton from '../../ui/DIconButton.vue';
import DTextField from '../../ui/DTextField.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { useToast } from '../../ui/useToast';

const ctx = useContextMenu();
const toast = useToast();

const pcs = computed(() => listPcEntities(actorManager.value.entityMap));
// Several rows can be open at once; keyed by entity id.
const open = ref(new Set<string>());

function toggle(id: string) {
    const s = new Set(open.value);
    if (!s.delete(id)) s.add(id);
    open.value = s;
}

const raceOf = (p: EntityActor) => stripId(raceNameMap.value[p.raceId], `${p.raceId}`);
const itemLabel = (it: EntityItem) => stripId(itemNameMap.value[it.ItemId], `Item ${it.ItemId}`);
const equipOf = (p: EntityActor) => sortByCharSlot(Object.values(p.equipItemMap));
// Chips: display code, plus the raw value for the title.
const query = ref('');
const needle = computed(() => query.value.trim().toLowerCase());
const filtering = computed(() => needle.value !== '');
const shown = computed(() => {
    const n = needle.value;
    if (!n) return pcs.value;
    const hit = (s: string | undefined) => (s ?? '').toLowerCase().includes(n);
    return pcs.value.filter(p =>
        hit(p.name) || hit(p.guildName) || hit(raceOf(p)) || Object.values(p.equipItemMap).some(it => hit(itemLabel(it))));
});
const chipsOf =(it: EntityItem) => {
    const rec = it as unknown as Record<string, string>;
    return COLOR_KEYS.filter(k => rec[k] !== undefined).map(k => ({ key: k, raw: rec[k], code: colorCode(rec[k]) }));
};

async function copy(text: string, done = '已複製') {
    try {
        await navigator.clipboard.writeText(text);
        toast.show(done);
    } catch {
        toast.show('複製失敗');
    }
}

function personMenu(e: MouseEvent, p: EntityActor) {
    ctx.open(e, [
        { label: '複製角色名', action: () => copy(p.name) },
        { label: '複製公會', disabled: !p.guildName, action: () => copy(p.guildName) },
        { label: '複製種族', action: () => copy(raceOf(p)) },
    ]);
}
function itemMenu(e: MouseEvent, it: EntityItem) {
    ctx.open(e, [
        { label: '複製物品名', action: () => copy(itemLabel(it)) },
        { label: '複製物品 ID', action: () => copy(String(it.ItemId)) },
    ]);
}
function simulMenu(e: MouseEvent, p: EntityActor) {
    const style = buildStyle(p);
    ctx.open(e, [
        { label: '複製模擬代碼', action: () => copy(encodeB64Url({ name: p.name, style }), '已複製模擬代碼') },
        { label: '在 Prilus 開啟', action: () => openExternal(prilusUrl(style)) },
        { label: '在 noginogi 開啟', action: () => openExternal(noginogiUrl(p.name, style)) },
    ]);
}
</script>

<template>
  <div class="chars">
    <div v-if="pcs.length" class="bar">
      <DTextField v-model="query" class="q" clearable placeholder="搜尋角色名、公會、種族或裝備" aria-label="搜尋角色" />
      <span v-if="filtering" class="count" data-count>{{ shown.length }}／{{ pcs.length }}</span>
    </div>
    <div v-if="!pcs.length" class="empty">尚無角色資料</div>
    <div v-else-if="!shown.length" class="empty">找不到符合的角色</div>
    <section v-for="p in shown" :key="p.id" class="pc" data-pc>
      <div
        class="hd"
        role="button"
        tabindex="0"
        :aria-expanded="open.has(p.id)"
        @click="toggle(p.id)"
        @keydown.enter.self="toggle(p.id)"
        @contextmenu="personMenu($event, p)"
      >
        <i class="mdi chev" :class="open.has(p.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'" />
        <span class="pname" :title="p.name" style="width: 7em; flex: none">{{ p.name }}</span>
        <DIconButton
          class="simul"
          icon="mdi-human-edit"
          title="角色模擬"
          @click.stop="simulMenu($event, p)"
        />
        <span class="meta">{{ raceOf(p) }}</span>
        <span class="meta">{{ p.guildName }}</span>
      </div>
      <div v-if="open.has(p.id)" class="bd" data-body>
        <div class="body-ratio">{{ bodyText(p.body) }}</div>
        <div
          v-for="it in equipOf(p)"
          :key="it.PocketType"
          class="eq"
          data-equip
          @contextmenu="itemMenu($event, it)"
        >
          <span class="eq-slot">{{ slotName(it.PocketType) }}</span>
          <span class="eq-name" :title="itemLabel(it)">{{ itemLabel(it) }}</span>
          <button
            v-for="c in chipsOf(it)"
            :key="c.key"
            type="button"
            class="chip"
            data-chip
            :title="c.raw"
            @click="copy(c.code, `已複製 ${c.code}`)"
          >
            <i class="sw" :style="{ background: c.code }" />{{ c.code }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.chars { height: 100%; overflow-y: auto; padding: var(--space-3); scrollbar-gutter: stable; }
.bar { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.q { flex: 1; max-width: 360px; }
.count { color: var(--c-text-dim); font-family: var(--font-num); font-size: var(--fs-sm); white-space: nowrap; }
.empty { padding: var(--space-5); color: var(--c-text-dim); }
.pc { margin-bottom: var(--space-2); border-radius: var(--radius); background: var(--c-surface); }
.hd {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--row-h);
    padding: 0 var(--space-3);
    cursor: pointer;
}
.hd:hover { background: var(--c-surface-2); }
.pname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.chev { color: var(--c-text-dim); }
.meta { color: var(--c-text-dim); font-size: var(--fs-sm); white-space: nowrap; }
.bd { padding: var(--space-3) var(--space-4) var(--space-4); border-top: 1px solid var(--c-line); }
.body-ratio { margin-bottom: var(--space-3); color: var(--c-text-dim); font-family: var(--font-num); font-size: var(--fs-sm); }
.eq { display: flex; align-items: center; gap: var(--space-3); height: 22px; font-size: var(--fs-sm); overflow: hidden; }
.eq-slot { flex: none; width: 7.5em; overflow: hidden; text-overflow: ellipsis; color: var(--c-text-dim); white-space: nowrap; }
.eq-name { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    height: 18px;
    padding: 0 var(--space-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--c-text-dim);
    font-family: var(--font-num);
    font-size: var(--fs-sm);
    cursor: pointer;
}
.chip:hover { background: var(--c-surface-2); color: var(--c-text); }
.sw { display: inline-block; width: 10px; height: 10px; border: 1px solid var(--c-line); border-radius: 2px; }
</style>
