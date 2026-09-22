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
            <v-autocomplete v-model="pickedRace" v-model:search="raceSearch" :items="raceItems"
                :custom-filter="raceFilter" item-title="title" item-value="value"
                label="搜尋種族(中文或 RaceID)" density="compact" hide-details clearable auto-select-first
                no-data-text="找不到符合的種族;打 RaceID 按 Enter 可直接加入" style="max-width: 360px"
                @update:model-value="onRacePicked" @keydown.enter="onRaceEnter" />
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
import { matchesRaceQuery, parseRaceIdInput } from '@/lib/bossRaces';

// Browser-side (localStorage) preferences, shown in the damage-analysis settings dialog.
export default defineComponent({
    setup() {
        const hiddenCCList = computed(() => [...hiddenCCIds.value]);
        const autoSelectBossModel = computed({
            get: () => autoSelectBoss.value,
            set: (v: boolean) => setAutoSelectBoss(v),
        });
        const bossRaceList = computed(() => [...bossRaceIds.value].sort((a, b) => a - b));

        // Race picker: every race the bundled table knows (title already
        // carries the id, e.g. "佩洛姆 193810"); filtered by name or id prefix.
        const raceItems = computed(() =>
            Object.entries(raceNameMap.value).map(([id, title]) => ({ value: Number(id), title })));
        const raceFilter = (value: string, query: string, item?: { raw?: { title: string; value: number } }) =>
            matchesRaceQuery(item?.raw?.title ?? value, item?.raw?.value ?? 0, query);
        const pickedRace = ref<number | null>(null);
        const raceSearch = ref('');
        const onRacePicked = (v: number | null) => {
            if (v == null) return;
            addBossRaceId(v);
            pickedRace.value = null;
            raceSearch.value = '';
        };
        // Enter on a bare number that matched nothing adds it as-is, so a
        // race missing from the table can still be listed.
        const onRaceEnter = () => {
            const id = parseRaceIdInput(raceSearch.value);
            if (id == null || raceNameMap.value[id]) return;
            addBossRaceId(id);
            raceSearch.value = '';
        };
        return {
            condNameMap, raceNameMap, hiddenCCList, removeHiddenCC, autoSelectBossModel,
            bossRaceList, bossRacesChanged, removeBossRaceId, resetBossRaces,
            raceItems, raceFilter, pickedRace, raceSearch, onRacePicked, onRaceEnter,
        };
    },
});
</script>
