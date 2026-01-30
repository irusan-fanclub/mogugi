<template>
    <v-expansion-panels multiple v-for="v in pcEntities" v-bind:key="v.actor.id">
        <template v-if="v.dc.totalDamage > 0">
            <v-expansion-panel>
                <v-expansion-panel-title>
                    <v-sheet>
                        {{ prettyEntityName(v.actor) }} {{ v.dc.totalDamage.toFixed(0) }} {{ (100 * v.dc.totalDamage /
                            allApplyDamage).toFixed(1) }}%
                    </v-sheet>

                </v-expansion-panel-title>
                <v-expansion-panel-text class="pa-3">
                    <v-sheet
                        v-for="[targetId, damageToTarget] in Object.entries(v.dc.groupedTotalDamages).sort(([, av], [, bv]) => bv - av)"
                        v-bind:key="targetId" width="100%" class="mb-4">
                        <!-- Name -->
                        <v-sheet width="100%" @click.stop="showEntityDetailDamageList(v.actor.id, targetId)">
                            {{ prettyEntityName(entityMap[targetId]?.actor) || targetId }} {{
                                damageToTarget.toFixed(0) }} {{
                                (100 * damageToTarget / v.dc.totalDamage).toFixed(1) }}%
                        </v-sheet>

                        <!-- Bar -->
                        <v-sheet width="100%" height="16">
                            <v-sheet @click.stop="showEntityDetailDamageList(v.actor.id, targetId)"
                                :color="getMabiNameColor(prettyEntityName(entityMap[targetId]?.actor) || targetId)"
                                height="100%"
                                :width="`${Math.round(100 * damageToTarget / v.dc.totalDamage).toFixed(0)}%`"
                                class="rounded-xl">
                            </v-sheet>
                        </v-sheet>
                    </v-sheet>
                </v-expansion-panel-text>
            </v-expansion-panel>
            <!-- Bar -->
            <v-sheet width="100%" height="16">
                <v-sheet :color="getMabiNameColor(prettyEntityName(v.actor)!)" height="100%"
                    :width="`${Math.round(100 * v.dc.totalDamage / allApplyDamage).toFixed(0)}%`" class="rounded-xl">
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
</template>

<script lang="ts">
import { defineComponent, inject, ref, computed, onUnmounted } from "vue";

import { getMabiNameColor } from '@/util';
import { EntityDamage, ActorManager, BaseActor, GroupActor, EntityActor } from '@/eventActor';
import { GroupedDamageCollector } from '@/actionCollector';

import DamageList from '@/components/subComponents/damageList.vue';

export default defineComponent({
    components: {
        DamageList,
    },
    setup() {
        const isLoading = inject('isLoading');
        const region = inject('region');
        const raceNameMap = inject('raceNameMap');
        const skillNameMap = inject('skillNameMap');
        const actorManager = inject('actorManager');
        const dcManager = inject('dcManager');

        const damageCollectorMap: Record<string, GroupedDamageCollector> = {};

        onUnmounted(() => {
            for (const v of Object.values(damageCollectorMap)) {
                dcManager.value.removeDamageCollector(v);
            }
        });

        const getDC = (attackerId: string) => {
            const key = `${attackerId}`;
            if (damageCollectorMap[key]) {
                return damageCollectorMap[key];
            }

            const dc = dcManager.value.getGroupedDamageCollector(v => v.Id == attackerId, v => v.TargetId);
            damageCollectorMap[key] = dc;

            return dc;
        }

        const showEntityDetailDamageList = (attackerId: string, targetId: string) => {
            const entity = entityMap.value[attackerId];
            if (!entity) {
                return;
            }

            detailDialog.value = true;
            detailDialogData.value = {
                targetName: prettyEntityName(entityMap.value[targetId]?.actor) || targetId,
                attackerName: prettyEntityName(entity.actor)!,
                Damages: entity.dc.groupedDamages[targetId],
            };
        }

        const entityMap = computed(() => {
            const m: Record<string, { actor: EntityActor, dc: GroupedDamageCollector }> = {};

            for (const k in actorManager.value.entityMap) {
                const v = actorManager.value.entityMap[k];

                m[k] = {
                    actor: v,
                    dc: getDC(k),
                }
            }

            return m;
        });

        const pcEntities = computed(() =>
            Object.values(entityMap.value).filter(v => v.actor.isPC).sort((a, b) => b.dc.totalDamage - a.dc.totalDamage));

        const allApplyDamage = computed(() =>
            pcEntities.value.reduce((acc, v) => acc + v.dc.totalDamage, 0));

        const detailDialog = ref(false);
        const detailDialogData = ref<{ targetName: string; attackerName: string; Damages: EntityDamage[] }>();

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

            pcEntities,
            allApplyDamage,
            detailDialog,
            detailDialogData,

            skillNameMap,
            entityMap,

            showEntityDetailDamageList,
            getMabiNameColor,
            prettyEntityName,
        }
    }
});

</script>