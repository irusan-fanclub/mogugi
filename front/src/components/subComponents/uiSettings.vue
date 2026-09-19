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
        <v-divider class="my-3" />

        <div class="text-subtitle-2 mb-2">BOSS 清單</div>
        <div class="text-body-2 text-medium-emphasis mb-2">
            只影響傷害分析頁的自動選王與王目標篩選;戰鬥紀錄的王名單在程式內。
        </div>
        <v-list density="compact">
            <v-list-item v-for="id in bossRaceList" :key="id">
                <v-list-item-title>{{ raceNameMap[id] ?? `RaceID ${id}` }}</v-list-item-title>
                <template v-slot:append>
                    <v-btn icon="mdi-delete" size="x-small" variant="text" color="error"
                        @click="removeBossRaceId(id)" />
                </template>
            </v-list-item>
        </v-list>
        <div class="d-flex align-center ga-2 mt-1">
            <v-text-field v-model="newBossRaceId" label="RaceID" type="number" density="compact" hide-details
                style="max-width: 160px" @keyup.enter="addNewBossRace" />
            <v-btn size="small" variant="tonal" @click="addNewBossRace">新增</v-btn>
            <v-btn v-if="bossRacesChanged" size="small" variant="text" @click="resetBossRaces">恢復預設</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue';
import {
    condNameMap, raceNameMap, hiddenCCIds, removeHiddenCC, autoSelectBoss, setAutoSelectBoss,
    bossRaceIds, bossRacesChanged, addBossRaceId, removeBossRaceId, resetBossRaces,
} from '@/store';

// Browser-side (localStorage) preferences, shown in the damage-analysis settings dialog.
export default defineComponent({
    setup() {
        const hiddenCCList = computed(() => [...hiddenCCIds.value]);
        const autoSelectBossModel = computed({
            get: () => autoSelectBoss.value,
            set: (v: boolean) => setAutoSelectBoss(v),
        });
        const bossRaceList = computed(() => [...bossRaceIds.value].sort((a, b) => a - b));
        // The number field yields a string; a blank or bad value becomes 0,
        // which addBossRaceId ignores.
        const newBossRaceId = ref('');
        const addNewBossRace = () => {
            addBossRaceId(Number(newBossRaceId.value));
            newBossRaceId.value = '';
        };
        return {
            condNameMap, raceNameMap, hiddenCCList, removeHiddenCC, autoSelectBossModel,
            bossRaceList, bossRacesChanged, newBossRaceId, addNewBossRace, removeBossRaceId, resetBossRaces,
        };
    },
});
</script>
