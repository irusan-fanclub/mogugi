<template>
    <v-sheet width="100%" class="d-flex pa-2 mb-2">
        {{ attackerName }} -> {{ targetName }}
    </v-sheet>

    <v-virtual-scroll :items="damages" style="min-height: 300px; height: calc(90svh - 200px)" item-height="80">
        <template v-slot:default="{ item }">
            <v-card min-height="80">
                <v-sheet class="d-flex">
                    <v-sheet width="32" class="mr-2">
                        <img width="32" height="32"
                            :src='`/res/skillimage/${region}/${item.SkillId}/${item.SkillId}.png`' />
                    </v-sheet>

                    <v-sheet>
                        <p>
                            <template v-for="cond in item.Conditions" v-bind:key="cond.CCId">
                                <img width="16" height="16"
                                    @mouseover="e => setCondTooltip(e.target! as HTMLElement, cond)"
                                    @mouseleave="e => setCondTooltip(e.target! as HTMLElement, undefined)"
                                    @click="e => setCondTooltip(e.target! as HTMLElement, cond)"
                                    :src='`/res/characterconditionimage/${region}/${cond.CCId}/${cond.CCId}.png`' />
                            </template>
                            ->
                            <template v-for="cond in item.TargetConditions" v-bind:key="cond.CCId">
                                <img width="16" height="16"
                                    @mouseover="e => setCondTooltip(e.target! as HTMLElement, cond)"
                                    @mouseleave="e => setCondTooltip(e.target! as HTMLElement, undefined)"
                                    @click="e => setCondTooltip(e.target! as HTMLElement, cond)"
                                    :src='`/res/characterconditionimage/${region}/${cond.CCId}/${cond.CCId}.png`' />
                            </template>
                        </p>
                        <p>
                            {{ skillNameMap[item.SkillId] }} {{ item.Damage.toFixed(0) }}
                            {{ item.IsCritical ? 'Critical' : '' }}
                            {{ item.IsDelayed ? 'Additional Damage' : '' }}
                        </p>
                    </v-sheet>
                </v-sheet>
            </v-card>
        </template>
    </v-virtual-scroll>

    <v-tooltip v-if="condTooltip" v-model="condTooltipValue" :activator="condTooltipParent">
        {{ condNameMap[condTooltip.CCId] }}
    </v-tooltip>
</template>

<script lang="ts">
import { defineComponent, PropType, inject, ref } from 'vue';

import type { EntityDamage, EntityCondition } from '@/eventActor';

export default defineComponent({
    props: {
        attackerName: {
            type: String,
            required: true,
        },
        targetName: {
            type: String,
            required: true,
        },
        damages: {
            type: Array as PropType<EntityDamage[]>,
            required: true,
        },
    },
    setup() {
        const isLoading = inject('isLoading');
        const region = inject('region');
        const skillNameMap = inject('skillNameMap');
        const condNameMap = inject('condNameMap');

        const condTooltipParent = ref<HTMLElement>();
        const condTooltipValue = ref(false);
        const condTooltip = ref<EntityCondition>();

        const setCondTooltip = (el: HTMLElement, cond?: EntityCondition) => {
            condTooltip.value = cond;
            condTooltipParent.value = el;
            condTooltipValue.value = !!cond;
        }

        return {
            isLoading,
            region,
            skillNameMap,
            condNameMap,

            condTooltip,
            condTooltipParent,
            condTooltipValue,
            setCondTooltip,
        }
    }
});

</script>
