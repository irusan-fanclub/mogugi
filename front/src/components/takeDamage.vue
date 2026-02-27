<template>
    <v-expansion-panels multiple
        v-for="v in Object.values(filteredGroupMap).sort((a, b) => b.totalDamage - a.totalDamage)"
        v-bind:key="v.actor.id">
        <template v-if="v.totalDamage > 0">
            <v-expansion-panel>
                <v-expansion-panel-title>
                    <v-sheet>
                        {{ prettyEntityName(v.actor) }} {{ v.totalDamage.toFixed(0) }}
                    </v-sheet>

                </v-expansion-panel-title>
                <v-expansion-panel-text class="pa-3">
                    <template v-for="entity, entityk in v.entity" v-bind:key="entityk">
                        <template v-if="entity.totalDamage > 0">
                            <v-sheet>
                                * {{ prettyEntityName(entity.actor) }} {{ entity.totalDamage.toFixed(0) }}
                                {{ entity.actor.finisherId ? `Killed by
                                ${prettyEntityName(entityMap[entity.actor.finisherId]?.actor) ||
                                    entity.actor.finisherId}` : '' }}
                                <condition-image-list :conditions="Object.values(entity.actor.conditionMap)" />
                            </v-sheet>

                            <v-sheet
                                v-for="[attackerId, damageByAttacker] in Object.entries(entity.groupedTotalDamages).sort(([, av], [, bv]) => bv - av)"
                                v-bind:key="attackerId" width="100%" class="mb-2"
                                style="position: relative; overflow: hidden; border-radius: 4px; cursor: pointer;"
                                @click.stop="showEntityDetailDamageList(entity.actor.id, attackerId)">
                                <div :style="{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(100 * damageByAttacker / entity.totalDamage)}%`, background: getMabiNameColor(prettyEntityName(entityMap[attackerId]?.actor) || attackerId), opacity: 0.4 }" />
                                <div class="d-flex align-center pa-1" style="position: relative; gap: 4px;">
                                    <span class="font-weight-medium">{{ prettyEntityName(entityMap[attackerId]?.actor) || attackerId }}</span>
                                    <v-spacer />
                                    <span>{{ damageByAttacker.toFixed(0) }}</span>
                                    <span style="min-width: 48px; text-align: right;">{{ (100 * damageByAttacker / entity.totalDamage).toFixed(1) }}%</span>
                                </div>
                            </v-sheet>
                        </template>
                    </template>
                </v-expansion-panel-text>
            </v-expansion-panel>
            <v-sheet
                v-for="[attackerId, damageByAttacker] in Object.entries(v.groupedTotalDamages).sort(([, av], [, bv]) => bv - av)"
                v-bind:key="attackerId" width="100%" class="mb-2"
                style="position: relative; overflow: hidden; border-radius: 4px; cursor: pointer;"
                @click.stop="showEntityGroupDetailDamageList(v.actor.id, attackerId)">
                <div :style="{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(100 * damageByAttacker / v.totalDamage)}%`, background: getMabiNameColor(prettyEntityName(entityMap[attackerId]?.actor) || attackerId), opacity: 0.4 }" />
                <div class="d-flex align-center pa-1" style="position: relative; gap: 4px;">
                    <span class="font-weight-medium">{{ prettyEntityName(entityMap[attackerId]?.actor) || attackerId }}</span>
                    <v-spacer />
                    <span>{{ damageByAttacker.toFixed(0) }}</span>
                    <span style="min-width: 48px; text-align: right;">{{ (100 * damageByAttacker / v.totalDamage).toFixed(1) }}%</span>
                </div>
            </v-sheet>
        </template>

    </v-expansion-panels>


</template>

<script lang="ts">
import { defineComponent, inject, computed, onUnmounted, type Ref } from "vue";

import { getMabiNameColor, prettyEntityName } from '@/lib/util';
import type { EntityDamage, EntityActor } from '@/eventActor';
import { GroupActor } from '@/eventActor';
import { GroupedDamageCollector } from '@/actionCollector';
import { useDialogStack } from '@/lib/useDialogStack';
import { filterByTimeRange, computeGroupedStats } from '@/lib/timeRangeFilter';

import ConditionImageList from "./subComponents/conditionImageList.vue";
import DamageList from "./subComponents/damageList.vue";

export default defineComponent({
    components: {
        ConditionImageList,
    },
    setup() {
        const isLoading = inject('isLoading');
        const region = inject('region');
        const raceNameMap = inject('raceNameMap');
        const skillNameMap = inject('skillNameMap');
        const condNameMap = inject('condNameMap');
        const actorManager = inject('actorManager');
        const dcManager = inject('dcManager');
        const timeRangeMin = inject('timeRangeMin') as Ref<number | null>;
        const timeRangeMax = inject('timeRangeMax') as Ref<number | null>;

        const damageCollectorMap: Record<string, GroupedDamageCollector> = {};

        onUnmounted(() => {
            for (const v of Object.values(damageCollectorMap)) {
                dcManager.value.removeDamageCollector(v);
            }
        });

        const getGroupDC = (groupActor: GroupActor) => {
            const key = `group:${groupActor.id}`;
            if (damageCollectorMap[key]) {
                return damageCollectorMap[key];
            }

            const dc = dcManager.value.getGroupedDamageCollector(v => !!groupActor.entityMap[v.TargetId], v => v.Id);
            damageCollectorMap[key] = dc;

            return dc;
        }

        const getSingleDC = (targetId: string) => {
            const key = `${targetId}`;
            if (damageCollectorMap[key]) {
                return damageCollectorMap[key];
            }

            const dc = dcManager.value.getGroupedDamageCollector(v => v.TargetId == targetId, v => v.Id);
            damageCollectorMap[key] = dc;

            return dc;
        }

        const dialogStack = useDialogStack();

        const showEntityDetailDamageList = (targetId: string, attackerId: string) => {
            const entity = filteredGroupMap.value;
            // find the entity across all groups
            for (const gk in entity) {
                const e = entity[gk].entity[targetId];
                if (e) {
                    const attackerName = prettyName(entityMap.value[attackerId]?.actor) || attackerId;
                    const targetName = prettyName(e.actor)!;
                    dialogStack.open(DamageList, {
                        attackerName,
                        targetName,
                        damages: e.groupedDamages[attackerId],
                    }, `${attackerName} → ${targetName}`);
                    return;
                }
            }
        }

        const showEntityGroupDetailDamageList = (targetId: string, attackerId: string) => {
            const group = filteredGroupMap.value[targetId];
            if (!group) {
                return;
            }

            const attackerName = prettyName(entityMap.value[attackerId]?.actor) || attackerId;
            const targetName = prettyName(group.actor)!;
            dialogStack.open(DamageList, {
                attackerName,
                targetName,
                damages: group.groupedDamages[attackerId],
            }, `${attackerName} → ${targetName}`);
        }

        const entityMap = computed(() => {
            const m: Record<string, { actor: EntityActor, dc: GroupedDamageCollector }> = {};

            for (const k in actorManager.value.entityMap) {
                const v = actorManager.value.entityMap[k];

                m[k] = {
                    actor: v,
                    dc: getSingleDC(k),
                }
            }

            return m;
        });

        const groupMap = computed(() => {
            const m: Record<string, {
                actor: GroupActor,
                dc: GroupedDamageCollector,
                entity: Record<string, { actor: EntityActor, dc: GroupedDamageCollector }>,
            }> = {};

            for (const k in actorManager.value.groupMap) {
                const v = actorManager.value.groupMap[k];
                const entity: Record<string, { actor: EntityActor, dc: GroupedDamageCollector }> = {};

                for (const ek in v.entityMap) {
                    entity[ek] = entityMap.value[ek];
                }

                m[k] = {
                    actor: v,
                    dc: getGroupDC(v),
                    entity,
                }
            }

            return m;
        });

        type FilteredEntry = {
            totalDamage: number,
            groupedTotalDamages: Record<string, number>,
            groupedDamages: Record<string, EntityDamage[]>,
        };

        type FilteredGroupEntry = FilteredEntry & {
            actor: GroupActor,
            dc: GroupedDamageCollector,
            entity: Record<string, FilteredEntry & { actor: EntityActor, dc: GroupedDamageCollector }>,
        };

        const filteredGroupMap = computed(() => {
            const minAt = timeRangeMin.value;
            const maxAt = timeRangeMax.value;
            const hasFilter = minAt !== null && maxAt !== null;

            const m: Record<string, FilteredGroupEntry> = {};

            for (const k in groupMap.value) {
                const v = groupMap.value[k];

                const filteredEntity: Record<string, FilteredEntry & { actor: EntityActor, dc: GroupedDamageCollector }> = {};
                for (const ek in v.entity) {
                    const e = v.entity[ek];
                    if (hasFilter) {
                        const damages = filterByTimeRange(e.dc.damages, minAt, maxAt);
                        const stats = computeGroupedStats(damages, d => d.Id);
                        filteredEntity[ek] = { ...e, totalDamage: stats.totalDamage, groupedTotalDamages: stats.groupedTotalDamages, groupedDamages: stats.groupedDamages };
                    } else {
                        filteredEntity[ek] = { ...e, totalDamage: e.dc.totalDamage, groupedTotalDamages: e.dc.groupedTotalDamages, groupedDamages: e.dc.groupedDamages };
                    }
                }

                if (hasFilter) {
                    const damages = filterByTimeRange(v.dc.damages, minAt, maxAt);
                    const stats = computeGroupedStats(damages, d => d.Id);
                    m[k] = { ...v, totalDamage: stats.totalDamage, groupedTotalDamages: stats.groupedTotalDamages, groupedDamages: stats.groupedDamages, entity: filteredEntity };
                } else {
                    m[k] = { ...v, totalDamage: v.dc.totalDamage, groupedTotalDamages: v.dc.groupedTotalDamages, groupedDamages: v.dc.groupedDamages, entity: filteredEntity };
                }
            }

            return m;
        });

        const prettyName = (entity?: EntityActor | GroupActor) => prettyEntityName(entity, raceNameMap);

        return {
            isLoading,
            region,

            skillNameMap,
            condNameMap,
            entityMap,
            filteredGroupMap,

            showEntityDetailDamageList,
            showEntityGroupDetailDamageList,
            getMabiNameColor,
            prettyEntityName: prettyName,
            getGroupDC,
            getSingleDC,
        }
    }
});

</script>