<template>
    <div class="px-2" ref="rootEl">
    <v-sheet class="d-flex align-center my-2 flex-wrap" style="gap: 8px;">
        <v-select v-model="targetId" :items="targetIdList" :item-title="targetItemTitle"
            :item-value="vv => vv[0]" variant="outlined" density="compact" hide-details style="flex: 1; min-width: 150px;">
        </v-select>
        <v-switch :model-value="bossOnlyTarget" @update:model-value="v => setBossOnlyTarget(!!v)"
            label="只顯示BOSS" color="primary" density="compact" hide-details />
    </v-sheet>

    <!-- DPS + effect (target debuffs, player-side buffs) unified chart with shared X axis -->
    <v-sheet v-if="dpsChartEntities.length > 0" ref="chartSheetEl" class="mt-1 mb-2" style="border: 1px solid #2a2a2a; border-radius: 4px; overflow: hidden;">
        <v-sheet class="d-flex align-center px-3 py-1" style="font-size: 0.8em; color: #888; background: #1a1a1a;">
            <span style="white-space: nowrap;">DPS (per {{ DPS_WINDOW_SEC }}s) &amp; Effect Timeline</span>
            <v-spacer />
            <v-menu :close-on-content-click="false">
                <template v-slot:activator="{ props: menuProps }">
                    <v-btn v-bind="menuProps" icon="mdi-cog" size="x-small" variant="text" density="compact" />
                </template>
                <v-card width="320" style="background: #1e1e1e;">
                    <!-- Enabled list (draggable) -->
                    <v-card-subtitle class="px-3 pt-3 pb-1 d-flex align-center" style="font-size: 0.75em;">
                        <span>Enabled (drag to reorder)</span>
                        <v-spacer />
                        <v-btn variant="text" size="x-small" density="compact" prepend-icon="mdi-restore"
                            @click="resetTrackedCCs">Reset</v-btn>
                    </v-card-subtitle>
                    <div style="max-height: 240px; overflow-y: auto;">
                        <div v-for="(ccId, idx) in trackedCCIdList" :key="ccId"
                            class="d-flex align-center px-3 py-1"
                            :draggable="ccId !== PINNED_CC"
                            :style="{
                                cursor: ccId === PINNED_CC ? 'default' : 'grab',
                                opacity: ccId === PINNED_CC ? 0.6 : (dragIdx === idx ? 0.4 : 1),
                                background: dragIdx === idx ? '#333' : 'transparent',
                                userSelect: 'none',
                            }"
                            @dragstart="onDragStart(idx)"
                            @dragover="onDragOver($event, idx)"
                            @dragend="onDragEnd">
                            <v-icon v-if="ccId === PINNED_CC" icon="mdi-lock" size="x-small" class="mr-1" style="opacity:0.4" />
                            <v-icon v-else icon="mdi-drag-horizontal-variant" size="x-small" class="mr-1" style="opacity:0.4" />
                            <img width="16" height="16" class="mr-2"
                                :src="ccIconUrl(region, ccId)"
                                style="border-radius:2px;" />
                            <span style="font-size: 0.82em; flex: 1;">{{ ccName(condNameMap, ccId) }} {{ ccId }}</span>
                            <v-btn icon size="x-small" variant="text" density="compact" class="mr-1"
                                :title="chartHiddenCCIds.has(ccId) ? 'Coverage only — click to show on chart' : 'Chart + coverage — click to hide from chart'"
                                @click.stop="toggleChartMode(ccId)">
                                <v-icon icon="mdi-chart-timeline-variant" size="small"
                                    :style="{ opacity: chartHiddenCCIds.has(ccId) ? 0.3 : 1 }" />
                            </v-btn>
                            <!-- Party-side lanes (覺醒/戰吼) drag like the rest but
                                 cannot be removed — the eye hides them instead. -->
                            <v-btn v-if="PLAYER_SIDE_CC_IDS.includes(ccId)" icon size="x-small" variant="text"
                                density="compact"
                                :title="hiddenTrackIds.has(ccTrackId(ccId)) ? '隊伍 Buff:已隱藏 — 點擊顯示' : '隊伍 Buff:顯示中 — 點擊隱藏'"
                                @click.stop="togglePlayerSideTrack(ccId)">
                                <v-icon :icon="hiddenTrackIds.has(ccTrackId(ccId)) ? 'mdi-eye-off' : 'mdi-eye'" size="small"
                                    :style="{ opacity: hiddenTrackIds.has(ccTrackId(ccId)) ? 0.35 : 1 }" />
                            </v-btn>
                            <v-btn v-else-if="ccId !== PINNED_CC" icon="mdi-close" size="x-small" variant="text"
                                density="compact" @click.stop="removeCC(ccId)" />
                        </div>
                    </div>
                    <!-- Add new -->
                    <v-divider class="my-1" />
                    <v-card-subtitle class="px-3 pt-1 pb-1 d-flex align-center" style="font-size: 0.75em;">
                        <span>Add condition</span>
                        <v-spacer />
                        <span style="margin-right: 10px;">只顯示出現過</span>
                        <v-switch :model-value="showSeenOnly" density="compact" hide-details class="seen-switch"
                            color="primary" style="flex: none;" @update:model-value="showSeenOnly = !!$event" />
                    </v-card-subtitle>
                    <div class="px-3 pb-2">
                        <v-text-field v-model="addCCSearch" density="compact" variant="outlined"
                            hide-details placeholder="Search CC..." clearable
                            style="font-size: 0.82em;" />
                    </div>
                    <div style="max-height: 160px; overflow-y: auto;">
                        <div v-for="ccId in availableCCs" :key="ccId"
                            class="d-flex align-center px-3 py-1"
                            style="cursor: pointer;"
                            @click="addCC(ccId)">
                            <v-icon icon="mdi-plus" size="x-small" class="mr-1" style="opacity:0.5" />
                            <img width="16" height="16" class="mr-2"
                                :src="ccIconUrl(region, ccId)"
                                style="border-radius:2px;" />
                            <span style="font-size: 0.82em;">{{ ccName(condNameMap, ccId) }} {{ ccId }}</span>
                        </div>
                        <div v-if="availableCCsOverflow > 0" class="px-3 py-1 text-medium-emphasis" style="font-size: 0.75em;">
                            還有 {{ availableCCsOverflow }} 筆,請用搜尋縮小範圍
                        </div>
                        <div v-if="availableCCs.length === 0" class="px-3 py-2 text-medium-emphasis" style="font-size: 0.8em;">
                            No more conditions to add
                        </div>
                    </div>
                </v-card>
            </v-menu>
        </v-sheet>
        <dps-debuff-chart
            :entities="dpsChartEntities"
            :target="selectedTarget"
            :party-actors="partyActorList"
            :bin-seconds="DPS_WINDOW_SEC"
            :tracked-c-c-ids="trackedCCIdList"
            :chart-hidden-c-c-ids="chartHiddenCCIdList" />
    </v-sheet>

    <v-sheet class="d-flex align-center px-3 mb-1"
        style="font-size: 0.8em; color: #888; background: #1a1a1a; border-radius: 4px; min-height: 20px;">
        <v-btn icon="mdi-camera" size="x-small" variant="text" density="compact" class="mr-2"
            title="截圖 DPS 表與角色列到剪貼簿" :loading="capturing" @click="captureScreenshot" />
        <alias-toolbar :real-names="pcRealNames" :arcana-hidden="allArcanaHidden"
            @toggle-arcana="toggleAllArcanaHidden" />
        <v-spacer />
        <v-menu :close-on-content-click="false">
            <template v-slot:activator="{ props: mp }">
                <v-btn v-bind="mp" icon="mdi-cog" size="x-small" variant="text" density="compact" />
            </template>
            <v-card width="280" style="background: #1e1e1e;">
                <v-card-subtitle class="px-3 pt-3 pb-2 d-flex align-center" style="font-size: 0.75em;">
                    <span>技能圖表設定</span>
                    <v-spacer />
                    <v-btn variant="text" size="x-small" density="compact" prepend-icon="mdi-restore"
                        @click="resetSkillSettings">Reset</v-btn>
                </v-card-subtitle>

                <div class="setting-row">
                    <div class="setting-row__label">
                        <div>技能列數</div>
                        <div class="setting-row__hint">0 表示不限制</div>
                    </div>
                    <v-text-field :model-value="skillRowLimit" type="number" min="0"
                        density="compact" variant="outlined" hide-details single-line
                        style="max-width: 76px;"
                        @update:model-value="setSkillRowLimit(Number($event))" />
                </div>

                <div class="setting-row">
                    <div class="setting-row__label">
                        <div>顯示寵物技能</div>
                        <div class="setting-row__hint">人偶一律計入,不受影響</div>
                    </div>
                    <v-switch :model-value="showPetSkills" density="compact" hide-details
                        color="primary" class="flex-grow-0"
                        @update:model-value="setShowPetSkills(!!$event)" />
                </div>

                <v-divider />
                <v-card-subtitle class="px-3 pt-2 pb-1" style="font-size: 0.75em;">
                    欄位(拖曳排序)
                </v-card-subtitle>
                <div style="max-height: 240px; overflow-y: auto;">
                    <div v-for="(c, idx) in orderedDetailColumns" :key="c.key"
                        class="d-flex align-center px-3 col-drag-row" draggable="true"
                        :style="{
                            cursor: 'grab',
                            opacity: colDragIdx === idx ? 0.4 : 1,
                            background: colDragIdx === idx ? '#333' : 'transparent',
                            userSelect: 'none',
                        }"
                        @dragstart="onColDragStart(idx)"
                        @dragover="onColDragOver($event, idx)"
                        @dragend="onColDragEnd">
                        <v-icon size="14" class="mr-1" style="opacity: 0.4;">mdi-drag-horizontal-variant</v-icon>
                        <v-checkbox-btn :model-value="!hiddenSkillColumns.has(c.key)" density="compact"
                            @click.stop="toggleSkillColumn(c.key)" />
                        <span style="font-size: 0.85em;">{{ c.label }}</span>
                    </div>
                </div>
                <div class="px-3 py-2" style="font-size: 0.7em; opacity: 0.55;">
                    命中次數、總傷害、DPS、佔比一律顯示。
                </div>
            </v-card>
        </v-menu>
    </v-sheet>

    <div ref="listEl">
    <v-expansion-panels multiple v-for="v in pcEntities" v-bind:key="v.actor.id"
        :style="{ '--pc-name-width': pcNameWidth, '--skill-grid-cols': skillGridColumns }">
        <template v-if="v.totalDamage > 0">
            <v-expansion-panel>
                <v-expansion-panel-title>
                    <div class="d-flex align-center" style="width: 100%; gap: 4px;">
                        <img class="pc-row__arcana-icon" width="26" height="26" style="cursor: pointer;"
                            :src="arcanaIconUrl(hiddenArcana.has(v.actor.id) ? 0 : v.arcana)"
                            :title="hiddenArcana.has(v.actor.id) ? '秘法已隱藏，點擊顯示' : `${arcanaTitle(v.arcana)}（點擊隱藏）`"
                            @click.stop="toggleArcanaHidden(v.actor.id)" />
                        <entity-alias-name :real-name="v.actor.name"
                            :display-name="prettyEntityName(v.actor)!"
                            :known-real-names="pcRealNames" />
                        <!-- Fixed width, and the timeline button is disabled rather
                             than removed, so every row's buttons sit at the same x. -->
                        <div class="pc-row__btns">
                            <v-btn :disabled="v.actor.conditionHistory.length === 0"
                                @click.stop="showConditionChart(v.actor)" size="x-small" icon="mdi-chart-timeline" variant="text" density="compact" />
                            <v-tooltip text="Cumulative"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showAttackerCumulativeChart(v)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-tooltip text="DPS"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showAttackerDpsChart(v)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                        </div>
                        <buff-indicator :cell="v.musicCell" scope="party" :compact="narrow" :origin="fightStartAt" />
                        <v-spacer />
                        <span class="pc-row__num" style="min-width: 48px; text-align: right; opacity: 0.7;">{{ formatDuration(v.damages.length >= 2 ? v.damages[v.damages.length - 1].At - v.damages[0].At : 0) }}</span>
                        <span class="pc-row__num num" style="min-width: 80px; color: #FFD54F;">{{ humanReadableNumber(v.totalDamage) }}</span>
                        <span class="pc-row__num num" style="min-width: 80px; color: #42A5F5;">{{ humanReadableNumber(pcDps(v)) }}</span>
                        <span class="pc-row__num" style="min-width: 56px; text-align: right; color: #66BB6A;">{{ (100 * v.totalDamage / allApplyDamage).toFixed(1) }}%</span>
                    </div>
                </v-expansion-panel-title>
                <v-expansion-panel-text class="skill-grid">
                    <!-- Header lives inside the panel: a shared one outside would
                         be orphaned once every panel is collapsed. -->
                    <div class="skill-grid__row skill-grid__row--head">
                        <span />
                        <span />
                        <span />
                        <span class="dim">命中次數</span>
                        <span v-for="c in visibleDetailColumns" :key="c.key" class="dim dim--faint">{{ c.label }}</span>
                        <span>總傷害</span>
                        <span>DPS</span>
                        <span>佔比</span>
                    </div>
                    <div v-for="row in visibleSkillRows(v)" v-bind:key="row.skillId"
                        class="skill-grid__row skill-grid__row--data"
                        @click.stop="showEntityDetailDamageList(v.actor.id, targetId, row.skillId)">
                        <!-- Absolutely positioned, so it is out of grid flow and
                             spans the whole row rather than taking a column. -->
                        <div class="skill-grid__fill"
                            :style="{ width: `${Math.round(100 * row.damage / v.totalDamage)}%`, background: getMabiNameColor(row.skillName) }" />
                        <div class="skill-grid__name">
                            <img width="24" height="24" :src="`/icons/skill/${row.skillId}.png`" style="border-radius: 2px;" />
                            <span class="font-weight-medium text-truncate">{{ row.skillName }}</span>
                        </div>
                        <div class="skill-grid__btns">
                            <v-tooltip text="Distribution"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillDistribution(v, row.skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-tooltip text="Cumulative"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillCumulativeChart(v, row.skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-tooltip text="DPS"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillDpsChart(v, row.skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-tooltip text="Count"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillCountChart(v, row.skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                        </div>
                        <span />
                        <span class="num dim">{{ row.count }}</span>
                        <span v-for="c in visibleDetailColumns" :key="c.key" class="num dim dim--faint">{{ row.details[c.key] }}</span>
                        <span class="num" style="color: #FFD54F;">{{ humanReadableNumber(row.damage) }}</span>
                        <span class="num" style="color: #42A5F5;">{{ humanReadableNumber(row.dps) }}</span>
                        <span class="num" style="color: #66BB6A;">{{ (100 * row.damage / v.totalDamage).toFixed(1) }}%</span>
                    </div>
                    <div v-if="skillRowLimit > 0 && v.skillRows.length > skillRowLimit"
                        class="skill-grid__more" @click.stop="toggleSkillList(v.actor.id)">
                        {{ expandedSkillLists.has(v.actor.id)
                            ? `收合(顯示前 ${skillRowLimit} 個)`
                            : `顯示全部 ${v.skillRows.length} 個技能` }}
                    </div>
                </v-expansion-panel-text>
            </v-expansion-panel>
            <v-sheet width="100%" class="pc-row__share"
                style="position: relative; overflow: hidden; border-radius: 4px; cursor: pointer; background: rgba(255,255,255,0.12);"
                @click.stop="showEntityAllDamageList(v.actor.id)">
                <div :style="{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(100 * v.totalDamage / allApplyDamage)}%`, background: getMabiNameColor(prettyEntityName(v.actor)!), opacity: 0.6 }" />
            </v-sheet>
        </template>

    </v-expansion-panels>
    </div>

    <v-snackbar v-model="shotSnackbar" :timeout="2500" color="info" location="bottom right">
        {{ shotMessage }}
    </v-snackbar>
    </div>
</template>

<script lang="ts">
import { defineComponent, inject, ref, computed, onUnmounted, onMounted, watch } from "vue";

import { hiddenSkillColumns, toggleSkillColumn, skillRowLimit, setSkillRowLimit, showPetSkills, setShowPetSkills, skillColumnOrder, setSkillColumnOrder, resetSkillSettings } from '@/store';
import { getMabiNameColor, prettyEntityName, humanReadableNumber, formatDuration, ccIconUrl, ccName, bossTargetLabel, bossTitleLabel, stackLayout, resolveThemeBackground } from '@/lib/util';
import { ccTrackId, PLAYER_SIDE_CC_IDS } from '@/lib/buffTrack';
import { hiddenTrackIds, hideTrack, unhideTrack } from '@/store';
import type { EntityDamage, EntityActor } from '@/eventActor';
import { DamageCollectorBase, DualGroupedDamageCollector, GroupedDamageCollector, countsTowardStats } from '@/actionCollector';
import { useDialogStack } from '@/lib/useDialogStack';
import { filterByTimeRange, computeGroupedStats } from '@/lib/timeRangeFilter';
import highcharts from 'highcharts';

import { autoSelectBoss, BOSS_RACE_IDS, bossOnlyTarget, setBossOnlyTarget } from '@/store';
import { deriveMusicBuffCell, type MusicBuffCell } from '@/lib/musicBuff';
import { computeCritStats, type CritStats } from '@/lib/critStats';
import { deriveArcana, arcanaIconUrl, arcanaTitle } from '@/lib/arcana';
import { ARCANA_BY_SKILL } from '@/lib/arcanaTable';

// The chart's rolling window. Named because the header states it, and a
// header that disagrees with the chart is worse than no header.
const DPS_WINDOW_SEC = 15;

import ConditionChart from '@/components/subComponents/conditionChart.vue';
import DamageChart from '@/components/subComponents/damageChart.vue';
import DamageDistribution from '@/components/subComponents/damageDistribution.vue';
import DamageList from '@/components/subComponents/damageList.vue';
import DpsDebuffChart from '@/components/subComponents/dpsDebuffChart.vue';
import EntityAliasName from '@/components/subComponents/entityAliasName.vue';
import AliasToolbar from '@/components/subComponents/aliasToolbar.vue';
import BuffIndicator from '@/components/subComponents/buffIndicator.vue';

export default defineComponent({
    components: {
        DpsDebuffChart,
        EntityAliasName,
        AliasToolbar,
        BuffIndicator,
    },
    setup() {
        const isLoading = inject('isLoading');
        const region = inject('region');
        const raceNameMap = inject('raceNameMap');
        const skillNameMap = inject('skillNameMap');
        const appEvent = inject('appEvent');
        const condNameMap = inject('condNameMap');
        const actorManager = inject('actorManager');
        const dcManager = inject('dcManager');
        const timeRangeMin = inject('timeRangeMin');
        const timeRangeMax = inject('timeRangeMax');

        const damageCollectorMap: Record<string, DamageCollectorBase> = {};

        // Single breakpoint for the whole indicator zone (spec §1 rule 3):
        // below this container width, every buff-indicator switches to
        // icon-only together — never per-indicator.
        const NARROW_BREAKPOINT_PX = 720;
        const rootEl = ref<HTMLElement | null>(null);
        const narrow = ref(false);
        let zoneResizeObserver: ResizeObserver | null = null;

        onUnmounted(() => {
            appEvent.value.removeEventListener('clear', clearTarget);
            zoneResizeObserver?.disconnect();

            for (const v of Object.values(damageCollectorMap)) {
                dcManager.value.removeDamageCollector(v);
            }
        });

        const getDC = (attackerId: string) => {
            const key = `${attackerId}`;
            if (damageCollectorMap[key]) {
                return damageCollectorMap[key] as DualGroupedDamageCollector;
            }

            const dc = dcManager.value.getDualGroupedDamageCollector(v => v.Id == attackerId, v => v.TargetId, v => `${v.SkillId}`);
            damageCollectorMap[key] = dc;

            return dc;
        }

        const getTargetDC = () => {
            const key = `target`;
            if (damageCollectorMap[key]) {
                return damageCollectorMap[key] as GroupedDamageCollector;
            }

            const dc = dcManager.value.getGroupedDamageCollector(() => true, v => v.TargetId);
            damageCollectorMap[key] = dc;

            return dc;
        }
        const targetDC = ref(getTargetDC());

        const dialogStack = useDialogStack();

        const showEntityDetailDamageList = (attackerId: string, targetId: string, skillId: number) => {
            const entity = entityMap.value[attackerId];
            if (!entity) {
                return;
            }

            const damages = targetId ?
                entity.dc.dualGroupedDamages[targetId][skillId] :
                entity.dc.grouped2Damages[skillId];

            const attackerName = prettyName(entity.actor)!;
            const targetName = skillNameMap.value[skillId] || `unknownSkill:${skillId}`;
            dialogStack.open(DamageList, {
                attackerName,
                targetName,
                damages: damages,
            }, `${attackerName} → ${targetName}`);
        }

        const showEntityAllDamageList = (attackerId: string) => {
            const entity = entityMapWithTargetData.value[attackerId];
            if (!entity) {
                return;
            }

            const attackerName = prettyName(entity.actor)!;
            dialogStack.open(DamageList, {
                attackerName,
                targetName: 'All',
                damages: entity.damages,
            }, `${attackerName} → All`);
        }

        const entityMap = computed(() => {
            const m: Record<string, { actor: EntityActor, dc: DualGroupedDamageCollector }> = {};

            for (const k in actorManager.value.entityMap) {
                const v = actorManager.value.entityMap[k];

                // Each collector replays every damage on creation and is then
                // handed every one that follows, so this loop's length is a
                // multiplier on the whole session's damage. Only players ever
                // get a row: one dungeon log held 1,389 entities and 6 of them
                // could show one, which is the difference between a chart that
                // responds in seconds and one that takes minutes.
                if (!v.isPC) continue;

                m[k] = {
                    actor: v,
                    dc: getDC(k),
                }
            }

            return m;
        });

        /** Names for the target picker, which lists mobs — not in entityMap. */
        const actorOf = (id: string) => actorManager.value.entityMap[id];

        const entityMapWithTargetData = computed(() => {
            const m: Record<string, EntityExtended> = {};
            const minAt = timeRangeMin.value;
            const maxAt = timeRangeMax.value;
            const hasFilter = minAt !== null && maxAt !== null;

            for (const k in entityMap.value) {
                const v = entityMap.value[k];

                const baseDamages = targetId.value ? v.dc.groupedDamages[targetId.value] || [] : v.dc.damages;
                const damages = filterByTimeRange(baseDamages, minAt, maxAt);

                if (hasFilter) {
                    const stats = computeGroupedStats(damages, d => `${d.SkillId}`);
                    m[k] = {
                        ...v,
                        totalDamage: stats.totalDamage,
                        damages,
                        groupedTotalDamages: stats.groupedTotalDamages,
                        groupedDamages: stats.groupedDamages,
                        groupedMinDamages: stats.groupedMinDamages,
                        groupedMaxDamages: stats.groupedMaxDamages,
                        groupedCount: stats.groupedCount,
                        groupedCriticalCount: stats.groupedCriticalCount,
                    };
                } else {
                    const totalDamage = targetId.value ? v.dc.groupedTotalDamages[targetId.value] || 0 : v.dc.totalDamage;
                    const groupedTotalDamages = targetId.value ? v.dc.dualGroupedTotalDamages[targetId.value] : v.dc.grouped2TotalDamages;
                    const groupedDamages = targetId.value ? v.dc.dualGroupedDamages[targetId.value] : v.dc.grouped2Damages;
                    const groupedMinDamages = targetId.value ? v.dc.dualGroupedMinDamages[targetId.value] : v.dc.grouped2MinDamages;
                    const groupedMaxDamages = targetId.value ? v.dc.dualGroupedMaxDamages[targetId.value] : v.dc.grouped2MaxDamages;
                    const groupedCount = targetId.value ? v.dc.dualGroupedCount[targetId.value] : v.dc.grouped2Count;
                    const groupedCriticalCount = targetId.value ? v.dc.dualGroupedCriticalCount[targetId.value] : v.dc.grouped2CriticalCount;

                    m[k] = {
                        ...v,
                        totalDamage,
                        damages,
                        groupedTotalDamages,
                        groupedDamages,
                        groupedMinDamages,
                        groupedMaxDamages,
                        groupedCount,
                        groupedCriticalCount,
                    };
                }
            }

            return m;
        })

        const arrayDps = (totalDamage: number, damages: EntityDamage[]) => {
            if (!damages || damages.length < 2) return 0;
            const duration = damages[damages.length - 1].At - damages[0].At;
            return duration > 0 ? totalDamage / duration : 0;
        };

        // Everything a skill row prints, computed once per render pass: the
        // template used to re-scan the same damage array for each stat, and
        // the panel re-renders on every 33ms actor tick.
        // Header and data both iterate this list, so a column cannot appear in
        // one and not the other — the failure that put them out of step before.
        const DETAIL_COLUMNS = [
            { key: 'castCount', label: '施放次數', width: 68 },
            { key: 'critCount', label: '爆擊次數', width: 68 },
            { key: 'normalCount', label: '非爆次數', width: 68 },
            { key: 'critRate', label: '爆擊率', width: 68 },
            { key: 'avg', label: '平均', width: 68 },
            { key: 'critAvg', label: '爆擊平均', width: 68 },
            { key: 'normalAvg', label: '非爆平均', width: 68 },
            { key: 'min', label: '最低', width: 68 },
            { key: 'max', label: '最高', width: 68 },
            { key: 'critMin', label: '爆擊最低', width: 68 },
            { key: 'critMax', label: '爆擊最高', width: 68 },
            { key: 'normalMin', label: '非爆最低', width: 68 },
            { key: 'normalMax', label: '非爆最高', width: 68 },
            { key: 'critSummary', label: '爆擊統計', width: 300 },
            { key: 'normalSummary', label: '非爆統計', width: 300 },
        ];

        // A saved order is merged with the declared one, so a column added in a
        // later build still shows up instead of silently vanishing.
        const orderedDetailColumns = computed(() => {
            const saved = skillColumnOrder.value;
            const known = new Map(DETAIL_COLUMNS.map(c => [c.key, c]));
            const out = saved.map(k => known.get(k)).filter((c): c is typeof DETAIL_COLUMNS[0] => !!c);
            for (const c of DETAIL_COLUMNS) if (!saved.includes(c.key)) out.push(c);
            return out;
        });

        const visibleDetailColumns = computed(() =>
            orderedDetailColumns.value.filter(c => !hiddenSkillColumns.value.has(c.key)));

        const colDragIdx = ref(-1);
        const onColDragStart = (idx: number) => { colDragIdx.value = idx; };
        const onColDragOver = (e: DragEvent, idx: number) => {
            e.preventDefault();
            if (colDragIdx.value < 0 || idx === colDragIdx.value) return;
            const list = orderedDetailColumns.value.map(c => c.key);
            const [item] = list.splice(colDragIdx.value, 1);
            list.splice(idx, 0, item);
            setSkillColumnOrder(list);
            colDragIdx.value = idx;
        };
        const onColDragEnd = () => { colDragIdx.value = -1; };

        const skillGridColumns = computed(() =>
            ['180px', '112px', '1fr', '76px']
                .concat(visibleDetailColumns.value.map(c => `${c.width}px`))
                .concat(['92px', '92px', '68px'])
                .join(' '));

        // Per-panel override of the row limit; the setting is the default and
        // this is the "show them all" the user asked for.
        const expandedSkillLists = ref<Set<string>>(new Set());
        const toggleSkillList = (id: string) => {
            const next = new Set(expandedSkillLists.value);
            if (next.has(id)) next.delete(id); else next.add(id);
            expandedSkillLists.value = next;
        };
        const visibleSkillRows = (v: PcRow): SkillRow[] => {
            const limit = skillRowLimit.value;
            if (limit <= 0 || expandedSkillLists.value.has(v.actor.id)) return v.skillRows;
            return v.skillRows.slice(0, limit);
        };

        const buildSkillRows = (v: EntityExtended): SkillRow[] => {
            // Cast counts come from the broadcast skill-use events, filtered by
            // the same time range the damage columns obey. One pass, then a
            // lookup per row. A puppet casts its own skill ids under its own
            // entity, so a puppeteer's rows can read lower than reality.
            const minAt = timeRangeMin.value, maxAt = timeRangeMax.value;
            const casts = new Map<number, number>();
            for (const u of v.actor.skillUses) {
                if (minAt !== null && maxAt !== null && (u.At < minAt || u.At > maxAt)) continue;
                casts.set(u.SkillId, (casts.get(u.SkillId) ?? 0) + 1);
            }
            return Object.keys(v.groupedTotalDamages ?? {})
                .map((key) => {
                    const skillId = +key;
                    const all = v.groupedDamages?.[skillId] ?? [];
                    // A pet's damage is redirected onto its owner and tagged;
                    // a summon (人偶) is the owner's own output and never is.
                    const damages = showPetSkills.value ? all : all.filter(d => d.PetId === '');
                    const crit = computeCritStats(damages);

                    // One pass: this runs per skill per render tick, and a
                    // spread into Math.min blows the stack on a long session.
                    let count = 0, damage = 0, min = 0, max = 0;
                    for (const d of damages) {
                        damage += d.Damage;
                        if (!countsTowardStats(d)) continue;
                        if (count === 0 || d.Damage < min) min = d.Damage;
                        if (count === 0 || d.Damage > max) max = d.Damage;
                        count++;
                    }
                    return {
                        skillId,
                        skillName: skillNameMap.value[skillId] || `unknownSkill:${skillId}`,
                        damage,
                        dps: arrayDps(damage, damages),
                        count,
                        min,
                        max,
                        crit: crit,
                        details: {
                            critRate: `${(100 * crit.rate).toFixed(1)}%`,
                            // '-' rather than 0: casts we never saw (pre-attach,
                            // or a puppet's own ids) must not read as "zero casts".
                            castCount: casts.get(skillId) ? String(casts.get(skillId)) : '-',
                            // Counts stay bare: humanReadableNumber would turn 47 into 0.05K.
                            critCount: String(crit.critCount),
                            normalCount: String(crit.normalCount),
                            avg: humanReadableNumber(count ? damage / count : 0),
                            critAvg: humanReadableNumber(crit.critAvg),
                            normalAvg: humanReadableNumber(crit.normalAvg),
                            min: humanReadableNumber(min),
                            max: humanReadableNumber(max),
                            critMin: humanReadableNumber(crit.critMin),
                            critMax: humanReadableNumber(crit.critMax),
                            normalMin: humanReadableNumber(crit.normalMin),
                            normalMax: humanReadableNumber(crit.normalMax),
                            critSummary: `${humanReadableNumber(crit.critAvg)} (${crit.critCount}, ${humanReadableNumber(crit.critMin)} ~ ${humanReadableNumber(crit.critMax)})`,
                            normalSummary: `${humanReadableNumber(crit.normalAvg)} (${crit.normalCount}, ${humanReadableNumber(crit.normalMin)} ~ ${humanReadableNumber(crit.normalMax)})`,
                        } as Record<string, string>,
                    };
                })
                .filter(r => r.damage > 0)
                .sort((a, b) => b.damage - a.damage);
        };

        // Same window the row's own duration span uses: the filtered range's
        // actual event bounds, or the fight's first/last hit when unfiltered.
        // Never pre-trimmed further — deriveMusicBuffCell owns both edges.
        const musicCellOf = (v: EntityExtended): MusicBuffCell => {
            const d = v.damages;
            if (d.length === 0) return { kind: 'absent' };
            return deriveMusicBuffCell(v.actor.conditionHistory, d[0].At, d[d.length - 1].At);
        };

        const pcEntities = computed((): PcRow[] =>
            Object.values(entityMapWithTargetData.value)
                .filter(v => v.actor.isPC)
                .sort((a, b) => b.totalDamage - a.totalDamage)
                .map(v => ({
                    ...v, skillRows: buildSkillRows(v), musicCell: musicCellOf(v),
                    // From damage records, not skillUseIds/eventSkillUse: a
                    // non-damaging arcana skill (e.g. puppeteer's summons,
                    // 59167-59169) won't be detected until a damaging one is.
                    arcana: deriveArcana(v.actor.applyDamages.map(d => d.SkillId), ARCANA_BY_SKILL),
                })));

        // Template-inline [...set] / .map() made a NEW array on every render,
        // and the chart watches its array props by identity — with live packets
        // re-rendering this component ~13x/s, that destroyed and rebuilt both
        // charts on every tick. Computeds cache, so identity only changes when
        // the underlying data does.
        const chartHiddenCCIdList = computed(() => [...chartHiddenCCIds.value]);

        // Fight-start second for the music cell's value ranges — the same
        // origin the timeline chart uses for its axis.
        const fightStartAt = computed(() => {
            let min = Infinity;
            for (const e of dpsChartEntities.value) {
                for (const d of e.damages) if (d.At < min) min = d.At;
            }
            return isFinite(min) ? min : 0;
        });

        const togglePlayerSideTrack = (ccId: number) => {
            const id = ccTrackId(ccId);
            if (hiddenTrackIds.value.has(id)) unhideTrack(id);
            else hideTrack(id);
        };
        const partyActorList = computed(() => pcEntities.value.map(v => v.actor));

        // Session-only arcana hiding (screenshots/streams), like aliases.
        const hiddenArcana = ref(new Set<string>());
        const toggleArcanaHidden = (id: string) => {
            const next = new Set(hiddenArcana.value);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            hiddenArcana.value = next;
        };
        const allArcanaHidden = computed(() =>
            pcEntities.value.length > 0 &&
            pcEntities.value.every(v => hiddenArcana.value.has(v.actor.id)));
        const toggleAllArcanaHidden = () => {
            hiddenArcana.value = allArcanaHidden.value
                ? new Set()
                : new Set(pcEntities.value.map(v => v.actor.id));
        };

        // The roster feeds both the toolbar's bulk randomise and each row's
        // re-roll, so no alias can collide with a real name still on screen.
        const pcRealNames = computed(() => pcEntities.value.map(v => v.actor.name));

        const targetId = ref('');
        // Boss rows carry appear time, race and max HP; other targets keep
        // the plain name + damage form.
        const targetItemTitle = ([id, dmg]: [string, number]) => {
            if (!id) return `all ${humanReadableNumber(dmg || 0)}`;
            const actor = actorOf(id);
            if (actor && BOSS_RACE_IDS.has(actor.raceId)) {
                return bossTargetLabel(actor.appearAt, actor.raceId,
                    raceNameMap.value[actor.raceId], actor.maxLife);
            }
            return `${prettyName(actor) ?? id} ${humanReadableNumber(dmg || 0)}`;
        };
        const bossFilter = (list: [string, number][]) => bossOnlyTarget.value
            ? list.filter(([id]) => !id || BOSS_RACE_IDS.has(actorOf(id)?.raceId ?? -1))
            : list;
        const targetIdList = computed(() => {
            const minAt = timeRangeMin.value;
            const maxAt = timeRangeMax.value;
            const hasFilter = minAt !== null && maxAt !== null;

            if (hasFilter) {
                const filtered = filterByTimeRange(targetDC.value.damages, minAt, maxAt);
                const stats = computeGroupedStats(filtered, d => d.TargetId);
                const list = Object.entries(stats.groupedTotalDamages)
                    .sort(([, av], [, bv]) => bv - av);
                list.unshift(['', stats.totalDamage]);
                return bossFilter(list);
            }

            const list = Object.entries(targetDC.value.groupedTotalDamages)
                .sort(([, av], [, bv]) => bv - av);

            list.unshift(['', targetDC.value.totalDamage]);

            return bossFilter(list);
        });

        const clearTarget = () => {
            targetId.value = '';
        }

        // Auto-select boss only when a *new* boss entity appears. Watch only
        // the key list (shallow) to avoid firing on every damage update.
        const seenBossIds = new Set<string>();
        watch(() => Object.keys(actorManager.value.entityMap), (keys) => {
            if (!autoSelectBoss.value) return;
            for (const id of keys) {
                if (seenBossIds.has(id)) continue;
                const actor = actorManager.value.entityMap[id];
                if (!actor || !BOSS_RACE_IDS.has(actor.raceId)) continue;
                seenBossIds.add(id);
                targetId.value = id;
            }
        }, { immediate: true });

        // Screenshot: DPS chart + character list stitched into one PNG on
        // the clipboard. The toolbar row between them is simply not captured.
        const chartSheetEl = ref<{ $el: HTMLElement } | null>(null);
        const listEl = ref<HTMLElement | null>(null);
        const capturing = ref(false);
        const shotSnackbar = ref(false);
        const shotMessage = ref('');

        const captureScreenshot = async () => {
            if (capturing.value) return;
            capturing.value = true;
            try {
                const { default: html2canvas } = await import('html2canvas');
                // A lingering hover (tooltip, crosshair, point marker) would
                // be baked into the PNG.
                for (const c of highcharts.charts) {
                    if (!c) continue;
                    (c.pointer as unknown as { reset(allowMove?: boolean, delay?: number): void })?.reset(false, 0);
                    c.tooltip?.hide(0);
                    for (const ax of c.xAxis) (ax as unknown as { hideCrosshair?(): void }).hideCrosshair?.();
                }
                // Lift the music cells' fixed width for the capture (see
                // buffIndicator.vue) so runs render untruncated.
                listEl.value?.classList.add('screenshot-capture');
                const bg = resolveThemeBackground();
                const els = [chartSheetEl.value?.$el, listEl.value]
                    .filter((el): el is HTMLElement => !!el);
                const canvases = (await Promise.all(els.map(el =>
                    html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: bg }))))
                    .filter(c => c.width > 0 && c.height > 0);
                if (canvases.length === 0) {
                    shotMessage.value = '沒有可截圖的內容';
                    return;
                }
                // Canvas pixels are 2x CSS pixels (html2canvas scale: 2).
                const SCALE = 2;
                const layout = stackLayout(canvases.map(c => ({ w: c.width, h: c.height })), 7 * SCALE);
                const titleH = 36 * SCALE;
                const final = document.createElement('canvas');
                final.width = layout.w;
                final.height = layout.h + titleH;
                const ctx = final.getContext('2d')!;
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, final.width, final.height);
                ctx.fillStyle = '#1a1a1a';
                ctx.fillRect(0, 0, final.width, titleH);
                // Everything in the bar shares one baseline near the bottom,
                // so mixed sizes still line up.
                ctx.textBaseline = 'alphabetic';
                ctx.textAlign = 'left';
                const baseY = titleH - 8 * SCALE;
                // Bahnschrift for latin/digits; CJK glyphs fall through to
                // bold JhengHei.
                const titleFont = `bold ${22 * SCALE}px Bahnschrift, "Arial Black", "Microsoft JhengHei", sans-serif`;
                let titleX = 8 * SCALE;
                const boss = titleBossActor();
                if (boss) {
                    const text = bossTitleLabel(boss.appearAt, boss.raceId,
                        raceNameMap.value[boss.raceId], boss.maxLife);
                    ctx.fillStyle = '#ccc';
                    ctx.font = titleFont;
                    ctx.fillText(text, titleX, baseY);
                    titleX += ctx.measureText(text).width + 20 * SCALE;
                }
                const clearSec = fightDurationSec();
                if (clearSec > 0) {
                    ctx.fillStyle = '#aaa';
                    ctx.font = `bold ${15 * SCALE}px Bahnschrift, "Arial Black", "Microsoft JhengHei", sans-serif`;
                    ctx.fillText(`通關時間：${formatDuration(clearSec)}`, titleX, baseY);
                }
                ctx.fillStyle = '#888';
                ctx.font = `${12 * SCALE}px sans-serif`;
                ctx.textAlign = 'right';
                ctx.fillText(`Generated by Mogugi v${__APP_VERSION__}`,
                    final.width - 8 * SCALE, baseY);
                canvases.forEach((c, i) => ctx.drawImage(c, 0, titleH + layout.ys[i]));
                const blob = await new Promise<Blob | null>(res => final.toBlob(res, 'image/png'));
                if (!blob) throw new Error('canvas.toBlob returned null');
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                shotMessage.value = '已截圖到剪貼簿';
            } catch (e) {
                console.error('screenshot failed:', e);
                shotMessage.value = '截圖失敗，無法寫入剪貼簿';
            } finally {
                listEl.value?.classList.remove('screenshot-capture');
                capturing.value = false;
                shotSnackbar.value = true;
            }
        };

        // Screenshot title's clear time: the damage span of the charted
        // entities.
        const fightDurationSec = () => {
            let max = 0;
            for (const e of dpsChartEntities.value) {
                for (const d of e.damages) if (d.At > max) max = d.At;
            }
            return max > fightStartAt.value ? max - fightStartAt.value : 0;
        };

        // Title-bar boss: the selected target when it is one, else the
        // most recently appeared boss on the field.
        const titleBossActor = () => {
            const sel = selectedTarget.value;
            if (sel && BOSS_RACE_IDS.has(sel.raceId)) return sel;
            let best: EntityActor | null = null;
            for (const id in actorManager.value.entityMap) {
                const a = actorManager.value.entityMap[id];
                if (!BOSS_RACE_IDS.has(a.raceId)) continue;
                if (!best || (a.appearAt ?? 0) > (best.appearAt ?? 0)) best = a;
            }
            return best;
        };

        const showAttackerCumulativeChart = (v: EntityExtended) => {
            const name = prettyName(v.actor)!;
            dialogStack.open(DamageChart, {
                entities: [{ name, damages: v.damages }],
                mode: 'cumulative',
            }, `Cumulative - ${name}`);
        }

        const showAttackerDpsChart = (v: EntityExtended) => {
            const name = prettyName(v.actor)!;
            dialogStack.open(DamageChart, {
                entities: [{ name, damages: v.damages }],
                mode: 'dps',
            }, `DPS - ${name}`);
        }

        const showSkillDistribution = (v: EntityExtended, skillId: number) => {
            const attackerName = prettyName(v.actor)!;
            const skillName = skillNameMap.value[skillId] || `unknownSkill:${skillId}`;
            const damages = v.groupedDamages?.[skillId] || [];
            dialogStack.open(DamageDistribution, { damages }, `${attackerName} - ${skillName} Distribution`);
        }

        const getSkillChartEntity = (v: EntityExtended, skillId: number) => {
            const skillName = skillNameMap.value[skillId] || `unknownSkill:${skillId}`;
            const damages = v.groupedDamages?.[skillId] || [];
            return { name: skillName, damages, attackerName: prettyName(v.actor)! };
        }

        const showSkillCumulativeChart = (v: EntityExtended, skillId: number) => {
            const e = getSkillChartEntity(v, skillId);
            dialogStack.open(DamageChart, {
                entities: [{ name: e.name, damages: e.damages }],
                mode: 'cumulative',
            }, `${e.attackerName} - ${e.name} Cumulative`);
        }

        const showSkillDpsChart = (v: EntityExtended, skillId: number) => {
            const e = getSkillChartEntity(v, skillId);
            dialogStack.open(DamageChart, {
                entities: [{ name: e.name, damages: e.damages }],
                mode: 'dps',
            }, `${e.attackerName} - ${e.name} DPS`);
        }

        const showSkillCountChart = (v: EntityExtended, skillId: number) => {
            const e = getSkillChartEntity(v, skillId);
            dialogStack.open(DamageChart, {
                entities: [{ name: e.name, damages: e.damages }],
                mode: 'count',
            }, `${e.attackerName} - ${e.name} Usage Count`);
        }

        onMounted(() => {
            appEvent.value.addEventListener('clear', clearTarget);
            promptOnDefaultsChange();

            if (rootEl.value) {
                zoneResizeObserver = new ResizeObserver(entries => {
                    narrow.value = (entries[0]?.contentRect.width ?? 0) < NARROW_BREAKPOINT_PX;
                });
                zoneResizeObserver.observe(rootEl.value);
            }
        })

        const allApplyDamage = computed(() =>
            pcEntities.value.reduce((acc, v) => acc + v.totalDamage, 0));

        const prettyName = (entity?: EntityActor) => prettyEntityName(entity, raceNameMap);

        // Names are capped at the longest one actually on screen, so every row's
        // buttons share an x without hard-coding a character count. CJK glyphs
        // are about 1em, latin about half that.
        const pcNameWidth = computed(() => {
            let widest = 4;
            for (const v of pcEntities.value) {
                const name = prettyName(v.actor) || '';
                let w = 0;
                for (const ch of name) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
                if (w > widest) widest = w;
            }
            return `${Math.min(widest, 12).toFixed(2)}em`;
        });

        const pcDps = (v: { totalDamage: number; damages: EntityDamage[] }) => {
            const d = v.damages;
            if (d.length < 2 || d[d.length - 1].At <= d[0].At) return 0;
            return v.totalDamage / (d[d.length - 1].At - d[0].At);
        };

        const showConditionChart = (actor: EntityActor) => {
            const name = prettyName(actor) || actor.id;
            const props: Record<string, any> = {
                conditionHistory: actor.conditionHistory,
            };

            // if a target is selected, bound the chart to the damage time range
            const entity = entityMapWithTargetData.value[actor.id];
            if (targetId.value && entity && entity.damages.length >= 2) {
                props.startTime = entity.damages[0].At;
                props.endTime = entity.damages[entity.damages.length - 1].At;
            }

            dialogStack.open(ConditionChart, props, `CC - ${name}`);
        };

        // --- DPS line chart (pet-free, follows selected target) ---
        const getNoPetDC = () => {
            const key = 'noPetByAttacker';
            if (damageCollectorMap[key]) {
                return damageCollectorMap[key] as GroupedDamageCollector;
            }
            const dc = dcManager.value.getGroupedDamageCollector(
                (d: EntityDamage) => d.PetId === '',
                (d: EntityDamage) => d.Id,
            );
            damageCollectorMap[key] = dc;
            return dc;
        };
        const noPetDC = ref(getNoPetDC());

        const dpsChartEntities = computed(() => {
            const minAt = timeRangeMin.value;
            const maxAt = timeRangeMax.value;
            const result: { name: string, damages: EntityDamage[] }[] = [];

            for (const k in noPetDC.value.groupedDamages) {
                const actor = actorManager.value.entityMap[k];
                if (!actor || !actor.isPC) continue;
                let damages = noPetDC.value.groupedDamages[k] || [];
                // Filter to selected target when one is chosen
                if (targetId.value) {
                    damages = damages.filter(d => d.TargetId === targetId.value);
                }
                damages = filterByTimeRange(damages, minAt, maxAt);
                if (damages.length === 0) continue;
                result.push({ name: prettyName(actor) || k, damages });
            }

            return result.sort((a, b) => {
                const ta = a.damages.reduce((s, d) => s + d.Damage, 0);
                const tb = b.damages.reduce((s, d) => s + d.Damage, 0);
                return tb - ta;
            });
        });

        // --- Debuff timeline target ---
        const selectedTarget = computed(() => {
            if (!targetId.value) return null;
            return actorManager.value.entityMap[targetId.value] ?? null;
        });

        // --- Tracked CC management (ordered list, persisted in localStorage) ---
        const CC_STORAGE_KEY = 'trackedDebuffCCIds';
        const PINNED_CC = 494; // always first, cannot be removed or moved
        const DEFAULT_CC_LIST = [
            494,                                          // pinned
            803,                                          // chart visible
            ...PLAYER_SIDE_CC_IDS,                        // 覺醒/戰吼 (party side)
            1026, 464, 578, 10001, 10002,                 // chart visible
            1164, 1165, 1166, 1093, 392, 912, 598, 1138, // coverage only
        ];
        const DEFAULT_CHART_HIDDEN_CC_LIST = [1164, 1165, 1166, 1093, 392, 912, 598, 1138];
        const loadTrackedCCs = (): number[] => {
            try {
                const raw = localStorage.getItem(CC_STORAGE_KEY);
                if (raw) {
                    const list: number[] = JSON.parse(raw);
                    // Ensure pinned CC is always first
                    if (!list.includes(PINNED_CC)) list.unshift(PINNED_CC);
                    else if (list[0] !== PINNED_CC) {
                        const idx = list.indexOf(PINNED_CC);
                        list.splice(idx, 1);
                        list.unshift(PINNED_CC);
                    }
                    // A saved list predating the party-side rows must still show
                    // them, or their lanes would have no settings entry again.
                    for (const id of PLAYER_SIDE_CC_IDS) {
                        if (!list.includes(id)) list.push(id);
                    }
                    return list;
                }
            } catch { /* ignore */ }
            return [...DEFAULT_CC_LIST];
        };
        const trackedCCIdList = ref<number[]>(loadTrackedCCs());

        const saveTrackedCCs = () => {
            localStorage.setItem(CC_STORAGE_KEY, JSON.stringify(trackedCCIdList.value));
        };
        const removeCC = (ccId: number) => {
            if (PLAYER_SIDE_CC_IDS.includes(ccId)) return;
            if (ccId === PINNED_CC) return;
            trackedCCIdList.value = trackedCCIdList.value.filter(id => id !== ccId);
            saveTrackedCCs();
        };
        const addCC = (ccId: number) => {
            if (trackedCCIdList.value.includes(ccId)) return;
            trackedCCIdList.value = [...trackedCCIdList.value, ccId];
            saveTrackedCCs();
        };

        const CHART_HIDDEN_KEY = 'chartHiddenCCIds';
        const loadChartHidden = (): Set<number> => {
            try {
                const raw = localStorage.getItem(CHART_HIDDEN_KEY);
                if (raw) return new Set(JSON.parse(raw) as number[]);
            } catch { /* ignore */ }
            return new Set(DEFAULT_CHART_HIDDEN_CC_LIST);
        };
        const chartHiddenCCIds = ref<Set<number>>(loadChartHidden());
        const saveChartHidden = () => {
            localStorage.setItem(CHART_HIDDEN_KEY, JSON.stringify([...chartHiddenCCIds.value]));
        };
        const toggleChartMode = (ccId: number) => {
            const next = new Set(chartHiddenCCIds.value);
            if (next.has(ccId)) next.delete(ccId); else next.add(ccId);
            chartHiddenCCIds.value = next;
            saveChartHidden();
        };

        const resetTrackedCCs = () => {
            trackedCCIdList.value = [...DEFAULT_CC_LIST];
            chartHiddenCCIds.value = new Set(DEFAULT_CHART_HIDDEN_CC_LIST);
            saveTrackedCCs();
            saveChartHidden();
        };

        // On version bump, if the user's saved list differs from current
        // defaults, offer to reset.
        const APP_VERSION_KEY = 'lastSeenAppVersion';
        const promptOnDefaultsChange = () => {
            const lastVersion = localStorage.getItem(APP_VERSION_KEY);
            const isFirstRun     = lastVersion === null;
            const versionChanged = lastVersion !== __APP_VERSION__;

            const trackedMatches = JSON.stringify(trackedCCIdList.value) === JSON.stringify(DEFAULT_CC_LIST);
            const sortedHidden = [...chartHiddenCCIds.value].sort((a, b) => a - b);
            const sortedDefaultHidden = [...DEFAULT_CHART_HIDDEN_CC_LIST].sort((a, b) => a - b);
            const hiddenMatches = JSON.stringify(sortedHidden) === JSON.stringify(sortedDefaultHidden);

            if (!isFirstRun && versionChanged && !(trackedMatches && hiddenMatches)) {
                const ok = window.confirm(
                    `你目前的 CC 追蹤清單與 v${__APP_VERSION__} 預設不同，要重置為預設值嗎？\n（會覆蓋目前儲存的追蹤項目）`
                );
                if (ok) resetTrackedCCs();
            }

            localStorage.setItem(APP_VERSION_KEY, __APP_VERSION__);
        };

        // Drag reorder state
        const dragIdx = ref(-1);
        const onDragStart = (idx: number) => { dragIdx.value = idx; };
        const onDragOver = (e: DragEvent, idx: number) => {
            e.preventDefault();
            if (dragIdx.value < 0 || idx === dragIdx.value) return;
            // Don't allow moving into position 0 (pinned) or moving the pinned item
            if (idx === 0 || dragIdx.value === 0) return;
            const list = [...trackedCCIdList.value];
            const [item] = list.splice(dragIdx.value, 1);
            list.splice(idx, 0, item);
            trackedCCIdList.value = list;
            dragIdx.value = idx;
        };
        const onDragEnd = () => { dragIdx.value = -1; saveTrackedCCs(); };

        // CCs not yet tracked, available to add. 出現過 on: only CCs seen on
        // the selected target this session (plus defaults). Off: the whole
        // condition catalogue, capped in the template via the overflow count.
        const addCCSearch = ref('');
        const showSeenOnly = ref(true);
        const ADD_LIST_MAX_ROWS = 300;
        const availableCCsAll = computed(() => {
            const tracked = new Set(trackedCCIdList.value);
            const ids = new Set<number>();
            if (selectedTarget.value) {
                for (const st of selectedTarget.value.conditionHistory) {
                    for (const c of st.List) {
                        if (!tracked.has(c.CCId)) ids.add(c.CCId);
                    }
                }
            }
            for (const id of DEFAULT_CC_LIST) {
                if (!tracked.has(id)) ids.add(id);
            }
            if (!showSeenOnly.value) {
                for (const k in condNameMap.value) {
                    const id = Number(k);
                    if (!tracked.has(id)) ids.add(id);
                }
            }
            // v-text-field's `clearable` sets the model to null on clear, so
            // guard against null/empty before lowercasing.
            const search = (addCCSearch.value ?? '').toLowerCase();
            return [...ids].sort((a, b) => a - b).filter(id => {
                if (!search) return true;
                const name = ccName(condNameMap.value, id) ?? '';
                return name.toLowerCase().includes(search) || String(id).includes(search);
            });
        });
        const availableCCs = computed(() => availableCCsAll.value.slice(0, ADD_LIST_MAX_ROWS));
        const availableCCsOverflow = computed(() =>
            Math.max(0, availableCCsAll.value.length - ADD_LIST_MAX_ROWS));

        return {
            isLoading,
            region,
            rootEl,
            narrow,

            pcEntities,
            pcRealNames,
            allApplyDamage,
            targetId,
            targetIdList,
            targetItemTitle,
            bossOnlyTarget,
            setBossOnlyTarget,
            hiddenArcana,
            toggleArcanaHidden,
            allArcanaHidden,
            toggleAllArcanaHidden,
            chartSheetEl,
            listEl,
            capturing,
            shotSnackbar,
            shotMessage,
            captureScreenshot,
            skillNameMap,
            condNameMap,
            entityMap: entityMapWithTargetData,
            chartHiddenCCIdList,
            partyActorList,
            fightStartAt,
            PLAYER_SIDE_CC_IDS,
            hiddenTrackIds,
            ccTrackId,
            togglePlayerSideTrack,
            showSeenOnly,
            availableCCsOverflow,
            actorOf,

            dpsChartEntities,
            selectedTarget,
            trackedCCIdList,
            removeCC,
            addCC,
            resetTrackedCCs,
            chartHiddenCCIds,
            toggleChartMode,
            addCCSearch,
            availableCCs,
            dragIdx,
            onDragStart,
            onDragOver,
            onDragEnd,
            PINNED_CC,
            DPS_WINDOW_SEC,

            showAttackerCumulativeChart,
            showAttackerDpsChart,
            showSkillDistribution,
            showSkillCumulativeChart,
            showSkillDpsChart,
            showSkillCountChart,
            showEntityDetailDamageList,
            showEntityAllDamageList,
            showConditionChart,
            DETAIL_COLUMNS,
            visibleDetailColumns,
            orderedDetailColumns,
            colDragIdx,
            onColDragStart,
            onColDragOver,
            onColDragEnd,
            skillGridColumns,
            skillRowLimit,
            setSkillRowLimit,
            showPetSkills,
            setShowPetSkills,
            resetSkillSettings,
            expandedSkillLists,
            toggleSkillList,
            visibleSkillRows,
            hiddenSkillColumns,
            toggleSkillColumn,
            pcNameWidth,
            pcDps,
            getMabiNameColor,
            humanReadableNumber,
            formatDuration,
            prettyEntityName: prettyName,
            ccIconUrl,
            ccName,
            arcanaIconUrl,
            arcanaTitle,
        }
    }
});

type EntityExtended = {
    actor: EntityActor,
    dc: DualGroupedDamageCollector,
    totalDamage: number,
    damages: EntityDamage[],
    groupedTotalDamages: Record<string, number>,
    groupedDamages: Record<string, EntityDamage[]>,
    groupedMinDamages: Record<string, number>,
    groupedMaxDamages: Record<string, number>,
    groupedCount: Record<string, number>,
    groupedCriticalCount: Record<string, number>,
};

type SkillRow = {
    skillId: number,
    skillName: string,
    damage: number,
    dps: number,
    count: number,
    min: number,
    max: number,
    crit: CritStats,
    /** Pre-formatted text per optional column, keyed by DETAIL_COLUMNS. */
    details: Record<string, string>,
};

type PcRow = EntityExtended & { skillRows: SkillRow[], musicCell: MusicBuffCell, arcana: number | null };


</script>
<style scoped>
/* One template shared by the header and every data row, with fixed columns —
   that is what keeps them aligned across rows and across open panels. */
.skill-grid__row {
    display: grid;
    grid-template-columns: var(--skill-grid-cols);
    align-items: center;
    column-gap: 4px;
}

.skill-grid__row > span,
.pc-row__num {
    position: relative;
    white-space: nowrap;
    text-align: right;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    font-variant-numeric: tabular-nums;
}

/* Only the character row. The skill grid takes its size from its own row rule
   below, so this selector must not be folded back into the shared one above. */
.pc-row__num {
    font-size: 16px;
}

/* Vuetify's own padding sits between the title and the first row; pa-3 put
   12px there, which read as a gap rather than as spacing. */
.skill-grid :deep(.v-expansion-panel-text__wrapper) {
    padding: 2px 8px 6px;
}

/* The name component carries two buttons of its own; without this they are a
   different size from the chart buttons beside them. */
.pc-row__btns :deep(.v-btn),
.v-expansion-panel-title :deep(.entity-alias__wrap .v-btn) {
    height: 24px;
    width: 24px;
    min-width: 24px;
    padding: 0;
}

/* Vuetify's 24px sides cost width the number columns need, and left the
   character row indented relative to the skill grid below it, which uses 8px.
   The extra top padding drops the text off the row's upper edge, where the
   20-24px icons beside it had left it sitting high. */
/* ONE block for both states. They drifted once — collapsed had no height, so
   it sat at its natural 34px (8px padding + the 26px arcana icon) while
   expanded was pinned to 30px, and every element in the row shifted a few px
   on toggle. Also overrides Vuetify's 16px/24px padding and its 48px/64px
   collapsed/expanded heights. */
.v-expansion-panel-title,
.v-expansion-panel--active > .v-expansion-panel-title:not(.v-expansion-panel-title--static) {
    padding: 8px 8px 0;
    height: 34px;
    min-height: 34px;
}

/* The share bar doubles as the gap between character rows, so its own margin
   is what sets that spacing. */
.pc-row__share {
    height: 5px;
    margin-bottom: 4px;
}

.skill-grid__row--head {
    height: 20px;
    padding: 0 4px;
    font-size: 0.75em;
    opacity: 0.55;
}

.skill-grid__row--data {
    position: relative;
    font-size: 15px;
    height: 32px;
    overflow: hidden;
    border-radius: 4px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.12);
    padding: 0 4px;
    margin-bottom: 4px;
}

/* Buttons carry their own min-height; without this they stretch the row and
   each row ends up as tall as whatever it happens to contain. */
.skill-grid__row--data .v-btn {
    height: 24px;
    width: 24px;
}

/* Two tiers of secondary content: count still reads as a figure, while the
   distribution detail and the chart buttons recede to the same faint level. */
.skill-grid__row .dim {
    opacity: 0.5;
}

.skill-grid__row .dim--faint,
.skill-grid__btns {
    opacity: 0.38;
}

/* Column rules: the grid already aligns, these only make it visible. */
.skill-grid__row > *:not(.skill-grid__fill) {
    border-left: 1px solid rgba(255, 255, 255, 0.18);
}

.skill-grid__row > *:first-child,
.skill-grid__row > .skill-grid__fill + * {
    border-left: none;
}

.skill-grid__btns {
    justify-content: flex-start;
}

/* One shape for every setting: label and hint on the left, control right. */
.setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 12px;
}

.setting-row__label {
    flex: 1;
    font-size: 0.8em;
}

.setting-row__hint {
    font-size: 0.85em;
    opacity: 0.55;
}

/* Vuetify's compact field and switch still reserve ~40px of control height,
   which made two one-line settings taller than the list below them. */
.setting-row :deep(.v-input__control),
.setting-row :deep(.v-field__input),
.setting-row :deep(.v-selection-control) {
    min-height: 26px;
}

.setting-row :deep(.v-field__input) {
    padding-top: 0;
    padding-bottom: 0;
}

.setting-row :deep(.v-input__details) {
    display: none;
}

/* Same reservation trap as .setting-row: the compact switch still holds ~40px
   of control height, which would double the subtitle row it sits in. */
.seen-switch :deep(.v-selection-control) {
    min-height: 20px;
}

/* The checkbox reserves ~40px of control height per row, which made the
   column drag list too tall to reorder comfortably. */
.col-drag-row {
    min-height: 24px;
}

.col-drag-row :deep(.v-selection-control) {
    min-height: 20px;
}

.skill-grid__more {
    padding: 2px 4px;
    font-size: 0.75em;
    opacity: 0.55;
    cursor: pointer;
    text-align: center;
}

.skill-grid__more:hover {
    opacity: 0.9;
}

.skill-grid__fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    opacity: 0.4;
    pointer-events: none;
}

.skill-grid__name,
.skill-grid__btns {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    white-space: nowrap;
}

/* The icon and the buttons must never absorb the squeeze — flex items shrink
   by default, which is what was clipping the icon. */
.skill-grid__name > img,
.skill-grid__btns > * {
    flex-shrink: 0;
}

/* And the label must be allowed to shrink, or its ellipsis never engages: a
   flex item's min-width is auto, so it refuses to go below its content. */
.skill-grid__name > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Reserve the width of all three buttons so a player without condition
   history does not pull the rest of the row left. */
.pc-row__btns {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 96px;
}

.pc-row__btns > * {
    flex-shrink: 0;
}

/* Same shrink trap as .skill-grid__name > img above: flex items shrink by
   default, which would squeeze this icon out behind the player name. */
.pc-row__arcana-icon {
    flex-shrink: 0;
    border-radius: 2px;
}
</style>
