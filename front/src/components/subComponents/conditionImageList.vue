<template>
    <template v-for="cond in conditions" v-bind:key="cond.CCId">
        <img width="16" height="16"
            @mouseover="e => setCondTooltip(e.target! as HTMLElement, cond)"
            @mouseleave="e => setCondTooltip(e.target! as HTMLElement, undefined)"
            @click="e => setCondTooltip(e.target! as HTMLElement, cond)"
            :src='`/res/characterconditionimage/${region}/${cond.CCId}/${cond.CCId}.png`' />
    </template>

    <v-tooltip v-if="condTooltip" v-model="condTooltipValue" :activator="condTooltipParent">
        {{ condNameMap[condTooltip.CCId] }}
    </v-tooltip>
</template>

<script lang="ts">
import { defineComponent, PropType, inject, ref } from 'vue';
import type { EntityCondition } from '@/eventActor';

export default defineComponent({
    props: {
        conditions: {
            type: Array as PropType<EntityCondition[]>,
            required: true,
        },
    },
    setup() {
        const region = inject('region');
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
            region,
            condNameMap,
            condTooltip,
            condTooltipParent,
            condTooltipValue,
            setCondTooltip,
        }
    }
});

</script>
