<template>
    <div class="d-flex align-center mb-1" style="gap: 8px;">
        <v-btn size="x-small" variant="text" prepend-icon="mdi-dice-multiple"
            @click="onRandomizeAll">全部隨機</v-btn>
        <v-btn size="x-small" variant="text" prepend-icon="mdi-restore"
            :disabled="!hasAnyAlias" @click="clearAllAliases">還原真名</v-btn>
        <span class="text-caption text-medium-emphasis">別名只存在本次執行，關閉後不保留</span>
    </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { randomizeAll, clearAllAliases, hasAnyAlias } from '@/lib/entityAlias';

export default defineComponent({
    props: {
        realNames: { type: Array as PropType<string[]>, required: true },
    },
    setup(props) {
        const onRandomizeAll = () => randomizeAll([...props.realNames]);
        return { onRandomizeAll, clearAllAliases, hasAnyAlias };
    },
});
</script>
