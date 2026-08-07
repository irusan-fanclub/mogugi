<template>
    <div class="pa-2">
        <div class="d-flex align-center flex-wrap mb-2" style="gap: 8px">
            <v-text-field v-model="query" label="搜尋（名稱 / 賦予 / 細工 / ID，或 /正則/）"
                :error="!!searchError" :error-messages="searchError"
                :hide-details="!searchError" density="compact" clearable
                style="max-width: 300px" />
            <v-autocomplete v-model="entityFilter" :items="entityOptions" label="角色" hide-details
                density="compact" clearable multiple chips closable-chips style="min-width: 200px; max-width: 320px" />
            <v-autocomplete v-model="masterFilter" :items="masterOptions" label="Owner" hide-details
                density="compact" clearable multiple chips closable-chips style="min-width: 180px; max-width: 300px" />
            <v-autocomplete v-model="storageFilter" :items="storageOptions" label="存放處" hide-details
                density="compact" clearable multiple chips closable-chips style="min-width: 140px; max-width: 240px" />
            <v-btn :loading="loading" @click="reload">重新整理</v-btn>
            <v-menu :close-on-content-click="false">
                <template #activator="{ props }">
                    <v-btn v-bind="props" icon="mdi-view-column" size="small" variant="text" title="顯示欄位" />
                </template>
                <v-list density="compact">
                    <v-list-item v-for="h in allHeaders" :key="h.key" class="py-0">
                        <v-checkbox v-model="visibleCols" :label="h.title" :value="h.key"
                            hide-details density="compact" />
                    </v-list-item>
                </v-list>
            </v-menu>
            <v-btn size="small" variant="text" prepend-icon="mdi-file-delimited-outline"
                @click="exportCsv">匯出 CSV</v-btn>
            <span class="text-caption text-medium-emphasis">{{ entityCount }} 個實體 / {{ itemKindCount }} 種物品</span>
        </div>
        <v-data-table :headers="headers" :items="rows" v-model:sort-by="sortBy" density="compact"
            :items-per-page="50">
            <template #[`item.item`]="{ item }">
                <v-tooltip v-if="item.tip" location="right" content-class="item-tip-content" :open-delay="150">
                    <template #activator="{ props }">
                        <span v-bind="props" class="item-name-hover">{{ item.item }}</span>
                    </template>
                    <div class="item-tip">
                        <div class="tip-title">{{ item.item }}</div>
                        <template v-if="item.tip.imprint">
                            <div class="tip-section">等級</div>
                            <div class="tip-line tip-roll">{{ item.tip.imprint }}</div>
                        </template>
                        <template v-if="item.tip.props.length">
                            <div class="tip-section">道具屬性</div>
                            <div v-for="(l, i) in item.tip.props" :key="`p${i}`" class="tip-line">{{ l }}</div>
                        </template>
                        <template v-if="item.tip.bless.length">
                            <div class="tip-section">聖水效果</div>
                            <div v-for="(l, i) in item.tip.bless" :key="`b${i}`" class="tip-line tip-mw">{{ l }}</div>
                        </template>
                        <template v-if="item.tip.relic.length || item.tip.relicDesc">
                            <div class="tip-section">遺物效果</div>
                            <div v-for="(l, i) in item.tip.relic" :key="`r${i}`" class="tip-line tip-mw">{{ l }}</div>
                            <div v-if="item.tip.relicDesc" class="tip-line tip-desc">{{ item.tip.relicDesc }}</div>
                        </template>
                        <template v-if="item.tip.enchants.length">
                            <div class="tip-section">魔力賦予</div>
                            <template v-for="(e, i) in item.tip.enchants" :key="`e${i}`">
                                <div class="tip-line">
                                    [{{ e.slot }}] {{ e.name }}<span v-if="e.rank" class="tip-rank">（等級 {{ e.rank }}）</span>
                                </div>
                                <div v-if="e.desc" class="tip-line tip-desc">{{ e.desc }}</div>
                            </template>
                        </template>
                        <template v-if="item.tip.upgrades.length || item.tip.special">
                            <div class="tip-section">改造</div>
                            <div v-for="(u, i) in item.tip.upgrades" :key="`u${i}`" class="tip-line tip-mw">{{ u }}</div>
                            <div v-if="item.tip.special" class="tip-line tip-roll">{{ item.tip.special }}</div>
                        </template>
                        <template v-if="item.tip.energy">
                            <div class="tip-section">聚能</div>
                            <div class="tip-line tip-mw">{{ item.tip.energy }}</div>
                        </template>
                        <template v-if="item.tip.metalware.length">
                            <div class="tip-section">細緻工匠</div>
                            <template v-for="(m, i) in item.tip.metalware" :key="`m${i}`">
                                <div class="tip-line tip-mw">{{ m.name }} ({{ m.level }}/{{ m.max }}等級)</div>
                                <div v-if="m.value != null" class="tip-line tip-desc">L {{ m.value }}</div>
                            </template>
                        </template>
                        <template v-for="(g, gi) in item.tip.colorGroups" :key="`g${gi}`">
                            <div class="tip-section">{{ g.label }}</div>
                            <div v-for="(c, i) in g.colors" :key="`c${gi}-${i}`" class="tip-line">
                                <span class="tip-swatch" :style="{ background: `#${c}` }" />
                                部位 {{ 'ABCDEF'[i] }}
                                <span class="tip-desc" style="padding-left:6px">#{{ c.toUpperCase() }}</span>
                            </div>
                        </template>
                    </div>
                </v-tooltip>
                <span v-else>{{ item.item }}</span>
            </template>
        </v-data-table>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, inject, onMounted, watch, type Ref } from 'vue';
import { buildItemIndex, parseSearchQuery, type IndexEntity, type Holder } from '@/lib/itemIndex';
import {
    buildTip, displayName as buildDisplayName, isRelicPocket, POCKET_NAMES,
    type TooltipDeps,
} from '@/lib/itemTooltip';
import type { EnchantInfo, ItemUpgrade, ManualForm, MetalwareAbility } from '@/store';
import { buildCsv, downloadCsv, sortRows, type SortSpec } from '@/lib/csvExport';

export default defineComponent({
    setup() {
        const itemNameMap = inject('itemNameMap') as Ref<Record<number, string>>;
        const enchantNameMap = inject('enchantNameMap') as Ref<Record<number, string>>;
        const enchantInfoMap = inject('enchantInfoMap') as Ref<Record<number, EnchantInfo>>;
        const metalwareMap = inject('metalwareMap') as Ref<Record<number, MetalwareAbility>>;
        const manualFormMap = inject('manualFormMap') as Ref<Record<number, ManualForm>>;
        const itemUpgradeMap = inject('itemUpgradeMap') as Ref<Record<number, ItemUpgrade>>;
        const db = inject('db') as import('vue').ComputedRef<import('@/mabidb').MabiDB>;
        const itemDescMap = ref<Record<number, string>>({});
        const query = ref('');
        const loading = ref(false);
        const idx = ref(new Map<number, Holder[]>());

        // 欄位過濾：角色 / Owner 可複選；與文字搜尋 AND 疊加。
        const entityFilter = ref<string[]>([]);
        const masterFilter = ref<string[]>([]);
        const storageFilter = ref<string[]>([]);
        // v-data-table 目前的排序狀態；CSV 匯出要照這個順序輸出。
        const sortBy = ref<SortSpec[]>([]);

        // itemNameMap 的值格式為「名稱 id」，這裡去掉結尾的 id 只留名稱。
        const itemName = (id: number): string => {
            const label = itemNameMap.value[id];
            if (!label) return `Item ${id}`;
            return label.replace(/\s*\d+$/, '');
        };

        // deps: 把反應式 map 的 .value 與 helper 打包成純值，餵給 itemTooltip 純函式。
        const deps = (): TooltipDeps => ({
            enchantNameMap: enchantNameMap.value,
            enchantInfoMap: enchantInfoMap.value,
            metalwareMap: metalwareMap.value,
            manualFormMap: manualFormMap.value,
            itemUpgradeMap: itemUpgradeMap.value,
            itemDescMap: itemDescMap.value,
            itemName,
        });
        const displayName = (h: Holder): string => buildDisplayName(h, deps());

        // containerText: bag column display — bag/tab name > known system space name > category > unknown space#pocket.
        const containerText = (h: Holder): string => {
            if (h.bagName) return h.bagName;
            if (h.bagItemId) return itemName(h.bagItemId);
            if (h.pocket && POCKET_NAMES[h.pocket]) return POCKET_NAMES[h.pocket];
            if (h.container === 'quest') return '任務';
            if (h.container === 'bag') return `未知空間#${h.pocket ?? '?'}`;
            return h.container;
        };

        // STORAGE_NAMES maps storage codes to display names; unknown codes show as-is.
        const STORAGE_NAMES: Record<string, string> = {
            inventory: '物品欄',
            beauty: '美容室',
            bank: '銀行',
        };
        const storageText = (h: Holder): string => STORAGE_NAMES[h.storage] ?? h.storage;

        // metalwareText: 細工欄摘要（能力名 等級，以「 / 」串接）。
        const metalwareText = (h: Holder): string => {
            return (h.metalware ?? [])
                .map(m => `${metalwareMap.value[m.id]?.name ?? `#${m.id}`} ${m.level}`)
                .join(' / ');
        };

        // searchText: 文字搜尋的比對範圍 = 顯示名稱（含賦予名）+ 細工能力名。
        const searchText = (h: Holder): string =>
            `${displayName(h)} ${metalwareText(h)}`.toLowerCase();

        const reload = async () => {
            loading.value = true;
            try {
                const data: IndexEntity[] = await (await fetch('/api/item-index')).json();
                idx.value = buildItemIndex(data);
                // 遺物欄位（32-35）的物品：撈物品說明（固定效果寫在說明裡）。
                const relicIds = new Set<number>();
                for (const e of data) for (const it of e.items)
                    if (isRelicPocket(it.pocket)) relicIds.add(it.id);
                itemDescMap.value = relicIds.size
                    ? await db.value.getItemDescriptions([...relicIds]) : {};
            } catch (e) {
                console.error('item-index fetch failed', e);
            } finally {
                loading.value = false;
            }
        };

        const entityCount = computed(() => {
            const set = new Set<string>();
            for (const holders of idx.value.values()) for (const h of holders) set.add(h.entity);
            return set.size;
        });
        const itemKindCount = computed(() => idx.value.size);

        const allHolders = computed<Holder[]>(() => {
            const out: Holder[] = [];
            for (const holders of idx.value.values()) out.push(...holders);
            return out;
        });

        // searchText walks the enchant and metalware tables, so recomputing it
        // per keystroke over ~10k holders is wasteful. Cache it and let the
        // computed rebuild only when the index or the name maps change.
        const searchTextCache = computed(() => {
            const m = new Map<Holder, string>();
            for (const h of allHolders.value) m.set(h, searchText(h));
            return m;
        });

        // 過濾選項：從目前索引取 distinct 值（排序）。
        const distinct = (pick: (h: Holder) => string): string[] => {
            const set = new Set<string>();
            for (const holders of idx.value.values()) {
                for (const h of holders) {
                    const v = pick(h);
                    if (v) set.add(v);
                }
            }
            return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        };
        const entityOptions = computed(() => distinct(h => h.entity));
        const masterOptions = computed(() => distinct(h => h.master));
        // Options use the same display strings the table cells show, so the
        // dropdown never disagrees with the 存放處 column.
        const storageOptions = computed(() => distinct(h => storageText(h)));

        const searchQuery = computed(() => parseSearchQuery(query.value ?? ''));
        const searchError = computed(() =>
            searchQuery.value.kind === 'error' ? searchQuery.value.message : '');

        const rows = computed(() => {
            const sq = searchQuery.value;
            if (sq.kind === 'error') return [];
            let holders = allHolders.value;
            const cache = searchTextCache.value;
            if (sq.kind === 'id') {
                holders = holders.filter(h => h.id === sq.id);
            } else if (sq.kind === 'text') {
                holders = holders.filter(h => (cache.get(h) ?? '').includes(sq.needle));
            } else if (sq.kind === 'regex') {
                holders = holders.filter(h => sq.re.test(cache.get(h) ?? ''));
            }
            if (entityFilter.value.length) {
                holders = holders.filter(h => entityFilter.value.includes(h.entity));
            }
            if (masterFilter.value.length) {
                holders = holders.filter(h => masterFilter.value.includes(h.master));
            }
            if (storageFilter.value.length) {
                holders = holders.filter(h => storageFilter.value.includes(storageText(h)));
            }
            return holders.map(h => ({
                item: displayName(h),
                itemId: h.id,
                entity: h.entity,
                master: h.master,
                storage: storageText(h),
                container: containerText(h),
                qty: h.qty,
                pos: `(${h.x},${h.y})`,
                metalware: metalwareText(h),
                tip: buildTip(h, deps()),
            }));
        });

        type IndexRow = (typeof rows.value)[number];
        // cellText: every row field above is already the display-ready value
        // the table cell shows (formatters are applied in `rows`), so CSV
        // export just needs to stringify it.
        const cellText = (row: IndexRow, key: string): string => {
            const v = (row as unknown as Record<string, unknown>)[key];
            return v == null ? '' : String(v);
        };

        // 欄位顯示開關：勾選狀態存 localStorage；細工欄預設隱藏。
        const allHeaders = [
            { title: '物品', key: 'item' },
            { title: '物品ID', key: 'itemId' },
            { title: '細工', key: 'metalware' },
            { title: '角色', key: 'entity' },
            { title: 'Owner', key: 'master' },
            { title: '存放處', key: 'storage' },
            { title: '背包', key: 'container' },
            { title: '數量', key: 'qty' },
            { title: '座標', key: 'pos' },
        ];
        const COLS_STORAGE_KEY = 'itemIndexCols.v2';
        const defaultCols = allHeaders.map(h => h.key).filter(k => k !== 'metalware');
        const loadCols = (): string[] => {
            try {
                const raw = localStorage.getItem(COLS_STORAGE_KEY);
                if (raw) {
                    const saved = JSON.parse(raw) as string[];
                    // 只保留仍存在的欄位 key；全部失效就回預設。
                    const valid = saved.filter(k => allHeaders.some(h => h.key === k));
                    if (valid.length) return valid;
                }
            } catch { /* ignore */ }
            return [...defaultCols];
        };
        const visibleCols = ref<string[]>(loadCols());
        watch(visibleCols, v => localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(v)), { deep: true });
        const headers = computed(() => allHeaders.filter(h => visibleCols.value.includes(h.key)));

        // exportCsv: dump exactly what's on screen — visible columns x filtered rows.
        const exportCsv = () => {
            const cols = headers.value;
            const header = cols.map(h => h.title);
            const sorted = sortRows(rows.value, sortBy.value);
            const body = sorted.map(r => cols.map(h => cellText(r, h.key)));
            const csv = buildCsv(header, body);
            const now = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
                + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            downloadCsv(`物品索引_${ts}.csv`, csv);
        };

        onMounted(reload);
        return {
            query, loading, reload, rows, headers, allHeaders, visibleCols,
            entityCount, itemKindCount,
            entityFilter, masterFilter, storageFilter,
            entityOptions, masterOptions, storageOptions,
            sortBy, exportCsv, searchError,
        };
    },
});
</script>

<style>
/* 遊戲風 tooltip：深色面板 + 橘色區塊標頭。 */
.item-tip-content {
    background: rgba(12, 12, 14, 0.96) !important;
    border: 1px solid #555;
    padding: 0 !important;
    max-width: 380px;
}

.item-tip {
    padding: 8px 12px;
    font-size: 0.85rem;
    color: #ddd;
}

.item-tip .tip-title {
    text-align: center;
    color: #fff;
    font-weight: bold;
    margin-bottom: 6px;
}

.item-tip .tip-section {
    display: inline-block;
    background: #7a4a00;
    color: #ffd27f;
    font-weight: bold;
    padding: 0 8px;
    border-radius: 2px;
    margin: 6px 0 3px;
}

.item-tip .tip-line {
    line-height: 1.5;
}

.item-tip .tip-rank {
    color: #8fd0ff;
}

.item-tip .tip-mw {
    color: #8fd0ff;
}

.item-tip .tip-desc {
    color: #aaa;
    padding-left: 10px;
    white-space: pre-line;
}

.item-tip .tip-roll {
    color: #ffe08a;
    padding-left: 10px;
}

.item-name-hover {
    cursor: help;
    border-bottom: 1px dotted #777;
}

.item-tip .tip-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1px solid #666;
    margin-right: 4px;
}
</style>
