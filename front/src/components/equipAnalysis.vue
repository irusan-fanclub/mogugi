<template>
    <v-sheet class="pa-3">
        <div class="eq-toolbar">
            <v-switch v-model="autoFetch" label="自動更新" color="primary" density="compact" hide-details />
            <v-btn size="small" variant="tonal" :disabled="autoFetch" @click="refresh">重新整理</v-btn>
            <span class="eq-hint">關閉自動更新後,換裝不會反映到這頁,按重新整理才取得目前裝備。</span>
        </div>
        <!-- Slot grid -->
        <v-alert v-if="!equipment.length" type="info" variant="tonal" density="compact" class="mb-3">
            尚未收到角色快照,換頻後會出現。
        </v-alert>
        <!-- Board: relics + 星塵 left, 3x3 main grid, 威光 + echo stones right; side cells are squares sized so each column matches the grid height -->
        <div class="eq-board">
            <div class="eq-col" :style="{ '--eq-n': leftSlots.length }">
                <equip-slot v-for="s in leftSlots" :key="s.pocket" :label="s.label" :entry="s.entry" />
            </div>
            <div class="eq-main">
                <equip-slot v-for="s in mainSlots" :key="s.area" :style="{ gridArea: s.area }"
                    :label="s.label" :entry="s.entry" :tall="s.tall" :set="s.set"
                    @select-set="v => selectSet(s.area, v)" />
            </div>
            <div class="eq-col" :style="{ '--eq-n': rightSlots.length }">
                <equip-slot v-for="s in rightSlots" :key="s.pocket" :label="s.label" :entry="s.entry" />
            </div>
        </div>

        <!-- Analysis selector: 素質 (stat panel + contributions), 音樂分析, placeholders -->
        <div class="eq-view mt-4">
            <v-select label="分析" :items="VIEWS" v-model="view" density="compact" variant="outlined" hide-details class="eq-view-select" />
        </div>

        <template v-if="view === 'stats'">
            <!-- Stat panel -->
            <div class="text-subtitle-2 mt-4 mb-1">角色數值</div>
            <v-alert v-if="!stats" type="info" variant="tonal" density="compact">尚未收到角色數值。</v-alert>
            <template v-else>
                <v-alert v-if="!stats.level" type="warning" variant="tonal" density="compact" class="mb-2">
                    基礎值未知(未收到快照),下列數值只反映啟動後的變化。
                </v-alert>
                <v-table density="compact" class="eq-panel">
                    <tbody>
                        <tr v-for="r in panelRows" :key="r.label">
                            <td class="eq-panel-label">{{ r.label }}</td>
                            <td>{{ r.value }}</td>
                        </tr>
                    </tbody>
                </v-table>
            </template>

            <!-- Per-item contributions -->
            <div class="text-subtitle-2 mt-4 mb-1">逐件貢獻</div>
            <div class="eq-hint mb-1">差額不為零是正常的:細工、遺物、威光、回音石、才能、技能與 buff 尚未計入。</div>
            <div class="eq-scroll">
                <v-table density="compact" class="eq-contrib">
                    <thead>
                        <tr>
                            <th>數值</th>
                            <th v-for="c in wornColumns" :key="c.pocket" :title="c.name">{{ c.label }}</th>
                            <th>合計</th>
                            <th>伺服器</th>
                            <th>差額</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in contribRows" :key="row.key">
                            <td class="eq-panel-label">{{ row.label }}</td>
                            <td v-for="c in wornColumns" :key="c.pocket">{{ fmt(c.contribution.stats[row.key]) }}</td>
                            <td>{{ fmt(row.sum) }}</td>
                            <td>
                                <template v-if="row.server !== null">
                                    {{ fmt(row.server) }}<span v-if="row.isTotal" class="eq-hint">(總值)</span>
                                </template>
                            </td>
                            <td :class="{ 'eq-diff': row.diff !== null && row.diff !== 0 }">{{ row.diff === null ? '' : fmt(row.diff) }}</td>
                        </tr>
                    </tbody>
                </v-table>
            </div>
            <div v-if="skippedSummary" class="eq-hint mt-1">未計入:{{ skippedSummary }}</div>
            <div v-if="unmappedSummary" class="eq-hint">未對照效果碼:{{ unmappedSummary }}</div>
        </template>
        <music-analysis v-else-if="view === 'music'" :items="equipment" :instrument-pocket="instrumentPocket" class="mt-3" />
        <v-alert v-else type="info" variant="tonal" density="compact" class="mt-3">施工中,下一版提供。</v-alert>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, inject, computed, reactive, ref, watch, type Ref, type ComputedRef } from 'vue';
import { ownerEquipment, ownerStats } from '@/store';
import type { EnchantInfo, ItemUpgrade, ManualForm, MetalwareAbility } from '@/store';
import type { MabiDB } from '@/mabidb';
import type { IndexItem, Holder } from '@/lib/itemIndex';
import { buildTip, displayName, isRelicPocket, type TooltipDeps } from '@/lib/itemTooltip';
import {
    EQUIP_SLOTS, STAT_ORDER, STAT_LABELS, contributionsOf, sumContributions, panelValue,
    type Contribution, type StatKey, type SlotEntry, type WeaponSet,
} from '@/lib/equipStats';
import EquipSlot from './subComponents/equipSlot.vue';
import MusicAnalysis from './subComponents/musicAnalysis.vue';

// Main-grid cells by CSS grid area; the two weapon areas resolve their
// pocket through the I/II toggle (I = 10/13, II = 11/14).
type WeaponArea = 'wl' | 'wr';
const WEAPON_POCKETS: Record<WeaponArea, Record<WeaponSet, number>> = {
    wl: { I: 10, II: 11 }, wr: { I: 13, II: 14 },
};
const MAIN_AREAS: { area: string; pocket?: number; tall?: boolean }[] = [
    { area: 'head', pocket: 8 }, { area: 'accl', pocket: 16 }, { area: 'accr', pocket: 17 },
    { area: 'wl', tall: true }, { area: 'body', pocket: 5, tall: true }, { area: 'wr', tall: true },
    { area: 'hand', pocket: 6 }, { area: 'foot', pocket: 7 }, { area: 'robe', pocket: 9 },
];
const LEFT_POCKETS = [32, 33, 34, 35, 54];
const RIGHT_POCKETS = [51, 62, 63, 64];

const VIEWS = [
    { title: '素質', value: 'stats' }, { title: '音樂分析(施工中)', value: 'music' },
    { title: '元素騎士(施工中)', value: 'elemental' }, { title: '幻變槍手(施工中)', value: 'gunner' },
];
const VIEW_KEY = 'mogugi.equipAnalysis.view';
const loadView = (): string => {
    try { return localStorage.getItem(VIEW_KEY) ?? 'stats'; } catch { return 'stats'; }
};
const AUTO_FETCH_KEY = 'mogugi.equipAnalysis.autoFetch';
const loadAutoFetch = (): boolean => {
    try { return localStorage.getItem(AUTO_FETCH_KEY) !== '0'; } catch { return true; }
};

export default defineComponent({
    components: { EquipSlot, MusicAnalysis },
    setup() {
        const itemNameMap = inject('itemNameMap') as Ref<Record<number, string>>;
        const enchantNameMap = inject('enchantNameMap') as Ref<Record<number, string>>;
        const enchantInfoMap = inject('enchantInfoMap') as Ref<Record<number, EnchantInfo>>;
        const metalwareMap = inject('metalwareMap') as Ref<Record<number, MetalwareAbility>>;
        const manualFormMap = inject('manualFormMap') as Ref<Record<number, ManualForm>>;
        const itemUpgradeMap = inject('itemUpgradeMap') as Ref<Record<number, ItemUpgrade>>;
        const db = inject('db') as ComputedRef<MabiDB>;
        const itemDescMap = ref<Record<number, string>>({});

        // When auto-update is off, the page freezes on the last refresh
        // instead of tracking the live owner store.
        const autoFetch = ref(loadAutoFetch());
        const frozenEquipment = ref<typeof ownerEquipment.value>([]);
        const frozenStats = ref<typeof ownerStats.value>(null);
        const refresh = () => {
            frozenEquipment.value = ownerEquipment.value.slice();
            frozenStats.value = ownerStats.value;
        };
        const equipment = computed(() => autoFetch.value ? ownerEquipment.value : frozenEquipment.value);
        const stats = computed(() => autoFetch.value ? ownerStats.value : frozenStats.value);
        watch(autoFetch, (on, wasOn) => {
            if (wasOn && !on) refresh();
            try { localStorage.setItem(AUTO_FETCH_KEY, on ? '1' : '0'); } catch { /* ignore */ }
        });

        // itemNameMap values are "name id"; strip the trailing id.
        const itemName = (id: number): string => {
            const label = itemNameMap.value[id];
            return label ? label.replace(/\s*\d+$/, '') : `Item ${id}`;
        };
        const deps = (): TooltipDeps => ({
            enchantNameMap: enchantNameMap.value,
            enchantInfoMap: enchantInfoMap.value,
            metalwareMap: metalwareMap.value,
            manualFormMap: manualFormMap.value,
            itemUpgradeMap: itemUpgradeMap.value,
            itemDescMap: itemDescMap.value,
            itemName,
        });

        // Relic pockets (32-35) carry their fixed effect text in the item's
        // description only; fetch it lazily whenever the relic set changes.
        watch(equipment, async (items) => {
            try {
                const ids = [...new Set(items.filter(e => isRelicPocket(e.pocket)).map(e => e.item.id))];
                itemDescMap.value = ids.length ? await db.value.getItemDescriptions(ids) : {};
            } catch (e) {
                console.error('equipAnalysis: relic description fetch failed', e);
            }
        }, { immediate: true });
        // buildTip/displayName take a Holder; the worn set has no entity, so
        // fill the two names with the local character marker.
        const asHolder = (it: IndexItem): Holder => ({ ...it, entity: '', master: '' });

        // Accessories (16/17) share group 'armor' with real armour slots for
        // layout, so they must be told apart by pocket, not by group.
        const ACCESSORY_POCKETS = new Set([16, 17]);

        // enchantBrief: prefix then suffix enchant names, '' when the item has none.
        const enchantBrief = (it: IndexItem): string => {
            const label = (id?: number) => id ? (enchantNameMap.value[id] ?? `${id}`) : undefined;
            return [label(it.enchantPrefix), label(it.enchantSuffix)].filter((s): s is string => !!s).join(' / ');
        };

        const brief = (it: IndexItem, pocket: number): string => {
            const slot = EQUIP_SLOTS.find(s => s.pocket === pocket);
            if (slot?.group === 'weapon') {
                return `攻擊 ${it.attackMin ?? 0}~${it.attackMax ?? 0} 平衡 ${it.balance ?? 0} 暴擊 ${it.critical ?? 0}`;
            }
            if (ACCESSORY_POCKETS.has(pocket) || slot?.group === 'other') {
                return enchantBrief(it);
            }
            if (slot?.group === 'armor') {
                return `防禦 ${it.defense ?? 0} 保護 ${it.protection ?? 0}`;
            }
            return '';
        };

        const entryByPocket = computed(() => {
            const d = deps();
            const m = new Map<number, SlotEntry>();
            for (const e of equipment.value) {
                const h = asHolder(e.item);
                m.set(e.pocket, { item: e.item, name: displayName(h, d), brief: brief(e.item, e.pocket), tip: buildTip(h, d) });
            }
            return m;
        });

        const slotLabel = (pocket: number): string => EQUIP_SLOTS.find(s => s.pocket === pocket)?.label ?? `#${pocket}`;
        const cell = (pocket: number) => ({ pocket, label: slotLabel(pocket), entry: entryByPocket.value.get(pocket) });

        // Which weapon set each weapon area shows; display only, the
        // contribution table always counts set I.
        const weaponSet = reactive<Record<WeaponArea, WeaponSet>>({ wl: 'I', wr: 'I' });
        const isWeaponArea = (area: string): area is WeaponArea => area === 'wl' || area === 'wr';
        const selectSet = (area: string, v: WeaponSet) => {
            if (isWeaponArea(area)) weaponSet[area] = v;
        };

        const view = ref(loadView());
        watch(view, v => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } });
        // The music view reads the instrument from the weapon set shown on the board.
        const instrumentPocket = computed(() => WEAPON_POCKETS.wl[weaponSet.wl]);

        const leftSlots = computed(() => LEFT_POCKETS.map(cell));
        const rightSlots = computed(() => RIGHT_POCKETS.map(cell));
        const mainSlots = computed(() => MAIN_AREAS.map(a => {
            const set = isWeaponArea(a.area) ? weaponSet[a.area] : undefined;
            const pocket = a.pocket ?? WEAPON_POCKETS[a.area as WeaponArea][set ?? 'I'];
            return { area: a.area, tall: !!a.tall, set, ...cell(pocket) };
        }));

        const n = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(2);
        const panelRows = computed(() => {
            const p = stats.value;
            if (!p) return [];
            const rows = [
                { label: '等級', value: n(p.level) },
                { label: '戰鬥力', value: n(p.combatPower) },
                { label: 'AP', value: n(p.abilityPoints) },
                { label: '生命力', value: `${n(p.life)} / ${n(p.lifeMax)}` },
                { label: '魔力', value: `${n(p.mana)} / ${n(p.manaMax)}` },
                { label: '體力', value: `${n(p.stamina)} / ${n(p.staminaMax)}` },
                { label: '力量', value: `${n(p.str)} + ${n(p.strMod)}` },
                { label: '敏捷', value: `${n(p.dex)} + ${n(p.dexMod)}` },
                { label: '智力', value: `${n(p.int)} + ${n(p.intMod)}` },
                { label: '意志', value: `${n(p.will)} + ${n(p.willMod)}` },
                { label: '幸運', value: `${n(p.luck)} + ${n(p.luckMod)}` },
                { label: p.dualWield ? '攻擊力(右手)' : '攻擊力', value: `${n(p.attackMin)} ~ ${n(p.attackMax)}` },
            ];
            if (p.dualWield) rows.push({ label: '攻擊力(左手)', value: `${n(p.offAttackMin)} ~ ${n(p.offAttackMax)}` });
            rows.push(
                { label: '負傷率', value: `${n(p.injuryMin)} ~ ${n(p.injuryMax)}` },
                { label: '暴擊率', value: n(p.critical) },
                { label: '平衡性', value: n(p.balance) },
                { label: '防禦力(裝備)', value: n(p.defenseMod) },
                { label: '保護(裝備)', value: n(p.protectionMod) },
                { label: '魔法攻擊力(裝備)', value: n(p.magicAttackMod) },
                { label: '魔法防禦力(裝備)', value: n(p.magicDefenseMod) },
                { label: '魔法保護(裝備)', value: n(p.magicProtectionMod) },
            );
            return rows;
        });

        const wornColumns = computed(() => {
            const out: { pocket: number; label: string; name: string; contribution: Contribution }[] = [];
            for (const s of EQUIP_SLOTS) {
                const e = entryByPocket.value.get(s.pocket);
                if (e) out.push({ pocket: s.pocket, label: s.label, name: e.name, contribution: contributionsOf(e.item, s.pocket) });
            }
            return out;
        });

        const contribRows = computed(() => {
            const sums = sumContributions(wornColumns.value.map(c => c.contribution));
            const p = stats.value;
            return STAT_ORDER.map((key: StatKey) => {
                const sum = sums[key] ?? 0;
                const pv = p ? panelValue(p, key) : null;
                return {
                    key, label: STAT_LABELS[key], sum,
                    server: pv ? pv.value : null,
                    isTotal: pv ? pv.isTotal : false,
                    diff: pv ? pv.value - sum : null,
                };
            });
        });

        const fmt = (v: number | undefined): string => (v == null || v === 0) ? '' : n(v);

        const skippedSummary = computed(() => {
            const t = { conditional: 0, metalware: 0, relic: 0 };
            for (const c of wornColumns.value) {
                t.conditional += c.contribution.skipped.conditional;
                t.metalware += c.contribution.skipped.metalware;
                t.relic += c.contribution.skipped.relic;
            }
            const parts: string[] = [];
            if (t.metalware) parts.push(`細工 ${t.metalware} 項`);
            if (t.relic) parts.push(`遺物效果 ${t.relic} 項`);
            if (t.conditional) parts.push(`條件效果 ${t.conditional} 項`);
            return parts.join(',');
        });
        const unmappedSummary = computed(() =>
            wornColumns.value.flatMap(c => c.contribution.unmapped.map(u => `#${u.code}:${u.value}`)).join(' '));

        return {
            autoFetch, refresh, equipment, stats, leftSlots, rightSlots, mainSlots, selectSet, panelRows,
            wornColumns, contribRows, fmt, skippedSummary, unmappedSummary,
            VIEWS, view, instrumentPocket,
        };
    },
});
</script>

<style scoped>
.eq-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
/* Row heights mirror equipSlot's min-heights (120/200); --eq-h is the grid's total height. */
.eq-board {
    --eq-gap: 6px; --eq-h: calc(120px * 2 + 200px + var(--eq-gap) * 2);
    display: flex; gap: 12px; align-items: flex-start;
}
.eq-col { display: flex; flex-direction: column; gap: var(--eq-gap); }
/* Square cells: side = (grid height - gaps) / cell count; the blank icon box is dropped to fit. */
.eq-col :deep(.eq-slot) {
    --eq-side: calc((var(--eq-h) - (var(--eq-n) - 1) * var(--eq-gap)) / var(--eq-n));
    width: var(--eq-side); height: var(--eq-side); min-height: 0;
    display: flex; flex-direction: column; overflow: hidden;
}
.eq-col :deep(.eq-icon) { display: none; }
.eq-col :deep(.eq-name) { margin-top: auto; }
.eq-col :deep(.eq-brief) { margin-bottom: auto; }
.eq-col :deep(.eq-none) { margin: auto 0; padding-top: 0; }
.eq-main {
    display: grid;
    grid-template-columns: repeat(3, 128px);
    grid-template-rows: 120px 200px 120px;
    grid-template-areas: "head accl accr" "wl body wr" "hand foot robe";
    gap: var(--eq-gap);
}
.eq-panel { max-width: 420px; }
.eq-panel-label { color: #999; white-space: nowrap; }
.eq-scroll { overflow-x: auto; }
.eq-contrib th, .eq-contrib td { white-space: nowrap; text-align: right; }
.eq-contrib th:first-child, .eq-contrib td:first-child { text-align: left; }
.eq-diff { color: #ef5350; font-weight: bold; }
.eq-hint { font-size: 0.75rem; color: #999; }
.eq-view-select { max-width: 260px; }
</style>
