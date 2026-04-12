<template>
    <v-sheet class="d-flex align-center ma-2 flex-wrap" style="gap: 8px;">
        <v-select v-model="targetId" :items="targetIdList"
            :item-title="vv => `${vv[0] ? prettyEntityName(entityMap[vv[0]]?.actor) : 'all'} ${humanReadableNumber(vv[1] || 0)}`"
            :item-value="vv => vv[0]" variant="outlined" density="compact" hide-details style="flex: 1; min-width: 150px;">
        </v-select>
        <v-btn @click="showCumulativeChart" color="primary" size="small" prepend-icon="mdi-chart-bar">
            Cumulative</v-btn>
        <v-btn @click="showDpsChart" color="primary" size="small" prepend-icon="mdi-chart-bar">
            DPS</v-btn>
    </v-sheet>

    <!-- DPS + Debuff unified chart with shared X axis -->
    <v-sheet v-if="dpsChartEntities.length > 0" class="mx-2 mt-1" style="border: 1px solid #2a2a2a; border-radius: 4px; overflow: hidden;">
        <v-sheet class="d-flex align-center px-3 py-1" style="font-size: 0.8em; color: #888; background: #1a1a1a;">
            <span>DPS (15s, excl. pets) + Debuff Timeline</span>
            <v-spacer />
            <v-menu :close-on-content-click="false">
                <template v-slot:activator="{ props: menuProps }">
                    <v-btn v-bind="menuProps" icon="mdi-cog" size="x-small" variant="text" density="compact" />
                </template>
                <v-card width="320" style="background: #1e1e1e;">
                    <!-- Enabled list (draggable) -->
                    <v-card-subtitle class="px-3 pt-3 pb-1" style="font-size: 0.75em;">Enabled (drag to reorder)</v-card-subtitle>
                    <div style="max-height: 240px; overflow-y: auto;">
                        <div v-for="(ccId, idx) in trackedCCIdList" :key="ccId"
                            class="d-flex align-center px-3 py-1"
                            :draggable="ccId !== PINNED_CC"
                            :style="{
                                cursor: ccId === PINNED_CC ? 'default' : 'grab',
                                opacity: dragIdx === idx ? 0.4 : 1,
                                background: dragIdx === idx ? '#333' : 'transparent',
                            }"
                            @dragstart="onDragStart(idx)"
                            @dragover="onDragOver($event, idx)"
                            @dragend="onDragEnd">
                            <v-icon v-if="ccId === PINNED_CC" icon="mdi-lock" size="x-small" class="mr-1" style="opacity:0.4" />
                            <v-icon v-else icon="mdi-drag-horizontal-variant" size="x-small" class="mr-1" style="opacity:0.4" />
                            <img width="16" height="16" class="mr-2"
                                :src="`/res/characterconditionimage/${region}/${ccId}/${ccId}.png`"
                                style="border-radius:2px;" />
                            <span style="font-size: 0.82em; flex: 1;">{{ condNameMap[ccId] ?? `CC ${ccId}` }}</span>
                            <v-btn v-if="ccId !== PINNED_CC" icon="mdi-close" size="x-small" variant="text"
                                density="compact" @click.stop="removeCC(ccId)" />
                        </div>
                    </div>
                    <!-- Add new -->
                    <v-divider class="my-1" />
                    <v-card-subtitle class="px-3 pt-1 pb-1" style="font-size: 0.75em;">Add condition</v-card-subtitle>
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
                                :src="`/res/characterconditionimage/${region}/${ccId}/${ccId}.png`"
                                style="border-radius:2px;" />
                            <span style="font-size: 0.82em;">{{ condNameMap[ccId] ?? `CC ${ccId}` }}</span>
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
            :bin-seconds="15"
            :tracked-c-c-ids="trackedCCIdList" />
    </v-sheet>

    <v-expansion-panels multiple v-for="v in pcEntities" v-bind:key="v.actor.id">
        <template v-if="v.totalDamage > 0">
            <v-expansion-panel>
                <v-expansion-panel-title>
                    <div class="d-flex align-center" style="width: 100%; gap: 4px;">
                        <span class="font-weight-medium">{{ prettyEntityName(v.actor) }}</span>
                        <v-btn v-if="v.actor.conditionHistory.length > 0"
                            @click.stop="showConditionChart(v.actor)" size="x-small" icon="mdi-chart-timeline" variant="text" />
                        <v-tooltip text="Cumulative"><template v-slot:activator="{ props: tp }">
                            <v-btn v-bind="tp" @click.stop="showAttackerCumulativeChart(v)" size="x-small" icon="mdi-chart-bar" variant="text" />
                        </template></v-tooltip>
                        <v-tooltip text="DPS"><template v-slot:activator="{ props: tp }">
                            <v-btn v-bind="tp" @click.stop="showAttackerDpsChart(v)" size="x-small" icon="mdi-chart-bar" variant="text" />
                        </template></v-tooltip>
                        <v-spacer />
                        <span style="min-width: 48px; text-align: center; font-size: 0.85em; opacity: 0.7;">{{ formatDuration(v.damages.length >= 2 ? v.damages[v.damages.length - 1].At - v.damages[0].At : 0) }}</span>
                        <span style="min-width: 80px; text-align: center; color: #FFD54F;">{{ humanReadableNumber(v.totalDamage) }}</span>
                        <span style="min-width: 80px; text-align: center; color: #42A5F5;">{{ humanReadableNumber(v.damages.length >= 2 && v.damages[v.damages.length - 1].At > v.damages[0].At ? v.totalDamage / (v.damages[v.damages.length - 1].At - v.damages[0].At) : 0) }}</span>
                        <span style="min-width: 56px; text-align: center; color: #66BB6A;">{{ (100 * v.totalDamage / allApplyDamage).toFixed(1) }}%</span>
                    </div>
                </v-expansion-panel-title>
                <v-expansion-panel-text class="pa-3">
                    <v-sheet
                        v-for="[skillId, damageBySkill] in Object.entries(v.groupedTotalDamages).sort(([, av], [_, bv]) => bv - av)"
                        v-bind:key="skillId" class="mb-2"
                        style="position: relative; overflow: hidden; border-radius: 4px; cursor: pointer; background: rgba(255,255,255,0.12);"
                        @click.stop="showEntityDetailDamageList(v.actor.id, targetId, +skillId)">
                        <!-- bar fill -->
                        <div :style="{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(100 * damageBySkill / v.totalDamage)}%`, background: getMabiNameColor(skillNameMap[+skillId] || `unknownSkill:${skillId}`), opacity: 0.4 }" />
                        <!-- row 1: icon, name, buttons, damage, % -->
                        <div class="d-flex align-center pa-1" style="position: relative; gap: 4px;">
                            <img width="28" height="28" :src="`/res/skillimage/${region}/${skillId}/${skillId}.png`" style="border-radius: 2px;" />
                            <span class="font-weight-medium">{{ skillNameMap[+skillId] || `unknownSkill:${skillId}` }}</span>
                            <v-tooltip text="Distribution"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillDistribution(v, +skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-tooltip text="Cumulative"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillCumulativeChart(v, +skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-tooltip text="DPS"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillDpsChart(v, +skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-tooltip text="Count"><template v-slot:activator="{ props: tp }">
                                <v-btn v-bind="tp" @click.stop="showSkillCountChart(v, +skillId)" size="x-small" icon="mdi-chart-bar" variant="text" density="compact" />
                            </template></v-tooltip>
                            <v-spacer />
                            <span style="min-width: 80px; text-align: center; color: #FFD54F;">{{ humanReadableNumber(damageBySkill) }}</span>
                            <span style="min-width: 80px; text-align: center; color: #42A5F5;">{{ humanReadableNumber(arrayDps(damageBySkill, v.groupedDamages[+skillId])) }}</span>
                            <span style="min-width: 56px; text-align: center; color: #66BB6A;">{{ (100 * damageBySkill / v.totalDamage).toFixed(1) }}%</span>
                        </div>
                        <!-- row 2: detailed stats -->
                        <div class="d-flex pa-1 pl-9" style="position: relative; gap: 8px; font-size: 0.8em; opacity: 0.8;">
                            <span>count: {{ v.groupedCount[+skillId] }}</span>
                            <span>crit: {{ v.groupedCriticalCount[+skillId] }}</span>
                            <span>avg: {{ humanReadableNumber(v.groupedCount[+skillId] ? damageBySkill / v.groupedCount[+skillId] : 0) }}</span>
                            <span>min: {{ humanReadableNumber(v.groupedMinDamages[+skillId] || 0) }}</span>
                            <span>max: {{ humanReadableNumber(v.groupedMaxDamages[+skillId] || 0) }}</span>
                        </div>
                    </v-sheet>
                </v-expansion-panel-text>
            </v-expansion-panel>
            <v-sheet width="100%" class="mb-2"
                style="position: relative; overflow: hidden; border-radius: 4px; cursor: pointer; background: rgba(255,255,255,0.12);"
                @click.stop="showEntityAllDamageList(v.actor.id)">
                <div :style="{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(100 * v.totalDamage / allApplyDamage)}%`, background: getMabiNameColor(prettyEntityName(v.actor)!), opacity: 0.4 }" />
                <div class="d-flex align-center pa-1" style="position: relative; gap: 4px;">
                    <span class="font-weight-medium">{{ prettyEntityName(v.actor) }}</span>
                    <v-spacer />
                    <span style="min-width: 80px; text-align: center; color: #FFD54F;">{{ humanReadableNumber(v.totalDamage) }}</span>
                    <span style="min-width: 80px; text-align: center; color: #42A5F5;">{{ humanReadableNumber(arrayDps(v.totalDamage, v.damages)) }}</span>
                    <span style="min-width: 56px; text-align: center; color: #66BB6A;">{{ (100 * v.totalDamage / allApplyDamage).toFixed(1) }}%</span>
                </div>
            </v-sheet>
        </template>

    </v-expansion-panels>


</template>

<script lang="ts">
import { defineComponent, inject, ref, computed, onUnmounted, onMounted, type Ref } from "vue";

import { getMabiNameColor, prettyEntityName, humanReadableNumber, formatDuration } from '@/lib/util';
import type { EntityDamage, EntityActor } from '@/eventActor';
import { DamageCollectorBase, DualGroupedDamageCollector, GroupedDamageCollector } from '@/actionCollector';
import { useDialogStack } from '@/lib/useDialogStack';
import { filterByTimeRange, computeGroupedStats } from '@/lib/timeRangeFilter';

import ConditionChart from '@/components/subComponents/conditionChart.vue';
import DamageChart from '@/components/subComponents/damageChart.vue';
import DamageDistribution from '@/components/subComponents/damageDistribution.vue';
import DamageList from '@/components/subComponents/damageList.vue';
import DpsDebuffChart from '@/components/subComponents/dpsDebuffChart.vue';

export default defineComponent({
    components: {
        DpsDebuffChart,
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

        onUnmounted(() => {
            appEvent.value.removeEventListener('clear', clearTarget);

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

                m[k] = {
                    actor: v,
                    dc: getDC(k),
                }
            }

            return m;
        });

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

        const pcEntities = computed(() =>
            Object.values(entityMapWithTargetData.value).filter(v => v.actor.isPC).sort((a, b) => b.totalDamage - a.totalDamage));

        const targetId = ref('');
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
                return list;
            }

            const list = Object.entries(targetDC.value.groupedTotalDamages)
                .sort(([, av], [, bv]) => bv - av);

            list.unshift(['', targetDC.value.totalDamage]);

            return list;
        });

        const clearTarget = () => {
            targetId.value = '';
        }

        const getChartEntities = () =>
            pcEntities.value.filter(v => v.totalDamage > 10000).map(v => ({ name: prettyName(v.actor)!, damages: v.damages }));

        const getTargetTitle = () =>
            targetId.value ? prettyName(entityMap.value[targetId.value]?.actor) || targetId.value : 'All';

        const showCumulativeChart = () => {
            dialogStack.open(DamageChart, {
                entities: getChartEntities(),
                mode: 'cumulative',
            }, `Cumulative - ${getTargetTitle()}`);
        }

        const showDpsChart = () => {
            dialogStack.open(DamageChart, {
                entities: getChartEntities(),
                mode: 'dps',
            }, `DPS - ${getTargetTitle()}`);
        }

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
        })

        const allApplyDamage = computed(() =>
            pcEntities.value.reduce((acc, v) => acc + v.totalDamage, 0));

        const arrayDps = (totalDamage: number, damages: EntityDamage[]) => {
            if (!damages || damages.length < 2) return 0;
            const duration = damages[damages.length - 1].At - damages[0].At;
            return duration > 0 ? totalDamage / duration : 0;
        };

        const prettyName = (entity?: EntityActor) => prettyEntityName(entity, raceNameMap);

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
            494, 182, 323, 351, 392, 464, 515, 598, 803,
            912, 1012, 1014, 1026, 1092, 1093, 1138, 10001, 10002,
        ];
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
            if (ccId === PINNED_CC) return;
            trackedCCIdList.value = trackedCCIdList.value.filter(id => id !== ccId);
            saveTrackedCCs();
        };
        const addCC = (ccId: number) => {
            if (trackedCCIdList.value.includes(ccId)) return;
            trackedCCIdList.value = [...trackedCCIdList.value, ccId];
            saveTrackedCCs();
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

        // CCs not yet tracked, available to add
        const addCCSearch = ref('');
        const availableCCs = computed(() => {
            const tracked = new Set(trackedCCIdList.value);
            const ids = new Set<number>();
            // From current target's history
            if (selectedTarget.value) {
                for (const st of selectedTarget.value.conditionHistory) {
                    for (const c of st.List) {
                        if (!tracked.has(c.CCId)) ids.add(c.CCId);
                    }
                }
            }
            // From default list
            for (const id of DEFAULT_CC_LIST) {
                if (!tracked.has(id)) ids.add(id);
            }
            const search = addCCSearch.value.toLowerCase();
            return [...ids].sort((a, b) => a - b).filter(id => {
                if (!search) return true;
                const name = (condNameMap.value as any)?.[id] ?? `CC ${id}`;
                return name.toLowerCase().includes(search) || String(id).includes(search);
            });
        });

        return {
            isLoading,
            region,

            pcEntities,
            allApplyDamage,
            targetId,
            targetIdList,
            skillNameMap,
            condNameMap,
            entityMap: entityMapWithTargetData,

            dpsChartEntities,
            selectedTarget,
            trackedCCIdList,
            removeCC,
            addCC,
            addCCSearch,
            availableCCs,
            dragIdx,
            onDragStart,
            onDragOver,
            onDragEnd,
            PINNED_CC,

            showCumulativeChart,
            showDpsChart,
            showAttackerCumulativeChart,
            showAttackerDpsChart,
            showSkillDistribution,
            showSkillCumulativeChart,
            showSkillDpsChart,
            showSkillCountChart,
            showEntityDetailDamageList,
            showEntityAllDamageList,
            showConditionChart,
            arrayDps,
            getMabiNameColor,
            humanReadableNumber,
            formatDuration,
            prettyEntityName: prettyName,
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


</script>