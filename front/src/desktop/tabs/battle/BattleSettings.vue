<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EntityActor, EntityConditionState } from '@/eventActor';
import {
    condNameMap,
    hiddenSkillColumns, skillColumnOrder, skillRowLimit, showPetSkills,
    setSkillRowLimit, setShowPetSkills, setSkillColumnOrder, toggleSkillColumn, resetSkillSettings,
    autoSelectBoss, setAutoSelectBoss, hpGuideStep, setHpGuideStep, HP_GUIDE_STEPS,
    showCastTicks, setShowCastTicks, showHpRuler, setShowHpRuler, showInvincible, setShowInvincible,
    bossRaceIds, bossRacesChanged, addBossRaceId, removeBossRaceId, resetBossRaces, hiddenTargetRaces, setHiddenTargetRaces,
} from '@/store';
import { DEFAULT_SELF_CC_LIST, seenCCIds } from '@/lib/ccTracking';
import { DETAIL_COLUMNS, mergeColumnOrder } from '@/lib/skillColumns';
import DDialog from '../../ui/DDialog.vue';
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DSegmented from '../../ui/DSegmented.vue';
import DSwitch from '../../ui/DSwitch.vue';
import DNumberField from '../../ui/DNumberField.vue';
import DpsCcGroup from './DpsCcGroup.vue';
import { ccPickMode, setCcPickMode, PICK_MODE_OPTIONS } from './ccPickMode';
import SkillCcSettings from './SkillCcSettings.vue';
import type { SkillCcSeen } from '@/lib/skillCcSeen';
import { EMPTY_SKILL_CC_SEEN } from '@/lib/skillCcSeen';
import DReorderList from '../../ui/DReorderList.vue';
import RaceListEditor from './RaceListEditor.vue';
import {
    chartHiddenCCIds, trackedCCIds, resetCCTracking, setChartHiddenCCIds, setTrackedCCIds,
    selfChartHiddenCCIds, selfTrackedCCIds, setSelfChartHiddenCCIds, setSelfTrackedCCIds,
} from './ccSettings';

const props = defineProps<{ target: EntityActor | null; self: EntityActor | null; selfHistory?: EntityConditionState[]; ccSeen?: SkillCcSeen }>();
const open = defineModel<boolean>({ default: false });

type Tab = 'general' | 'dps' | 'skill' | 'skillcc';
// Session-only, like the web dialog.
const tab = ref<Tab>('general');
const TABS = [
    { value: 'general', label: '一般' },
    { value: 'dps', label: 'DPS 圖表 CC' },
    { value: 'skill', label: '技能圖表' },
    { value: 'skillcc', label: '技能圖表 CC' },
] as const;
const GUIDE_OPTIONS = HP_GUIDE_STEPS.map(v => ({ value: v as number, label: v === 0 ? '關閉' : `${v}%` }));

// --- DPS chart CC tab ---
const bossSeen = computed(() => (props.target ? seenCCIds(props.target.conditionHistory) : []));
const selfSeen = computed(() => seenCCIds(props.selfHistory ?? props.self?.conditionHistory ?? []));

// --- skill tab ---
const labelOf = new Map(DETAIL_COLUMNS.map(c => [c.key, c.label]));
const columnItems = computed(() => mergeColumnOrder(skillColumnOrder.value).map(key => ({
    key,
    label: labelOf.get(key) ?? key,
    checked: !hiddenSkillColumns.value.has(key),
})));
function onColumnReorder(from: number, to: number) {
    const keys = columnItems.value.map(c => c.key);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k);
    setSkillColumnOrder(keys);
}

// --- general tab ---
const hiddenRaceList = computed(() => [...hiddenTargetRaces.value]);
const hideRace = (id: number) => setHiddenTargetRaces(new Set([...hiddenTargetRaces.value, id]));
const unhideRace = (id: number) => setHiddenTargetRaces(new Set([...hiddenTargetRaces.value].filter(x => x !== id)));
</script>

<template>
  <DDialog v-model="open" :width="760" :fill="tab === 'skillcc'">
    <template #title>
      <span class="ttl"><i class="mdi mdi-cog" /> 傷害分析設定</span>
    </template>
    <div class="settings" :class="{ grow: tab === 'skillcc' }">
      <DSegmented v-model="tab" :options="[...TABS]" />

      <section v-if="tab === 'general'" data-tab="general">
        <div class="sec">DPS 圖表</div>
        <div class="setting">
          <div class="lbl">
            <div>血量虛線間隔</div>
            <div class="hint">BOSS 血量每降這麼多畫一條虛線，貫穿狀態時間軸</div>
          </div>
          <DSegmented :model-value="hpGuideStep" :options="GUIDE_OPTIONS" data-guide-step @update:model-value="setHpGuideStep" />
        </div>
        <div class="setting">
          <div class="lbl">
            <div>血量刻度</div>
            <div class="hint">圖上方標出 BOSS 血量每 5% 的時間點</div>
          </div>
          <DSwitch :model-value="showHpRuler" data-show-hp-ruler @update:model-value="setShowHpRuler" />
        </div>
        <div class="setting">
          <div class="lbl">
            <div>無敵區</div>
            <div class="hint">BOSS 無敵的時段鋪上淡紅底</div>
          </div>
          <DSwitch :model-value="showInvincible" data-show-invincible @update:model-value="setShowInvincible" />
        </div>
        <div class="setting">
          <div class="lbl">
            <div>狀態列施放標記</div>
            <div class="hint">狀態列上的白色短線：每次施放或刷新該 CC</div>
          </div>
          <DSwitch :model-value="showCastTicks" data-show-cast-ticks @update:model-value="setShowCastTicks" />
        </div>

        <div class="sec">自動選擇 BOSS 目標</div>
        <DSwitch :model-value="autoSelectBoss" label="在戰鬥頁籤自動選擇最新出現的 BOSS" @update:model-value="setAutoSelectBoss" />

        <div class="sec">BOSS 清單<span class="sec-note">只影響自動選擇 BOSS 與只看 BOSS</span></div>
        <RaceListEditor :ids="[...bossRaceIds]" row-attr="data-boss-row" @add="addBossRaceId" @remove="removeBossRaceId">
          <template #actions>
            <DButton v-if="bossRacesChanged" size="sm" data-reset-boss @click="resetBossRaces">恢復預設</DButton>
          </template>
        </RaceListEditor>

        <div class="sec">隱藏怪物<span class="sec-note">不列入目標清單；目標選單按眼睛圖示也會加到這裡</span></div>
        <RaceListEditor
          :ids="hiddenRaceList"
          row-attr="data-hidden-race-row"
          empty-text="目前沒有隱藏怪物"
          @add="hideRace"
          @remove="unhideRace"
        />
      </section>

      <section v-else-if="tab === 'dps'" data-tab="dps">
        <div class="sub">
          <DSegmented :model-value="ccPickMode" :options="PICK_MODE_OPTIONS" data-pick-mode @update:model-value="setCcPickMode" />
          <DButton size="sm" @click="resetCCTracking">重設</DButton>
        </div>
        <div v-if="ccPickMode === 'icon'" class="note faint">右鍵圖示開啟選單；拖曳圖示調整順序。</div>
        <DpsCcGroup
          data-boss
          title="BOSS（拖曳排序）"
          add-title="新增狀態"
          placeholder="搜尋 CC（名稱或編號）"
          row-attr="data-add"
          :tracked="trackedCCIds"
          :hidden="chartHiddenCCIds"
          :seen="bossSeen"
          :set-tracked="setTrackedCCIds"
          :set-hidden="setChartHiddenCCIds"
        />
        <DpsCcGroup
          data-self
          class="selfblock"
          title="自身（拖曳排序）"
          add-title="新增自身狀態"
          placeholder="搜尋自身 CC（名稱或編號）"
          row-attr="data-self-add"
          :tracked="selfTrackedCCIds"
          :hidden="selfChartHiddenCCIds"
          :seen="selfSeen"
          :defaults="DEFAULT_SELF_CC_LIST"
          :set-tracked="setSelfTrackedCCIds"
          :set-hidden="setSelfChartHiddenCCIds"
        />
      </section>

      <section v-else-if="tab === 'skill'" data-tab="skill">
        <div class="sec">
          <span class="grow">技能圖表設定</span>
          <DButton size="sm" data-reset-skill @click="resetSkillSettings">重設</DButton>
        </div>
        <div class="setting">
          <div class="lbl">
            <div>技能列數</div>
            <div class="hint">0 表示不限制</div>
          </div>
          <DNumberField
            :model-value="skillRowLimit"
            :min="0"
            class="num"
            aria-label="技能列數"
            data-row-limit
            @update:model-value="setSkillRowLimit"
          />
        </div>
        <div class="setting">
          <div class="lbl">
            <div>顯示寵物技能</div>
            <div class="hint">人偶一律計入，不受影響</div>
          </div>
          <DSwitch :model-value="showPetSkills" @update:model-value="setShowPetSkills" />
        </div>
        <div class="sec">欄位<span class="sec-note">拖曳排序</span></div>
        <div class="scroll tall">
          <DReorderList :items="columnItems" checkable @reorder="onColumnReorder" @toggle="k => toggleSkillColumn(String(k))" />
        </div>
        <div class="note faint">命中次數、總傷害、DPS、佔比一律顯示。</div>
      </section>

      <section v-else data-tab="skillcc" class="grow">
        <SkillCcSettings :seen="ccSeen ?? EMPTY_SKILL_CC_SEEN" />
      </section>

    </div>
  </DDialog>
</template>

<style scoped>
.ttl { display: inline-flex; align-items: center; gap: var(--space-3); }
.settings { display: flex; flex-direction: column; gap: var(--space-3); min-height: min(480px, 55vh); }
.grow { flex: 1; min-height: 0; }
section { display: flex; flex-direction: column; gap: var(--space-3); }
.sub { display: flex; align-items: center; justify-content: space-between; color: var(--c-text-dim); font-size: var(--fs-sm); }
.scroll { overflow-y: auto; }
.tall { max-height: 320px; }
.addrow { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: 0 var(--space-3); font-size: var(--fs-sm); }
.selfblock { margin-top: var(--space-3); }
.addrow img { border-radius: 2px; }
.grow { flex: 1; min-width: 0; }
.note { padding: var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); }
.faint { font-size: var(--fs-xs); opacity: 0.8; }
.setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: 0 var(--space-3); }
.hint { color: var(--c-text-dim); font-size: var(--fs-xs); }
.num { width: 76px; }
/* Section title: full-strength text over a rule, so sections read apart. */
.sec {
    display: flex; align-items: baseline; gap: var(--space-3);
    margin-top: var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--c-line);
    color: var(--c-text); font-size: var(--fs-md); font-weight: 600;
}
section > .sec:first-child { margin-top: 0; }
.sec-note { color: var(--c-text-dim); font-size: var(--fs-xs); font-weight: normal; }
</style>
