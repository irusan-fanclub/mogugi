<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    clientOptions, distinctOptions, dungeonDisplayName, humanReadableBytes, totalSizeBytes, flattenBattles, mergeBattleCols, moveBattleCol, personalStats,
    type BattleColState, type BattleRecord, type BattleRow, type BattleSortKey,
    type ClearedFilterValue,
} from '@/lib/battleFilter';
import {
    BATTLE_COL_LABELS, PAGE_SIZE_CHOICES, createArmedConfirm, paginate, parsePageSize, pipeline,
} from '@/lib/battleRecordsView';
import { LicenseRequiredError } from '@/lib/configApi';
import { loadSetting, saveSetting } from '@/lib/settingsStorage';
import { useApiFetch } from '../../apiFetch';
import { useLicenseGuard, useSession, useTabSwitch } from '../../session';
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DSelect, { type SelectItem } from '../../ui/DSelect.vue';
import DMenu from '../../ui/DMenu.vue';
import DReorderList, { type ReorderItem } from '../../ui/DReorderList.vue';
import DTable, { type SortSpec, type TableColumn } from '../../ui/DTable.vue';
import DPaginator from '../../ui/DPaginator.vue';
import DDateTimeField from '../../ui/DDateTimeField.vue';
import DSpinner from '../../ui/DSpinner.vue';
import { useContextMenu, type MenuItem } from '../../ui/useContextMenu';
import { useToast } from '../../ui/useToast';
import RecordRow from './RecordRow.vue';
import RecordDetail from './RecordDetail.vue';

const apiFetch = useApiFetch();
const session = useSession();
const guard = useLicenseGuard();
const switchTab = useTabSwitch();
const toast = useToast();
const ctx = useContextMenu();

const battles = ref<BattleRecord[]>([]);
// Starts true so the first frame shows loading, not the empty-state text.
const loading = ref(true);
const error = ref<string | null>(null);

const codeFilter = ref('');
const bossFilter = ref('');
const playerFilter = ref('');
const clearedFilter = ref('');
const clientFromFilter = ref('');
const clientToFilter = ref('');
const fromInput = ref('');
const toInput = ref('');
const pageSizeText = ref('50');
const page = ref(1);
const sort = ref<{ key: BattleSortKey; dir: 'asc' | 'desc' }>({ key: 'startedAt', dir: 'desc' });

const CLEARED_ITEMS: SelectItem[] = [
    { value: 'cleared', title: '通關' },
    { value: 'notCleared', title: '未通關' },
    { value: 'unknown', title: '未知' },
];
const toItems = (xs: string[]): SelectItem[] => xs.map(v => ({ value: v, title: v }));
const codeItems = computed<SelectItem[]>(() => distinctOptions(battles.value, v => v.code)
    .map(code => ({ value: code, title: dungeonDisplayName(code) })));
const playerItems = computed(() => toItems(distinctOptions(battles.value, v => v.player)));
// Boss name is per-fight, so options come from the flattened rows.
const bossItems = computed(() => toItems(distinctOptions(
    flattenBattles(battles.value).filter(r => r.bossName), v => v.bossName ?? '')));
const clientItems = computed(() => toItems(clientOptions(battles.value)));
const pageSizeItems = PAGE_SIZE_CHOICES.map(v => ({ value: v, title: v }));

async function reload() {
    loading.value = true;
    error.value = null;
    try {
        const res = await apiFetch('/api/battles');
        if (!res.ok) {
            battles.value = [];
            error.value = '無法載入戰鬥紀錄，請稍後再試。';
            return;
        }
        const data = await res.json();
        battles.value = data.battles ?? [];
    } catch (e) {
        if (e instanceof LicenseRequiredError) return;
        console.error('battles fetch failed', e);
        battles.value = [];
        error.value = '無法載入戰鬥紀錄，請稍後再試。';
    } finally {
        loading.value = false;
    }
}

const rows = computed(() => pipeline(battles.value, {
    code: codeFilter.value || null,
    player: playerFilter.value || null,
    bossName: bossFilter.value || null,
    cleared: (clearedFilter.value || null) as ClearedFilterValue | null,
    from: fromInput.value || null,
    to: toInput.value || null,
    clientFrom: clientFromFilter.value || null,
    clientTo: clientToFilter.value || null,
}, sort.value));
// Same basis as the size: files that still have a visible row.
const fileCount = computed(() => new Set(rows.value.map(r => r.file)).size);
const sizeText = computed(() => humanReadableBytes(totalSizeBytes(rows.value)));

const pageSize = computed(() => parsePageSize(pageSizeText.value));
watch(pageSize, () => { page.value = 1; });
// The page model is not reset on filter changes, only clamped when slicing.
const paged = computed(() => paginate(rows.value, pageSize.value, page.value));

// Personal best/avg over the whole unfiltered history.
const stats = computed(() => personalStats(flattenBattles(battles.value)));

// --- columns ---
const isAny = (_v: unknown): _v is unknown => true;
const colState = ref<BattleColState[]>(mergeBattleCols(loadSetting<unknown>('recordsColumns', null, isAny) as BattleColState[] | null));
watch(colState, v => saveSetting('recordsColumns', v), { deep: true });
const colMenuOpen = ref(false);
const colItems = computed<ReorderItem[]>(() => colState.value.map(c => ({
    key: c.key, label: BATTLE_COL_LABELS[c.key], checked: c.visible,
})));
const onColReorder = (from: number, to: number) => { colState.value = moveBattleCol(colState.value, from, to); };
const onColToggle = (key: string | number) => {
    colState.value = colState.value.map(c => (c.key === key ? { ...c, visible: !c.visible } : c));
};

const SORTABLE = new Set<string>(['startedAt', 'duration', 'dps']);
const columns = computed<TableColumn[]>(() => [
    ...colState.value.filter(c => c.visible).map(c => ({
        key: c.key,
        title: BATTLE_COL_LABELS[c.key],
        sortable: SORTABLE.has(c.key),
        align: (['dps', 'activeDps', 'partySize'].includes(c.key) ? 'right' : 'left') as 'left' | 'right',
    })),
    { key: 'actions', title: '', width: '150px' },
]);
const sortBy = computed<SortSpec[]>(() => [{ key: sort.value.key, order: sort.value.dir }]);
function onSortBy(v: SortSpec[]) {
    const s = v[0];
    if (s) sort.value = { key: s.key as BattleSortKey, dir: s.order };
}

// --- expand / notes ---
const expanded = ref<string[]>([]);
function toggleExpand(key: string) {
    expanded.value = expanded.value.includes(key)
        ? expanded.value.filter(k => k !== key)
        : [...expanded.value, key];
}
const noteDraft = ref<Record<string, string>>({});
async function saveNote(file: string, note: string) {
    try {
        const res = await apiFetch('/api/battles/note?file=' + encodeURIComponent(file), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const rec = battles.value.find(b => b.file === file);
        if (rec) rec.note = note;
        delete noteDraft.value[file];
    } catch (e) {
        if (e instanceof LicenseRequiredError) return;
        console.error('save note failed', e);
        toast.show('筆記儲存失敗，請稍後再試。');
    }
}

// --- row actions ---
const loadingFile = ref('');
async function loadRecord(file: string) {
    loadingFile.value = file;
    try {
        await session.loadBattleRecord(file);
        switchTab('battle');
    } catch (e) {
        if (guard(e)) return;
        console.error('load record failed', e);
        toast.show('載入紀錄失敗，請稍後再試。');
    } finally {
        loadingFile.value = '';
    }
}
async function revealRecord(file: string) {
    try {
        await apiFetch('/api/battles/reveal?file=' + encodeURIComponent(file), { method: 'POST' });
    } catch (e) {
        if (!(e instanceof LicenseRequiredError)) console.error('reveal failed', e);
    }
}

// Two-step delete: the first click arms, a second within 4s deletes.
const armedKey = ref('');
const armed = createArmedConfirm(4000, k => { armedKey.value = k; });
onBeforeUnmount(() => armed.disarm());
async function deleteRecord(file: string) {
    armed.disarm();
    try {
        const res = await apiFetch('/api/battles/delete?file=' + encodeURIComponent(file), { method: 'POST' });
        if (!res.ok) throw new Error(String(res.status));
        battles.value = battles.value.filter(b => b.file !== file);
    } catch (e) {
        if (e instanceof LicenseRequiredError) return;
        console.error('delete failed', e);
        toast.show('刪除失敗，請稍後再試。');
    }
}
function onDeleteClick(file: string) {
    if (armed.isArmed(file)) void deleteRecord(file);
    else armed.arm(file);
}

async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.show('已複製');
    } catch {
        toast.show('複製失敗');
    }
}

function rowMenu(row: BattleRow, e: MouseEvent) {
    const isOpen = expanded.value.includes(row.key);
    const items: MenuItem[] = [
        { label: isOpen ? '收合隊友與筆記' : '展開隊友與筆記', icon: 'mdi-chevron-down', action: () => toggleExpand(row.key) },
        { label: '載入並切到戰鬥分頁', icon: 'mdi-chart-box', action: () => void loadRecord(row.file) },
        { label: '開啟檔案位置', icon: 'mdi-folder-open', action: () => void revealRecord(row.file) },
        armed.isArmed(row.file)
            ? { label: '確認刪除（整個檔案）', icon: 'mdi-delete-alert', danger: true, action: () => void deleteRecord(row.file) }
            : {
                label: '刪除（移到資源回收桶）', icon: 'mdi-delete-outline', danger: true,
                action: () => { armed.arm(row.file); toast.show('4 秒內再按一次刪除以確認'); },
            },
        'divider',
        { label: '複製檔名', icon: 'mdi-content-copy', action: () => void copy(row.file) },
        { label: '複製角色名', icon: 'mdi-content-copy', action: () => void copy(row.player) },
        { label: '複製 BOSS 名稱', icon: 'mdi-content-copy', disabled: !row.bossName, action: () => void copy(row.bossName ?? '') },
        { label: '複製筆記', icon: 'mdi-content-copy', disabled: !row.note, action: () => void copy(row.note ?? '') },
        'divider',
        { label: '只看這個副本', icon: 'mdi-filter', action: () => { codeFilter.value = row.code; } },
        { label: '只看這個 BOSS', icon: 'mdi-filter', disabled: !row.bossName, action: () => { bossFilter.value = row.bossName ?? ''; } },
        { label: '只看這個角色', icon: 'mdi-filter', action: () => { playerFilter.value = row.player; } },
    ];
    ctx.open(e, items);
}

onMounted(reload);
defineExpose({ reload });
</script>

<template>
  <div class="records">
    <div class="toolbar">
      <DSelect v-model="codeFilter" class="w-code" :items="codeItems" clearable placeholder="副本" aria-label="副本" />
      <DSelect v-model="bossFilter" class="w-boss" :items="bossItems" clearable placeholder="BOSS 名稱" aria-label="BOSS 名稱" />
      <DSelect v-model="playerFilter" class="w-player" :items="playerItems" clearable placeholder="角色" aria-label="角色" />
      <DSelect v-model="clearedFilter" class="w-cleared" :items="CLEARED_ITEMS" clearable placeholder="通關" aria-label="通關" />
      <DSelect v-model="pageSizeText" class="w-size" :items="pageSizeItems" allow-custom placeholder="顯示列數" aria-label="顯示列數" />
      <DDateTimeField v-model="fromInput" label="從" data-from />
      <DDateTimeField v-model="toInput" label="到" data-to />
      <label class="ver"><span>版本從</span>
        <DSelect v-model="clientFromFilter" class="w-client" :items="clientItems" clearable aria-label="版本從" />
      </label>
      <label class="ver"><span>版本到</span>
        <DSelect v-model="clientToFilter" class="w-client" :items="clientItems" clearable aria-label="版本到" />
      </label>
      <span class="grow" />
      <DIconButton icon="mdi-refresh" title="重新整理" :disabled="loading" @click="reload" />
      <DMenu v-model="colMenuOpen" :close-on-content-click="false">
        <template #activator>
          <DIconButton icon="mdi-view-column" title="顯示欄位" :active="colMenuOpen" />
        </template>
        <div class="col-menu">
          <DReorderList :items="colItems" checkable @reorder="onColReorder" @toggle="onColToggle" />
        </div>
      </DMenu>
      <div class="count" data-count>
        <div>{{ rows.length }}場戰鬥</div>
        <div>{{ fileCount }}個檔案</div>
        <div data-size>檔案大小 {{ sizeText }}</div>
      </div>
    </div>

    <div v-if="error" class="sheet" data-error>{{ error }}</div>
    <div v-else-if="loading && !battles.length" class="sheet"><DSpinner :size="16" /></div>
    <div v-else-if="!loading && battles.length === 0" class="sheet" data-empty>
      目前沒有戰鬥紀錄，只有白名單內的副本會被記錄（舊版紀錄不會列在這裡）。
    </div>
    <template v-else>
      <DTable
        :columns="columns"
        :rows="paged.rows"
        row-key="key"
        :sort-by="sortBy"
        :expanded-keys="expanded"
        @update:sort-by="onSortBy"
        @row-contextmenu="rowMenu"
      >
        <template v-for="c in columns.filter(c => c.key !== 'actions')" :key="c.key" #[`cell-${c.key}`]="{ row }">
          <RecordRow :row="row" :col="c.key" :stat="stats.get(`${row.player}|${row.bossRace}`)" />
        </template>
        <template #cell-actions="{ row }">
          <span class="actions">
            <DIconButton
              icon="mdi-chevron-down" title="隊友與筆記" data-act="expand"
              :active="expanded.includes(row.key)" @click="toggleExpand(row.key)"
            />
            <DIconButton icon="mdi-folder-open" title="開啟檔案位置" data-act="reveal" @click="revealRecord(row.file)" />
            <DIconButton
              icon="mdi-chart-box" title="載入並切到戰鬥分頁" data-act="load"
              :disabled="loadingFile === row.file" @click="loadRecord(row.file)"
            />
            <DIconButton
              v-if="armedKey !== row.file" icon="mdi-delete-outline" title="刪除（移到資源回收桶）"
              data-act="delete" @click="onDeleteClick(row.file)"
            />
            <DButton
              v-else variant="danger" size="sm" data-act="confirm-delete"
              title="再按一次確認刪除（整個檔案，含同場其他王戰）" @click="onDeleteClick(row.file)"
            >確認刪除</DButton>
          </span>
        </template>
        <template #expanded="{ row }">
          <RecordDetail
            :row="row"
            :draft="noteDraft[row.file]"
            @update:draft="noteDraft[row.file] = $event"
            @save="saveNote(row.file, $event)"
          />
        </template>
      </DTable>
      <DPaginator :page="paged.page" class="pager" :page-count="paged.pageCount" @update:page="page = $event" />
    </template>
  </div>
</template>

<style scoped>
.records { padding: var(--space-3); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.toolbar > .w-code { width: 170px; }
.toolbar > .w-boss { width: 160px; }
.toolbar > .w-player { width: 130px; }
.toolbar > .w-cleared { width: 110px; }
.toolbar > .w-size { width: 100px; }
.ver { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--fs-xs); color: var(--c-text-dim); white-space: nowrap; }
.ver > .w-client { width: 100px; }
.grow { flex: 1; }
.count { font-size: var(--fs-xs); color: var(--c-text-dim); line-height: 1.2; white-space: nowrap; }
.col-menu { min-width: 160px; padding: var(--space-1) 0; }
.sheet { padding: var(--space-5); color: var(--c-text-dim); }
.actions { display: inline-flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
.pager { margin-top: var(--space-3); }
</style>
