<template>
    <div class="pa-2">
        <div class="d-flex align-center flex-wrap mb-2" style="gap: 8px">
            <v-text-field v-model="query" label="搜尋（名稱 / 賦予 / 細工 / ID）" hide-details density="compact" clearable
                style="max-width: 300px" />
            <v-autocomplete v-model="entityFilter" :items="entityOptions" label="角色" hide-details
                density="compact" clearable multiple chips closable-chips style="min-width: 200px; max-width: 320px" />
            <v-autocomplete v-model="masterFilter" :items="masterOptions" label="Owner" hide-details
                density="compact" clearable multiple chips closable-chips style="min-width: 180px; max-width: 300px" />
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
                        <template v-if="item.tip.colors.length">
                            <div class="tip-section">道具顏色</div>
                            <div v-for="(c, i) in item.tip.colors" :key="`c${i}`" class="tip-line">
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
import { buildItemIndex, parseItemMetadata, type IndexEntity, type Holder, type IndexEnchantEffect } from '@/lib/itemIndex';
import type { EnchantInfo, ItemUpgrade, ManualForm, MetalwareAbility } from '@/store';

// 賦予等級 → 遊戲位階字母（level 1=F … 6=A, 7=9, 8=8 …15=1）。
const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', '9', '8', '7', '6', '5', '4', '3', '2', '1'];

// 效果行參數碼 → 顯示名（由 OptionList SetParamOnEquip 逐行對照驗證）。
const PARAM_NAMES: Record<number, string> = {
    1: '最大生命值', 3: '最大魔法值', 16: '最大傷害', 19: '暴擊率',
    20: '保護', 22: '平衡性', 53: '魔法攻擊力', 54: '魔法保護', 178: '人偶最大傷害',
};

interface TipEnchant { slot: string; name: string; rank: string | null; desc: string | null }
interface TipMetalware { name: string; level: number; max: number; value: string | null }
interface Tip {
    props: string[];
    imprint: string | null;
    enchants: TipEnchant[];
    rolls: number[];
    bless: string[];
    upgrades: string[];
    special: string | null;
    energy: string | null;
    metalware: TipMetalware[];
    colors: string[];
}

export default defineComponent({
    setup() {
        const itemNameMap = inject('itemNameMap') as Ref<Record<number, string>>;
        const enchantNameMap = inject('enchantNameMap') as Ref<Record<number, string>>;
        const enchantInfoMap = inject('enchantInfoMap') as Ref<Record<number, EnchantInfo>>;
        const metalwareMap = inject('metalwareMap') as Ref<Record<number, MetalwareAbility>>;
        const manualFormMap = inject('manualFormMap') as Ref<Record<number, ManualForm>>;
        const itemUpgradeMap = inject('itemUpgradeMap') as Ref<Record<number, ItemUpgrade>>;
        const query = ref('');
        const loading = ref(false);
        const idx = ref(new Map<number, Holder[]>());

        // 欄位過濾：角色 / Owner 可複選；與文字搜尋 AND 疊加。
        const entityFilter = ref<string[]>([]);
        const masterFilter = ref<string[]>([]);

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
            // 衣服樣本/設計圖：FORMID 直接對到完整名「衣服樣本 - X」。
            const formId = Number(parseItemMetadata(h.metadata).FORMID);
            if (formId) {
                const mf = manualFormMap.value[formId];
                if (mf) return mf.name;
            }
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

        // buildTip: 組出遊戲風格 tooltip 的各區塊；全空回 null（不掛 tooltip）。
        const buildTip = (h: Holder): Tip | null => {
            const meta = parseItemMetadata(h.metadata);

            const props: string[] = [];
            if (h.attackMax) props.push(`攻擊 ${h.attackMin ?? 0}~${h.attackMax}`);
            if (h.injuryMax) props.push(`負傷率 ${h.injuryMin ?? 0}~${h.injuryMax}%`);
            if (h.critical) props.push(`暴擊率 ${h.critical}%`);
            if (h.balance) props.push(`平衡性 ${h.balance}%`);
            if (h.defense) props.push(`防禦力 ${h.defense}`);
            if (h.protection) props.push(`保護 ${h.protection}`);
            if (meta.MDEF) props.push(`魔法防禦力 ${meta.MDEF}`);
            if (meta.MPROT) props.push(`魔法保護 ${meta.MPROT}`);
            if (h.durabilityMax) {
                // 衣服樣本/設計圖的「耐久」欄位其實是剩餘使用次數。
                props.push(meta.FORMID
                    ? `剩餘使用次數 ${Math.floor((h.durability ?? 0) / 1000)}`
                    : `耐久度 ${Math.floor((h.durability ?? 0) / 1000)}/${Math.floor(h.durabilityMax / 1000)}`);
            }
            if (meta.OWNER) props.push(`${meta.OWNER} 專用物品`);
            if (meta.SICID) props.push(`外型變更道具：${itemName(Number(meta.SICID))}`);

            // 裝備等級（大師）加成：IMRBT=類型（4=衣物 最大生命力、6=武器
            // 額外傷害值，皆已對照遊戲 tooltip 驗證）、IMRBV=實際 %。
            const IMRB_TYPES: Record<string, string> = { 4: '最大生命力增加', 6: '額外傷害值增加' };
            const imprint = meta.IMRBV
                ? `${IMRB_TYPES[meta.IMRBT] ?? '裝備等級加成'} ${meta.IMRBV}%`
                : null;

            const enchants: TipEnchant[] = [];
            const pushEnchant = (slot: string, id?: number) => {
                if (!id) return;
                const info = enchantInfoMap.value[id];
                enchants.push({
                    slot,
                    name: info?.name ?? `${id}`,
                    rank: info?.level ? (RANKS[info.level - 1] ?? `${info.level}`) : null,
                    // 描述含字面兩字元 "\n"（XML 逸出），轉真換行由 CSS pre-line 呈現。
                    desc: info?.desc ? info.desc.replaceAll('\\n', '\n') : null,
                });
            };
            pushEnchant('接頭', h.enchantPrefix);
            pushEnchant('接尾', h.enchantSuffix);

            // 賦予效果的逐件實際值（kind-0=接頭 / kind-1=接尾）：依槽內嵌到該槽
            // 效果文字的範圍處，仿遊戲「最大傷害 55 增加(50~55)」。剩餘的留獨立行。
            // 有範圍的效果行（如 +(50~55)）才有浮動值可嵌；固定值行（保護+3）
            // 的實際值與文字相同，不另顯示。範圍行以「值落在範圍內」配對。
            const rolls: number[] = [];
            const inline = (slot: string, effects?: IndexEnchantEffect[]) => {
                const e = enchants.find(x => x.slot === slot);
                const queue = (effects ?? []).map(r => r.value);
                if (!e?.desc || !queue.length) return;
                e.desc = e.desc.replace(/\d+(?:\.\d+)?\s*~\s*\d+(?:\.\d+)?/g, m => {
                    const [lo, hi] = m.split('~').map(Number);
                    const i = queue.findIndex(v => v >= lo && v <= hi);
                    return i >= 0 ? `${queue.splice(i, 1)[0]} (${m})` : m;
                });
            };
            inline('接頭', h.prefixEffects);
            inline('接尾', h.suffixEffects);

            // 聖水（祝福）效果。
            const bless = (h.blessEffects ?? []).map(e =>
                `${PARAM_NAMES[e.code] ?? `#${e.code}`} ${e.value > 0 ? '+' : ''}${e.value}`);

            // 改造（UPR1..n）："upgrade_id,effect_id,v1,v2,..." → 名稱＋該次數值。
            const upgrades: string[] = [];
            for (let i = 1; i <= 9; i++) {
                const raw = meta[`UPR${i}`];
                if (!raw) continue;
                const f = raw.split(',');
                const upId = Number(f[0]);
                const vals = f.slice(2).map(v => (Number(v) > 0 ? `+${v}` : v)).join(', ');
                upgrades.push(`${itemUpgradeMap.value[upId]?.name ?? `改造#${upId}`}（${vals}）`);
            }
            // 特殊改造（EHTY 1024=R / 512=S 🟡，EHLV=階段）與聚能（IMEEL/IMEEML）。
            const special = meta.EHLV
                ? `特殊改造 ${meta.EHTY === '1024' ? 'R' : meta.EHTY === '512' ? 'S' : ''} (${meta.EHLV}階段)`
                : null;
            const energy = meta.IMEEL
                ? `聚能 等級 ${meta.IMEEL}/${meta.IMEEML ?? '?'}`
                : null;

            // 道具顏色（部位 A-F）。
            const colors = h.colors ?? [];

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

            if (!props.length && !enchants.length && !metalware.length && !bless.length
                && !imprint && !upgrades.length && !special && !energy) return null;
            return { props, imprint, enchants, rolls, bless, upgrades, special, energy, metalware, colors };
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
            entityFilter, masterFilter,
            entityOptions, masterOptions,
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
