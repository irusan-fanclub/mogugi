<template>
    <v-expansion-panels multiple
        v-for="v in Object.values(groupMap).sort((a, b) => b.dc.totalDamage - a.dc.totalDamage)"
        v-bind:key="v.actor.id">
        <template v-if="v.dc.totalDamage > 0">
            <v-expansion-panel>
                <v-expansion-panel-title>
                    <v-sheet>
                        {{ prettyEntityName(v.actor) }} {{ v.dc.totalDamage.toFixed(0) }}
                    </v-sheet>

                </v-expansion-panel-title>
                <v-expansion-panel-text class="pa-3">
                    <template v-for="entity, entityk in v.entity" v-bind:key="entityk">
                        <template v-if="entity.dc.totalDamage > 0">
                            <v-sheet>
                                * {{ prettyEntityName(entity.actor) }} {{ entity.dc.totalDamage.toFixed(0) }}
                                {{ entity.actor.finisherId ? `Killed by
                                ${prettyEntityName(entityMap[entity.actor.finisherId]?.actor) ||
                                    entity.actor.finisherId}` : '' }}
                                <template v-for="cond in entity.actor.conditionMap" v-bind:key="cond.CCId">
                                    <img width="16" height="16"
                                        @mouseover="e => setCondTooltip(e.target! as HTMLElement, cond)"
                                        @mouseleave="e => setCondTooltip(e.target! as HTMLElement, undefined)"
                                        @click="e => setCondTooltip(e.target! as HTMLElement, cond)"
                                        :src='`/res/characterconditionimage/${region}/${cond.CCId}/${cond.CCId}.png`' />
                                </template>
                            </v-sheet>

                            <v-sheet
                                v-for="[attackerId, damageByAttacker] in Object.entries(entity.dc.groupedTotalDamages).sort(([, av], [, bv]) => bv - av)"
                                v-bind:key="attackerId" width="100%" class="mb-4">
                                <!-- Name -->
                                <v-sheet width="100%"
                                    @click.stop="showEntityDetailDamageList(entity.actor.id, attackerId)">
                                    {{ prettyEntityName(entityMap[attackerId]?.actor) || attackerId }} {{
                                        damageByAttacker.toFixed(0) }} {{
                                        (100 * damageByAttacker / entity.dc.totalDamage).toFixed(1) }}%
                                </v-sheet>

                                <!-- Bar -->
                                <v-sheet width="100%" height="16">
                                    <v-sheet @click.stop="showEntityDetailDamageList(entity.actor.id, attackerId)"
                                        :color="getMabiNameColor(prettyEntityName(entityMap[attackerId]?.actor) || attackerId)"
                                        height="100%"
                                        :width="`${Math.round(100 * damageByAttacker / entity.dc.totalDamage).toFixed(0)}%`"
                                        class="rounded-xl">
                                    </v-sheet>
                                </v-sheet>
                            </v-sheet>
                        </template>
                    </template>
                </v-expansion-panel-text>
            </v-expansion-panel>
            <v-sheet
                v-for="[attackerId, damageByAttacker] in Object.entries(v.dc.groupedTotalDamages).sort(([, av], [, bv]) => bv - av)"
                v-bind:key="attackerId" width="100%" class="mb-4 pa-1">
                <!-- Name -->
                <v-sheet width="100%" @click.stop="showEntityGroupDetailDamageList(v.actor.id, attackerId)">
                    {{ prettyEntityName(entityMap[attackerId]?.actor) || attackerId }} {{ damageByAttacker.toFixed(0) }}
                    {{
                        (100 * damageByAttacker / v.dc.totalDamage).toFixed(1) }}%
                </v-sheet>

                <!-- Bar -->
                <v-sheet width="100%" height="16">
                    <v-sheet @click.stop="showEntityGroupDetailDamageList(v.actor.id, attackerId)"
                        :color="getMabiNameColor(prettyEntityName(entityMap[attackerId]?.actor) || attackerId)"
                        height="100%" :width="`${Math.round(100 * damageByAttacker / v.dc.totalDamage).toFixed(0)}%`"
                        class="rounded-xl">
                    </v-sheet>
                </v-sheet>
            </v-sheet>
        </template>

    </v-expansion-panels>

    <v-dialog v-model="detailDialog" min-width="60vw" height="90svh">
        <v-card>
            <v-card-text class="pa-0">
                <damage-list :attacker-name="detailDialogData?.attackerName || ''"
                :target-name="detailDialogData?.targetName || ''" :damages="detailDialogData?.Damages || []" />
            </v-card-text>
            <v-card-actions>
                <v-btn color="primary" block @click="detailDialog = false">Close</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
    <v-tooltip v-if="condTooltip" v-model="condTooltipValue" :activator="condTooltipParent">
        {{ condNameMap[condTooltip.CCId] }}
    </v-tooltip>
</template>

<script lang="ts">
import { defineComponent, inject, ref, computed, onUnmounted } from "vue";

import { getMabiNameColor } from '@/util';
import { EntityDamage, EntityCondition, ActorManager, BaseActor, GroupActor, EntityActor } from '@/eventActor';
import { GroupedDamageCollector } from '@/actionCollector';

import DamageList from "./subComponents/damageList.vue";

export default defineComponent({
    components: {
        DamageList,
    },
    setup() {
        const isLoading = inject('isLoading');
        const region = inject('region');
        const raceNameMap = inject('raceNameMap');
        const skillNameMap = inject('skillNameMap');
        const condNameMap = inject('condNameMap');
        const actorManager = inject('actorManager');
        const dcManager = inject('dcManager');

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

        const showEntityDetailDamageList = (targetId: string, attackerId: string) => {
            const entity = entityMap.value[targetId];
            if (!entity) {
                return;
            }

            detailDialog.value = true;
            detailDialogData.value = {
                targetName: prettyEntityName(entity.actor)!,
                attackerName: prettyEntityName(entityMap.value[attackerId]?.actor) || attackerId,
                Damages: entity.dc.groupedDamages[attackerId],
            };
        }

        const showEntityGroupDetailDamageList = (targetId: string, attackerId: string) => {
            const group = groupMap.value[targetId];
            if (!group) {
                return;
            }

            detailDialog.value = true;
            detailDialogData.value = {
                targetName: prettyEntityName(group.actor)!,
                attackerName: prettyEntityName(entityMap.value[attackerId]?.actor) || attackerId,
                Damages: group.dc.groupedDamages[attackerId],
            };
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

        const detailDialog = ref(false);
        const detailDialogData = ref<{ targetName: string; attackerName: string; Damages: EntityDamage[] }>();

        const condTooltipParent = ref<HTMLElement>();
        const condTooltipValue = ref(false);
        const condTooltip = ref<EntityCondition>();

        const setCondTooltip = (el: HTMLElement, cond?: EntityCondition) => {
            condTooltip.value = cond;
            condTooltipParent.value = el;
            condTooltipValue.value = !!cond;
        }

        const prettyEntityName = (entity?: BaseActor) => {
            if (!entity) {
                return undefined;
            }

            if (ActorManager.pcRaceSet.has(entity.raceId)) {
                return entity.name;
            }

            const raceName = raceNameMap.value[entity.raceId] || `unknownRace:${entity.raceId}`;
            if (entity instanceof GroupActor) {
                return raceName;
            }

            // for monster
            if (entity.name[0] >= '0' && entity.name[0] <= '9') {
                return `${raceName} (${entity.name.slice(-4)})`;
            }

            // for pet
            return entity.name;
        }

        return {
            isLoading,
            region,

            detailDialog,
            detailDialogData,

            skillNameMap,
            condNameMap,
            entityMap,
            groupMap,

            condTooltip,
            condTooltipParent,
            condTooltipValue,
            setCondTooltip,

            showEntityDetailDamageList,
            showEntityGroupDetailDamageList,
            getMabiNameColor,
            prettyEntityName,
            getGroupDC,
            getSingleDC,
        }
    }
});

</script>