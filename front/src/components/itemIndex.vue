<template>
    <div class="pa-2">
        <div class="d-flex align-center flex-wrap mb-2" style="gap: 8px">
            <v-text-field v-model="query" label="搜尋（名稱 / 賦予 / 細工 / ID）" hide-details density="compact" clearable
                style="max-width: 300px" />
            <v-autocomplete v-model="entityFilter" :items="entityOptions" label="角色" hide-details
                density="compact" clearable multiple chips closable-chips style="min-width: 200px; max-width: 320px" />
            <v-autocomplete v-model="masterFilter" :items="masterOptions" label="Owner" hide-details
                density="compact" clearable multiple chips closable-chips style="min-width: 180px; max-width: 300px" />
            <v-select v-model="containerFilter" :items="containerOptions" label="背包" hide-details
                density="compact" clearable style="min-width: 140px; max-width: 180px" />
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
            <span class="text-caption text-medium-emphasis">{{ entityCount }} 個實體 / {{ itemKindCount }} 種物品</span>
        </div>
        <v-data-table :headers="headers" :items="rows" density="compact" :items-per-page="50">
            <template #[`item.item`]="{ item }">
                <v-tooltip v-if="item.tip" location="right" content-class="item-tip-content" :open-delay="150">
                    <template #activator="{ props }">
                        <span v-bind="props" class="item-name-hover">{{ item.item }}</span>
                    </template>
                    <div class="item-tip">
                        <div class="tip-title">{{ item.item }}</div>
                        <template v-if="item.tip.props.length">
                            <div class="tip-section">道具屬性</div>
                            <div v-for="(l, i) in item.tip.props" :key="`p${i}`" class="tip-line">{{ l }}</div>
                        </template>
                        <template v-if="item.tip.enchants.length">
                            <div class="tip-section">魔力賦予</div>
                            <template v-for="(e, i) in item.tip.enchants" :key="`e${i}`">
                                <div class="tip-line">
                                    [{{ e.slot }}] {{ e.name }}<span v-if="e.rank" class="tip-rank">（等級 {{ e.rank }}）</span>
                                </div>
                                <div v-if="e.desc" class="tip-line tip-desc">{{ e.desc }}</div>
                            </template>
                            <div v-if="item.tip.rolls.length" class="tip-line tip-roll">
                                實際數值：{{ item.tip.rolls.map(v => `+${v}`).join('、') }}
                            </div>
                        </template>
                        <template v-if="item.tip.metalware.length">
                            <div class="tip-section">細緻工匠</div>
                            <template v-for="(m, i) in item.tip.metalware" :key="`m${i}`">
                                <div class="tip-line tip-mw">{{ m.name }} ({{ m.level }}/{{ m.max }}等級)</div>
                                <div v-if="m.value != null" class="tip-line tip-desc">L {{ m.value }}</div>
                            </template>
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
import { buildItemIndex, type IndexEntity, type Holder } from '@/lib/itemIndex';
import type { EnchantInfo, MetalwareAbility } from '@/store';

// 賦予等級 → 遊戲位階字母（level 1=F … 6=A, 7=9, 8=8 …15=1）。
const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', '9', '8', '7', '6', '5', '4', '3', '2', '1'];

interface TipEnchant { slot: string; name: string; rank: string | null; desc: string | null }
interface TipMetalware { name: string; level: number; max: number; value: string | null }
interface Tip { props: string[]; enchants: TipEnchant[]; rolls: number[]; metalware: TipMetalware[] }

export default defineComponent({
    setup() {
        const itemNameMap = inject('itemNameMap') as Ref<Record<number, string>>;
        const enchantNameMap = inject('enchantNameMap') as Ref<Record<number, string>>;
        const enchantInfoMap = inject('enchantInfoMap') as Ref<Record<number, EnchantInfo>>;
        const metalwareMap = inject('metalwareMap') as Ref<Record<number, MetalwareAbility>>;
        const query = ref('');
        const loading = ref(false);
        const idx = ref(new Map<number, Holder[]>());

        // 欄位過濾：角色 / Owner 可複選，背包單選；與文字搜尋 AND 疊加。
        const entityFilter = ref<string[]>([]);
        const masterFilter = ref<string[]>([]);
        const containerFilter = ref<string | null>(null);

        // itemNameMap 的值格式為「名稱 id」，這裡去掉結尾的 id 只留名稱。
        const itemName = (id: number): string => {
            const label = itemNameMap.value[id];
            if (!label) return `Item ${id}`;
            return label.replace(/\s*\d+$/, '');
        };

        // displayName: 仿遊戲命名——
        //   卷軸/魔法粉（給予賦予）：「魔力賦予卷軸 - 生命」（物品名 - 賦予名）
        //   裝備（已附加賦予）：「辛勤的 杜克獵人手套」（賦予名前置，接頭 接尾 物品名）
        const displayName = (h: Holder): string => {
            const label = (id: number) => enchantNameMap.value[id] ?? `${id}`;
            const parts: string[] = [];
            if (h.enchantPrefix) parts.push(label(h.enchantPrefix));
            if (h.enchantSuffix) parts.push(label(h.enchantSuffix));
            const base = itemName(h.id);
            if (!parts.length) return base;
            return /卷軸|魔法粉/.test(base)
                ? `${base} - ${parts.join(' - ')}`
                : `${parts.join(' ')} ${base}`;
        };

        // buildTip: 組出遊戲風格 tooltip 的三個區塊；全空回 null（不掛 tooltip）。
        const buildTip = (h: Holder): Tip | null => {
            const props: string[] = [];
            if (h.attackMax) props.push(`攻擊 ${h.attackMin ?? 0}~${h.attackMax}`);
            if (h.defense) props.push(`防禦力 ${h.defense}`);
            if (h.durabilityMax) {
                props.push(`耐久度 ${Math.floor((h.durability ?? 0) / 1000)}/${Math.floor(h.durabilityMax / 1000)}`);
            }

            const enchants: TipEnchant[] = [];
            const pushEnchant = (slot: string, id?: number) => {
                if (!id) return;
                const info = enchantInfoMap.value[id];
                enchants.push({
                    slot,
                    name: info?.name ?? `${id}`,
                    rank: info?.level ? (RANKS[info.level - 1] ?? `${info.level}`) : null,
                    desc: info?.desc ?? null,
                });
            };
            pushEnchant('接頭', h.enchantPrefix);
            pushEnchant('接尾', h.enchantSuffix);
            // 賦予效果的逐件浮動值（封包 kind-1 記錄）：依序內嵌到效果文字的
            // 範圍處，仿遊戲「暴擊率增加 1 (1~3)%」。對不上的才留獨立行。
            const rollQueue = (h.enchantRolls ?? []).map(r => r.value);
            for (const e of enchants) {
                if (!e.desc || !rollQueue.length) continue;
                e.desc = e.desc.replace(/\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?/g,
                    m => rollQueue.length ? `${rollQueue.shift()} (${m})` : m);
            }
            const rolls = rollQueue;

            // 細緻工匠：顯示值 = (init + (level-1) × per) × standard，
            // IsFloat 補兩位小數，後綴 SubDesc（"m 增加" / "% 增加"）。
            const metalware: TipMetalware[] = (h.metalware ?? []).map(m => {
                const a = metalwareMap.value[m.id];
                let text: string | null = null;
                if (a) {
                    const v = (a.init + (m.level - 1) * a.per) * (a.standard || 1);
                    text = `${a.isFloat ? v.toFixed(2) : Math.round(v)} ${a.subDesc}`;
                }
                return {
                    name: a?.name ?? `#${m.id}`,
                    level: m.level,
                    max: a?.max || 20,
                    value: text,
                };
            });

            if (!props.length && !enchants.length && !metalware.length) return null;
            return { props, enchants, rolls, metalware };
        };

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

        const allHolders = (): Holder[] => {
            const out: Holder[] = [];
            for (const holders of idx.value.values()) out.push(...holders);
            return out;
        };

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
        const containerOptions = computed(() => distinct(h => h.container));

        const rows = computed(() => {
            const q = (query.value ?? '').trim().toLowerCase();
            let holders = allHolders();
            if (q) {
                holders = /^\d+$/.test(q)
                    ? holders.filter(h => h.id === Number(q))
                    : holders.filter(h => searchText(h).includes(q));
            }
            if (entityFilter.value.length) {
                holders = holders.filter(h => entityFilter.value.includes(h.entity));
            }
            if (masterFilter.value.length) {
                holders = holders.filter(h => masterFilter.value.includes(h.master));
            }
            if (containerFilter.value) {
                holders = holders.filter(h => h.container === containerFilter.value);
            }
            return holders.map(h => ({
                item: displayName(h),
                itemId: h.id,
                entity: h.entity,
                master: h.master,
                container: h.container,
                qty: h.qty,
                pos: `(${h.x},${h.y})`,
                metalware: metalwareText(h),
                tip: buildTip(h),
            }));
        });

        // 欄位顯示開關：勾選狀態存 localStorage；細工欄預設隱藏。
        const allHeaders = [
            { title: '物品', key: 'item' },
            { title: '物品ID', key: 'itemId' },
            { title: '細工', key: 'metalware' },
            { title: '角色', key: 'entity' },
            { title: 'Owner', key: 'master' },
            { title: '背包', key: 'container' },
            { title: '數量', key: 'qty' },
            { title: '座標', key: 'pos' },
        ];
        const COLS_STORAGE_KEY = 'itemIndexCols';
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

        onMounted(reload);
        return {
            query, loading, reload, rows, headers, allHeaders, visibleCols,
            entityCount, itemKindCount,
            entityFilter, masterFilter, containerFilter,
            entityOptions, masterOptions, containerOptions,
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
}

.item-tip .tip-roll {
    color: #ffe08a;
    padding-left: 10px;
}

.item-name-hover {
    cursor: help;
    border-bottom: 1px dotted #777;
}
</style>
