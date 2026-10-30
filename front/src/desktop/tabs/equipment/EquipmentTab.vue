<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    db, enchantInfoMap, enchantNameMap, itemNameMap, itemUpgradeMap, manualFormMap, metalwareMap,
    ownerCharacterName, ownerEquipment, ownerProfile, ownerStats,
} from '@/store';
import { isRelicPocket } from '@/lib/itemTooltip';
import { loadSetting, saveSetting } from '@/lib/settingsStorage';
import { makeTooltipDeps } from '@/lib/tooltipDeps';
import { WEAPON_POCKETS, buildBoard, entryByPocket, tipText, type BoardCell } from '@/lib/equipBoard';
import {
    baseUnknown, contribRows as buildContribRows, fmt, panelRows as buildPanelRows,
    skippedSummary as buildSkipped, unmappedSummary as buildUnmapped, wornColumns as buildWornColumns,
} from '@/lib/equipPanel';
import DAlert from '../../ui/DAlert.vue';
import DButton from '../../ui/DButton.vue';
import DSelect from '../../ui/DSelect.vue';
import DSwitch from '../../ui/DSwitch.vue';
import { useContextMenu, type MenuItem } from '../../ui/useContextMenu';
import { useToast } from '../../ui/useToast';
import CharacterInfo from './CharacterInfo.vue';
import EquipSlot from './EquipSlot.vue';
import MusicAnalysisView from './MusicAnalysisView.vue';
import { zhPunct } from '../../text/zhPunct';

const ctx = useContextMenu();
const toast = useToast();

const VIEWS = [
    { value: 'stats', title: '素質' }, { value: 'music', title: '音樂分析（施工中）' },
    { value: 'elemental', title: '元素騎士（施工中）' }, { value: 'gunner', title: '幻變槍手（施工中）' },
];
// With auto-update off the page freezes on the last refresh.
const autoFetch = ref(loadSetting('equipmentAutoFetch', true, (v): v is boolean => typeof v === 'boolean'));
const frozenEquipment = ref<typeof ownerEquipment.value>([]);
const frozenStats = ref<typeof ownerStats.value>(null);
const frozenProfile = ref<typeof ownerProfile.value>(null);
const frozenName = ref('');
function refresh() {
    frozenEquipment.value = ownerEquipment.value.slice();
    frozenStats.value = ownerStats.value;
    frozenProfile.value = ownerProfile.value;
    frozenName.value = ownerCharacterName.value;
}
const equipment = computed(() => autoFetch.value ? ownerEquipment.value : frozenEquipment.value);
const stats = computed(() => autoFetch.value ? ownerStats.value : frozenStats.value);
const profile = computed(() => autoFetch.value ? ownerProfile.value : frozenProfile.value);
const charName = computed(() => autoFetch.value ? ownerCharacterName.value : frozenName.value);
watch(autoFetch, (on, wasOn) => {
    if (wasOn && !on) refresh();
    saveSetting('equipmentAutoFetch', on);
});

// Relic pockets (32-35) keep their effect text in the item description only.
const itemDescMap = ref<Record<number, string>>({});
watch(equipment, async items => {
    try {
        const ids = [...new Set(items.filter(e => isRelicPocket(e.pocket)).map(e => e.item.id))];
        itemDescMap.value = ids.length ? await db.value.getItemDescriptions(ids) : {};
    } catch (e) {
        console.warn('equipment: relic description fetch failed', e);
    }
}, { immediate: true });

const deps = computed(() => makeTooltipDeps({
    itemNameMap: itemNameMap.value,
    enchantNameMap: enchantNameMap.value,
    enchantInfoMap: enchantInfoMap.value,
    metalwareMap: metalwareMap.value,
    manualFormMap: manualFormMap.value,
    itemUpgradeMap: itemUpgradeMap.value,
    itemDescMap: itemDescMap.value,
}));
const entries = computed(() => entryByPocket(equipment.value, deps.value));

// Display only and not remembered; the contribution table always counts set I.
const weaponSet = ref<{ wl: 0 | 1; wr: 0 | 1 }>({ wl: 0, wr: 0 });
const board = computed(() => buildBoard(equipment.value, weaponSet.value, deps.value, entries.value));
const left = computed(() => board.value.filter(c => c.region === 'left'));
const right = computed(() => board.value.filter(c => c.region === 'right'));
const main = computed(() => board.value.filter(c => c.region === 'main'));
// The music view reads the instrument from the left weapon set shown on the board.
const instrumentPocket = computed(() => WEAPON_POCKETS.wl[weaponSet.value.wl]);

function selectSet(c: BoardCell, v: 0 | 1) {
    if (c.weapon) weaponSet.value = { ...weaponSet.value, [c.weapon]: v };
}

const view = ref('stats');

const panelRows = computed(() => stats.value ? buildPanelRows(stats.value) : []);
const wornColumns = computed(() => buildWornColumns(entries.value));
const contribRows = computed(() => buildContribRows(wornColumns.value, stats.value));
const skipped = computed(() => zhPunct(buildSkipped(wornColumns.value)));
const unmapped = computed(() => buildUnmapped(wornColumns.value));

async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.show('已複製');
    } catch {
        toast.show('複製失敗');
    }
}

function slotMenu(e: MouseEvent, c: BoardCell) {
    const en = c.entry;
    const items: MenuItem[] = [
        { label: '複製物品名', disabled: !en, action: () => copy(en!.name) },
        { label: '複製物品 ID', disabled: !en, action: () => copy(String(en!.item.id)) },
        { label: '複製提示文字', disabled: !en, action: () => copy(tipText(en!.name, en!.tip)) },
    ];
    if (c.weapon) {
        items.push({ label: '切換 I／II', disabled: false, action: () => selectSet(c, c.set ? 0 : 1) });
    }
    ctx.open(e, items);
}
function rowMenu(e: MouseEvent, label: string, value: string) {
    ctx.open(e, [{ label: '複製數值', action: () => copy(`${label} ${value}`) }]);
}
function headMenu(e: MouseEvent, name: string) {
    ctx.open(e, [{ label: '複製物品名', action: () => copy(name) }]);
}
</script>

<template>
  <div class="eq">
    <div class="toolbar">
      <DSwitch v-model="autoFetch" label="自動更新" />
      <DButton size="sm" data-refresh :disabled="autoFetch" @click="refresh">重新整理</DButton>
      <span class="hint">關閉自動更新後，換裝不會反映到這頁，按重新整理才取得目前裝備。</span>
    </div>

    <DAlert v-if="!equipment.length" kind="info" class="mb">尚未收到角色快照，換頻後會出現。</DAlert>

    <div class="board">
      <div class="col" :style="{ '--eq-n': left.length }">
        <EquipSlot v-for="c in left" :key="c.pocket" :cell="c" side @contextmenu="slotMenu($event, c)" />
      </div>
      <div class="main">
        <EquipSlot
          v-for="c in main"
          :key="c.area"
          :cell="c"
          :style="{ gridArea: c.area }"
          @select-set="selectSet(c, $event)"
          @contextmenu="slotMenu($event, c)"
        />
      </div>
      <div class="col" :style="{ '--eq-n': right.length }">
        <EquipSlot v-for="c in right" :key="c.pocket" :cell="c" side @contextmenu="slotMenu($event, c)" />
      </div>
      <CharacterInfo :name="charName" :panel="stats" :profile="profile" />
    </div>

    <label class="view">
      <span class="view-lab">分析</span>
      <DSelect v-model="view" :items="VIEWS" data-view />
    </label>

    <template v-if="view === 'stats'">
      <div class="sub">角色數值</div>
      <DAlert v-if="!stats" kind="info">尚未收到角色數值。</DAlert>
      <template v-else>
        <DAlert v-if="baseUnknown(stats)" kind="warn" class="mb">
          基礎值未知（未收到快照），下列數值只反映啟動後的變化。
        </DAlert>
        <table class="panel" data-panel>
          <tbody>
            <tr v-for="r in panelRows" :key="r.label" data-prow @contextmenu="rowMenu($event, zhPunct(r.label), r.value)">
              <td class="lab">{{ zhPunct(r.label) }}</td>
              <td>{{ r.value }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <div class="sub">逐件貢獻</div>
      <div class="hint mb">差額不為零是正常的：細工、遺物、威光、回音石、才能、技能與 buff 尚未計入。</div>
      <div class="scroll">
        <table class="contrib" data-contrib>
          <thead>
            <tr>
              <th>數值</th>
              <th v-for="c in wornColumns" :key="c.pocket" :title="c.name" @contextmenu="headMenu($event, c.name)">{{ c.label }}</th>
              <th>合計</th>
              <th>伺服器</th>
              <th>差額</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in contribRows" :key="row.key" data-crow>
              <td class="lab">{{ row.label }}</td>
              <td v-for="c in wornColumns" :key="c.pocket">{{ fmt(c.contribution.stats[row.key]) }}</td>
              <td>{{ fmt(row.sum) }}</td>
              <td>
                <template v-if="row.server !== null">
                  {{ fmt(row.server) }}<span v-if="row.isTotal" class="hint">（總值）</span>
                </template>
              </td>
              <td data-diff :class="{ diff: row.diff !== null && row.diff !== 0 }">{{ row.diff === null ? '' : fmt(row.diff) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="skipped" class="hint foot" data-skipped>未計入：{{ skipped }}</div>
      <div v-if="unmapped" class="hint" data-unmapped>未對照效果碼：{{ unmapped }}</div>
    </template>
    <MusicAnalysisView v-else-if="view === 'music'" :items="equipment" :instrument-pocket="instrumentPocket" />
    <DAlert v-else kind="info" class="mt">施工中，下一版提供。</DAlert>
  </div>
</template>

<style scoped>
.eq { height: 100%; overflow-y: auto; padding: var(--space-4); box-sizing: border-box; scrollbar-gutter: stable; }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-3); }
.hint { font-size: var(--fs-sm); color: var(--c-text-dim); }
.mb { margin-bottom: var(--space-3); }
.mt { margin-top: var(--space-3); }
.foot { margin-top: var(--space-2); }
/* --eq-h is the main grid's total height: rows 120 + 200 + 120 plus two gaps. */
/* Wraps: a narrow window drops the info column under the board. */
.board { --eq-gap: 6px; --eq-h: calc(120px * 2 + 200px + var(--eq-gap) * 2); display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
.col { display: flex; flex-direction: column; gap: var(--eq-gap); }
.col > :deep(.slot) { --eq-side: calc((var(--eq-h) - (var(--eq-n) - 1) * var(--eq-gap)) / var(--eq-n)); }
.main {
    display: grid;
    grid-template-columns: repeat(3, 128px);
    grid-template-rows: 120px 200px 120px;
    grid-template-areas: "accl head accr" "wl body wr" "hand foot robe";
    gap: var(--eq-gap);
}
.view { display: flex; flex-direction: column; gap: var(--space-1); max-width: 260px; margin-top: var(--space-5); }
.view-lab { font-size: var(--fs-sm); color: var(--c-text-dim); }
.sub { margin: var(--space-5) 0 var(--space-2); font-size: var(--fs-md); }
.panel { max-width: 420px; border-collapse: collapse; }
.panel td, .contrib th, .contrib td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--c-line); }
.lab { color: var(--c-text-dim); white-space: nowrap; }
.scroll { overflow-x: auto; }
.contrib { border-collapse: collapse; }
.contrib th, .contrib td { white-space: nowrap; text-align: right; font-family: var(--font-num); }
.contrib th:first-child, .contrib td:first-child { text-align: left; font-family: inherit; }
.contrib th { color: var(--c-text-dim); font-weight: normal; font-family: inherit; }
.diff { color: var(--c-err); font-weight: bold; }
</style>
