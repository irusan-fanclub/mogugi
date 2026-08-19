<template>
    <div class="d-flex align-center alias-toolbar" style="gap: 8px;">
        <v-btn size="x-small" variant="text" density="compact" prepend-icon="mdi-dice-multiple"
            @click="onRandomizeAll">隨機名稱</v-btn>
        <v-btn size="x-small" variant="text" density="compact" prepend-icon="mdi-restore"
            :disabled="!hasAnyAlias" @click="clearAllAliases">還原名稱</v-btn>
        <v-btn size="x-small" variant="text" density="compact"
            :prepend-icon="arcanaHidden ? 'mdi-eye' : 'mdi-eye-off'"
            @click="$emit('toggle-arcana')">{{ arcanaHidden ? '顯示秘法' : '隱藏秘法' }}</v-btn>
        <span class="text-medium-emphasis alias-toolbar__hint">別名只存在本次執行，關閉後不保留</span>
    </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { randomizeAll, clearAllAliases, hasAnyAlias } from '@/lib/entityAlias';

export default defineComponent({
    props: {
        realNames: { type: Array as PropType<string[]>, required: true },
        arcanaHidden: { type: Boolean, default: false },
    },
    emits: ['toggle-arcana'],
    setup(props) {
        const onRandomizeAll = () => randomizeAll([...props.realNames]);
        return { onRandomizeAll, clearAllAliases, hasAnyAlias };
    },
});
</script>

<style scoped>
/* Both sides are pinned to the same size and line box rather than left to
   Vuetify's defaults: text-caption and the x-small button label disagree on
   both, which is what kept the hint from matching the buttons. */
.alias-toolbar {
    min-height: 16px;
}

.alias-toolbar :deep(.v-btn),
.alias-toolbar__hint {
    font-size: 0.75rem;
    line-height: 16px;
    letter-spacing: normal;
}

.alias-toolbar :deep(.v-btn) {
    height: 16px;
}

.alias-toolbar :deep(.v-btn__content) {
    line-height: 16px;
}
</style>
