<template>
    <div>
        <div class="text-subtitle-2 mb-2">隱藏的 CC 列表</div>
        <div v-if="hiddenCCList.length === 0" class="text-body-2 text-medium-emphasis">
            目前沒有隱藏的 CC。CC 圖示按 Shift+Click 可以隱藏。
        </div>
        <v-list v-else density="compact">
            <v-list-item v-for="ccId in hiddenCCList" :key="ccId">
                <template v-slot:prepend>
                    <img width="16" height="16" :src="`/icons/cc/${ccId}.png`" class="mr-2" />
                </template>
                <v-list-item-title>{{ condNameMap[ccId] ?? `CC ${ccId}` }}</v-list-item-title>
                <template v-slot:append>
                    <v-btn icon="mdi-delete" size="x-small" variant="text" color="error"
                        @click="removeHiddenCC(ccId)" />
                </template>
            </v-list-item>
        </v-list>
        <v-divider class="my-3" />

        <div class="text-subtitle-2 mb-2">自動選擇王目標</div>
        <v-switch v-model="autoSelectBossModel" density="compact" hide-details color="primary"
            label="在傷害分析頁籤自動選擇最新出現的王" />
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';
import { condNameMap, hiddenCCIds, removeHiddenCC, autoSelectBoss, setAutoSelectBoss } from '@/store';

// Browser-side (localStorage) preferences, shown in the damage-analysis settings dialog.
export default defineComponent({
    setup() {
        const hiddenCCList = computed(() => [...hiddenCCIds.value]);
        const autoSelectBossModel = computed({
            get: () => autoSelectBoss.value,
            set: (v: boolean) => setAutoSelectBoss(v),
        });
        return { condNameMap, hiddenCCList, removeHiddenCC, autoSelectBossModel };
    },
});
</script>
