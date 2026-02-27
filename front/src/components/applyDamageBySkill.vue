<template>
    <v-sheet class="d-flex align-center ma-2" style="gap: 8px;">
        <v-select v-model="targetId" :items="targetIdList"
            :item-title="vv => `${vv[0] ? prettyEntityName(entityMap[vv[0]]?.actor) : 'all'} ${vv[1]?.toFixed(0)}`"
            :item-value="vv => vv[0]" variant="outlined" density="compact" hide-details style="flex: 1;">
        </v-select>
        <v-btn @click="showCumulativeChart" color="primary" size="small" prepend-icon="mdi-chart-bar">
            Cumulative</v-btn>
        <v-btn @click="showDpsChart" color="primary" size="small" prepend-icon="mdi-chart-bar">
            DPS</v-btn>
    </v-sheet>

    <v-expansion-panels multiple v-for="v in pcEntities" v-bind:key="v.actor.id">
        <template v-if="v.totalDamage > 0">
            <v-expansion-panel>
                <v-expansion-panel-title>
                    <v-sheet class="d-flex align-center" style="gap: 8px;">
                        <span>{{ prettyEntityName(v.actor) }} {{ v.totalDamage.toFixed(0) }} {{ (100 * v.totalDamage /
                            allApplyDamage).toFixed(1) }}% dps {{ v.damages.length < 2 ? 0 : Math.round(v.totalDamage /
                            (v.damages[v.damages.length - 1].At - v.damages[0].At)) }}</span>
                        <v-tooltip text="Cumulative"><template v-slot:activator="{ props: tp }">
                            <v-btn v-bind="tp" @click.stop="showAttackerCumulativeChart(v)" size="x-small" icon="mdi-chart-bar" variant="text" />
                        </template></v-tooltip>
                        <v-tooltip text="DPS"><template v-slot:activator="{ props: tp }">
                            <v-btn v-bind="tp" @click.stop="showAttackerDpsChart(v)" size="x-small" icon="mdi-chart-bar" variant="text" />
                        </template></v-tooltip>
                    </v-sheet>
                </v-expansion-panel-title>
                <v-expansion-panel-text class="pa-3">
                    <v-sheet
                        v-for="[skillId, damageBySkill] in Object.entries(v.groupedTotalDamages).sort(([, av], [_, bv]) => bv - av)"
                        v-bind:key="skillId" class="mb-2"
                        style="position: relative; overflow: hidden; border-radius: 4px; cursor: pointer; background: rgba(255,255,255,0.12);"
                        @click.stop="showEntityDetailDamageList(v.actor.id, targetId, +skillId)">
                        <!-- bar fill -->
                        <div :style="{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(100 * damageBySkill / v.totalDamage)}%`, background: getMabiNameColor(skillNameMap[+skillId] || `unknownSkill:${skillId}`), opacity: 0.4 }" />
                        <!-- row 1: icon, name, damage, %, buttons -->
                        <div class="d-flex align-center pa-1" style="position: relative; gap: 4px;">
                            <img width="28" height="28" :src="`/res/skillimage/${region}/${skillId}/${skillId}.png`" style="border-radius: 2px;" />
                            <span class="font-weight-medium">{{ skillNameMap[+skillId] || `unknownSkill:${skillId}` }}</span>
                            <v-spacer />
                            <span>{{ damageBySkill.toFixed(0) }}</span>
                            <span style="min-width: 48px; text-align: right;">{{ (100 * damageBySkill / v.totalDamage).toFixed(1) }}%</span>
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
                        </div>
                        <!-- row 2: detailed stats -->
                        <div class="d-flex pa-1 pl-9" style="position: relative; gap: 8px; font-size: 0.8em; opacity: 0.8;">
                            <span>count: {{ v.groupedCount[+skillId] }}</span>
                            <span>crit: {{ v.groupedCriticalCount[+skillId] }}</span>
                            <span>avg: {{ (v.groupedCount[+skillId] ? damageBySkill / v.groupedCount[+skillId] : 0).toFixed(0) }}</span>
                            <span>min: {{ v.groupedMinDamages[+skillId]?.toFixed(0) || '0' }}</span>
                            <span>max: {{ v.groupedMaxDamages[+skillId]?.toFixed(0) || '0' }}</span>
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
                    <span>{{ v.totalDamage.toFixed(0) }}</span>
                    <span style="min-width: 48px; text-align: right;">{{ (100 * v.totalDamage / allApplyDamage).toFixed(1) }}%</span>
                </div>
            </v-sheet>
        </template>

    </v-expansion-panels>


</template>

<script lang="ts">
import { defineComponent, inject, ref, computed, onUnmounted, onMounted, type Ref } from "vue";

import { getMabiNameColor, prettyEntityName } from '@/lib/util';
import type { EntityDamage, EntityActor } from '@/eventActor';
import { DamageCollectorBase, DualGroupedDamageCollector, GroupedDamageCollector } from '@/actionCollector';
import { useDialogStack } from '@/lib/useDialogStack';
import { filterByTimeRange, computeGroupedStats } from '@/lib/timeRangeFilter';

import DamageChart from '@/components/subComponents/damageChart.vue';
import DamageDistribution from '@/components/subComponents/damageDistribution.vue';
import DamageList from '@/components/subComponents/damageList.vue';

export default defineComponent({
    components: {
    },
    setup() {
        const isLoading = inject('isLoading');
        const region = inject('region');
        const raceNameMap = inject('raceNameMap');
        const skillNameMap = inject('skillNameMap');
        const appEvent = inject('appEvent');
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

        const prettyName = (entity?: EntityActor) => prettyEntityName(entity, raceNameMap);

        return {
            isLoading,
            region,

            pcEntities,
            allApplyDamage,
            targetId,
            targetIdList,
            skillNameMap,
            entityMap: entityMapWithTargetData,

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
            getMabiNameColor,
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