<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
    buildItemIndex, type ExcludeColumn, type ExcludeEntry, type Holder, type IndexEntity,
} from '@/lib/itemIndex';
import { isRelicPocket } from '@/lib/itemTooltip';
import {
    ITEM_COLUMNS, buildRows, buildSearchCache, cellText, csvFileName, distinct, parseVisibleCols, searchError,
    storageText, type ItemRow,
} from '@/lib/itemIndexView';
import { PAGE_SIZE_CHOICES, paginate, parsePageSize } from '@/lib/battleRecordsView';
import { buildCsv, downloadCsv, sortRows } from '@/lib/csvExport';
import { LicenseRequiredError } from '@/lib/configApi';
import { saveSetting, settingsStorage } from '@/lib/settingsStorage';
import { makeTooltipDeps } from '@/lib/tooltipDeps';
import {
    db, enchantInfoMap, enchantNameMap, itemNameMap, itemUpgradeMap, manualFormMap, metalwareMap,
} from '@/store';
import { useApiFetch } from '../../apiFetch';
import DAlert from '../../ui/DAlert.vue';
import DButton from '../../ui/DButton.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DMenu from '../../ui/DMenu.vue';
import DMultiSelect, { type MultiItem } from '../../ui/DMultiSelect.vue';
import DPaginator from '../../ui/DPaginator.vue';
import DSelect from '../../ui/DSelect.vue';
import DSpinner from '../../ui/DSpinner.vue';
import DTable, { type SortSpec, type TableColumn } from '../../ui/DTable.vue';
import DTextField from '../../ui/DTextField.vue';
import DTooltip from '../../ui/DTooltip.vue';
import ItemTip from '../../ui/ItemTip.vue';
import { useContextMenu, type MenuItem } from '../../ui/useContextMenu';
import { useToast } from '../../ui/useToast';

const apiFetch = useApiFetch();
const ctx = useContextMenu();
const toast = useToast();

const holders = ref<Holder[]>([]);
const itemDescMap = ref<Record<number, string>>({});
// Starts true so the first frame shows loading, not the empty-state text.
const loading = ref(true);
const error = ref<string | null>(null);

const query = ref('');
const entityFilter = ref<(string | number)[]>([]);
const masterFilter = ref<(string | number)[]>([]);
const storageFilter = ref<(string | number)[]>([]);
const sortBy = ref<SortSpec[]>([]);
const pageSizeText = ref('50');
const page = ref(1);

const deps = computed(() => makeTooltipDeps({
    itemNameMap: itemNameMap.value,
    enchantNameMap: enchantNameMap.value,
    enchantInfoMap: enchantInfoMap.value,
    metalwareMap: metalwareMap.value,
    manualFormMap: manualFormMap.value,
    itemUpgradeMap: itemUpgradeMap.value,
    itemDescMap: itemDescMap.value,
}));

async function reload() {
    loading.value = true;
    error.value = null;
    try {
        const res = await apiFetch('/api/item-index');
        if (!res.ok) throw new Error(String(res.status));
        const data: IndexEntity[] = await res.json();
        const next: Holder[] = [];
        for (const hs of buildItemIndex(data).values()) next.push(...hs);
        // Relic slots (32-35) keep their fixed effect in the item description.
        const relicIds = new Set<number>();
        for (const e of data) for (const it of e.items) if (isRelicPocket(it.pocket)) relicIds.add(it.id);
        try {
            itemDescMap.value = relicIds.size ? await db.value.getItemDescriptions([...relicIds]) : {};
        } catch (e) {
            console.warn('relic descriptions unavailable', e);
            itemDescMap.value = {};
        }
        holders.value = next;
    } catch (e) {
        if (e instanceof LicenseRequiredError) return;
        console.error('item-index fetch failed', e);
        error.value = '無法載入物品索引，請稍後再試。';
    } finally {
        loading.value = false;
    }
}

const entityCount = computed(() => new Set(holders.value.map(h => h.entity)).size);
const itemKindCount = computed(() => new Set(holders.value.map(h => h.id)).size);

// Search text walks enchant/metalware tables; cache it so keystrokes stay cheap.
const searchCache = computed(() => buildSearchCache(holders.value, deps.value));
const toItems = (xs: string[]): MultiItem[] => xs.map(v => ({ value: v, title: v }));
const entityItems = computed(() => toItems(distinct(holders.value, h => h.entity)));
const masterItems = computed(() => toItems(distinct(holders.value, h => h.master)));
const storageItems = computed(() => toItems(distinct(holders.value, h => storageText(h))));
const pageSizeItems = PAGE_SIZE_CHOICES.map(v => ({ value: v, title: v }));
const queryError = computed(() => searchError(query.value));

// --- excludes, for this session ---
const excludes = ref<ExcludeEntry[]>([]);
function addExclude(col: ExcludeColumn, value: string) {
    if (!value || excludes.value.some(e => e.col === col && e.value === value)) return;
    excludes.value = [...excludes.value, { col, value }];
}
const removeExclude = (i: number) => { excludes.value = excludes.value.filter((_, j) => j !== i); };

// --- columns ---
const visibleCols = ref<string[]>(parseVisibleCols(settingsStorage.getItem('itemsColumns')));
watch(visibleCols, v => saveSetting('itemsColumns', v), { deep: true });
const colMenuOpen = ref(false);
const toggleCol = (key: string, on: boolean) => {
    visibleCols.value = on ? [...visibleCols.value, key] : visibleCols.value.filter(k => k !== key);
};
const RIGHT = new Set(['itemId', 'qty', 'pocket']);
const columns = computed<TableColumn[]>(() => ITEM_COLUMNS
    .filter(c => visibleCols.value.includes(c.key))
    .map(c => ({ ...c, sortable: true, align: RIGHT.has(c.key) ? 'right' : 'left' })));

// --- rows ---
const filtered = computed(() => buildRows(holders.value, {
    query: query.value,
    entity: entityFilter.value.map(String),
    master: masterFilter.value.map(String),
    storage: storageFilter.value.map(String),
    excludes: excludes.value,
    deps: deps.value,
    searchCache: searchCache.value,
}));
// The same sorted list feeds the table and the CSV export.
const sorted = computed(() => sortRows(filtered.value, sortBy.value));
const pageSize = computed(() => parsePageSize(pageSizeText.value));
const paged = computed(() => paginate(sorted.value, pageSize.value, page.value));
watch([pageSize, query, entityFilter, masterFilter, storageFilter, excludes, sortBy], () => { page.value = 1; }, { deep: true });
const rangeText = computed(() => {
    const n = sorted.value.length;
    if (!n) return '0 筆';
    if (!pageSize.value) return `共 ${n} 筆`;
    const from = (paged.value.page - 1) * pageSize.value + 1;
    return `${from}–${Math.min(n, from + pageSize.value - 1)} / ${n} 筆`;
});

function exportCsv() {
    const cols = columns.value;
    const body = sorted.value.map(r => cols.map(c => cellText(r, c.key)));
    downloadCsv(csvFileName(new Date()), buildCsv(cols.map(c => c.title), body));
}

// --- context menu ---
async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.show('已複製');
    } catch {
        toast.show('複製失敗');
    }
}
const only = (target: { value: (string | number)[] }, v: string) => {
    if (!target.value.includes(v)) target.value = [...target.value, v];
};
function rowMenu(row: ItemRow, e: MouseEvent) {
    const tsv = () => columns.value.map(c => cellText(row, c.key)).join('\t');
    const items: MenuItem[] = [
        { label: '複製物品名', icon: 'mdi-content-copy', action: () => void copy(row.item) },
        { label: '複製物品 ID', icon: 'mdi-content-copy', action: () => void copy(String(row.itemId)) },
        { label: '複製角色名', icon: 'mdi-content-copy', action: () => void copy(row.entity) },
        { label: '複製 Owner', icon: 'mdi-content-copy', disabled: !row.master, action: () => void copy(row.master) },
        { label: '複製此列', icon: 'mdi-content-copy', action: () => void copy(tsv()) },
        'divider',
        { label: '加入排除：此物品', icon: 'mdi-minus-circle-outline', action: () => addExclude('item', row.item) },
        { label: '加入排除：此角色', icon: 'mdi-minus-circle-outline', action: () => addExclude('entity', row.entity) },
        { label: '加入排除：此存放處', icon: 'mdi-minus-circle-outline', action: () => addExclude('storage', row.storage) },
        'divider',
        { label: '只看此角色', icon: 'mdi-filter', action: () => only(entityFilter, row.entity) },
        { label: '只看此 Owner', icon: 'mdi-filter', disabled: !row.master, action: () => only(masterFilter, row.master) },
        { label: '只看此存放處', icon: 'mdi-filter', action: () => only(storageFilter, row.storage) },
        { label: '以此 ID 搜尋', icon: 'mdi-magnify', action: () => { query.value = String(row.itemId); } },
    ];
    ctx.open(e, items);
}
function chipMenu(e: MouseEvent, i: number) {
    ctx.open(e, [{ label: '移除排除', icon: 'mdi-close', action: () => removeExclude(i) }]);
}

onMounted(reload);
defineExpose({ reload });
</script>

<template>
  <div class="items">
    <div class="toolbar">
      <DTextField
        v-model="query"
        class="w-query"
        clearable
        maxlength="300"
        placeholder="搜尋（名稱 / 賦予 / 細工 / ID，或 /正則/）"
        aria-label="搜尋"
        :error="queryError"
      />
      <DMultiSelect v-model="entityFilter" class="w-entity" :items="entityItems" clearable placeholder="角色" aria-label="角色" />
      <DMultiSelect v-model="masterFilter" class="w-master" :items="masterItems" clearable placeholder="Owner" aria-label="Owner" />
      <DMultiSelect v-model="storageFilter" class="w-storage" :items="storageItems" clearable placeholder="存放處" aria-label="存放處" />
      <DButton :loading="loading" data-reload @click="reload">重新整理</DButton>
      <DMenu v-model="colMenuOpen" :close-on-content-click="false">
        <template #activator>
          <DIconButton icon="mdi-view-column" title="顯示欄位" :active="colMenuOpen" />
        </template>
        <div class="col-menu">
          <DCheckbox
            v-for="c in ITEM_COLUMNS"
            :key="c.key"
            :label="c.title"
            :model-value="visibleCols.includes(c.key)"
            data-col-opt
            @update:model-value="toggleCol(c.key, $event)"
          />
        </div>
      </DMenu>
      <DButton data-export @click="exportCsv">匯出 CSV</DButton>
      <span class="count" data-count>{{ entityCount }} 個實體 / {{ itemKindCount }} 種物品</span>
    </div>

    <div v-if="excludes.length" class="excludes" data-excludes>
      <span class="dim">排除：</span>
      <span
        v-for="(e, i) in excludes"
        :key="`${e.col}:${e.value}`"
        class="chip"
        data-exclude-chip
        @contextmenu="chipMenu($event, i)"
      >
        <i class="mdi mdi-minus-circle-outline" />
        <span class="ctext">{{ e.value }}</span>
        <button type="button" class="x" data-exclude-remove aria-label="移除排除" @click="removeExclude(i)">
          <i class="mdi mdi-close" />
        </button>
      </span>
      <DButton size="sm" data-exclude-clear @click="excludes = []">全部清除</DButton>
    </div>

    <DAlert v-if="error" kind="error" data-error>{{ error }}</DAlert>
    <div v-else-if="loading && !holders.length" class="sheet"><DSpinner :size="16" /></div>
    <div v-else-if="!holders.length" class="sheet" data-empty>目前沒有物品資料。</div>
    <template v-else>
      <DTable
        multi-sort
        :columns="columns"
        :rows="paged.rows"
        row-key="rid"
        :sort-by="sortBy"
        @update:sort-by="sortBy = $event"
        @row-contextmenu="rowMenu"
      >
        <template #cell-item="{ row }">
          <span class="cell">
            <DTooltip v-if="row.tip" bare placement="right" :delay="150">
              <span class="name" data-tip-name>{{ row.item }}</span>
              <template #content><ItemTip :tip="row.tip" :title="row.item" /></template>
            </DTooltip>
            <span v-else>{{ row.item }}</span>
            <button type="button" class="ex" data-ex="item" title="加入排除清單" @click.stop="addExclude('item', row.item)">
              <i class="mdi mdi-minus-circle-outline" />
            </button>
          </span>
        </template>
        <template #cell-entity="{ row }">
          <span class="cell">
            {{ row.entity }}
            <button type="button" class="ex" data-ex="entity" title="加入排除清單" @click.stop="addExclude('entity', row.entity)">
              <i class="mdi mdi-minus-circle-outline" />
            </button>
          </span>
        </template>
        <template #cell-storage="{ row }">
          <span class="cell">
            {{ row.storage }}
            <button type="button" class="ex" data-ex="storage" title="加入排除清單" @click.stop="addExclude('storage', row.storage)">
              <i class="mdi mdi-minus-circle-outline" />
            </button>
          </span>
        </template>
      </DTable>
      <div class="foot">
        <span class="dim" data-range>{{ rangeText }}</span>
        <DPaginator :page="paged.page" class="pager" :page-count="paged.pageCount" @update:page="page = $event" />
        <DSelect v-model="pageSizeText" class="w-size" :items="pageSizeItems" allow-custom placeholder="每頁筆數" aria-label="每頁筆數" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.items { padding: var(--space-3); }
.toolbar { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-3); margin-bottom: var(--space-3); }
.toolbar > .w-query { width: 280px; }
.toolbar > .w-entity { width: 200px; }
.toolbar > .w-master { width: 180px; }
.toolbar > .w-storage { width: 150px; }
.count { align-self: center; font-size: var(--fs-sm); color: var(--c-text-dim); white-space: nowrap; }
.dim { color: var(--c-text-dim); font-size: var(--fs-sm); }
.col-menu { display: flex; flex-direction: column; min-width: 140px; padding: var(--space-2) var(--space-3); gap: var(--space-2); }
.excludes { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 240px;
    padding: 0 var(--space-3);
    border-radius: var(--radius);
    background: var(--c-surface-2);
    font-size: var(--fs-sm);
}
.ctext { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { display: inline-flex; padding: 0; border: 0; background: transparent; color: var(--c-text-dim); cursor: pointer; }
.x:hover { color: var(--c-text); }
.sheet { padding: var(--space-5); color: var(--c-text-dim); }
.cell { display: inline-flex; align-items: center; gap: var(--space-2); }
.name { border-bottom: 1px dotted var(--c-text-dim); cursor: help; }
.ex {
    display: inline-flex;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-text-dim);
    font-size: var(--fs-sm);
    opacity: 0;
    cursor: pointer;
    transition: opacity 0.12s;
}
.cell:hover .ex { opacity: 0.6; }
.ex:hover, .ex:focus-visible { opacity: 1; color: var(--c-err); }
.foot { display: flex; align-items: center; gap: var(--space-4); margin-top: var(--space-3); }
.foot .pager { flex: 1; }
.foot .w-size { width: 100px; }
</style>
