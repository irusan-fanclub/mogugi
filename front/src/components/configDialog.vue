<template>
    <v-dialog v-model="open" max-width="500">
        <v-card>
            <v-card-title class="d-flex align-center">
                <v-icon icon="mdi-cog" class="mr-2" />
                設定
            </v-card-title>
            <v-card-text>
                <div class="text-subtitle-2 mb-2">隱藏的 CC 列表</div>
                <div v-if="hiddenCCList.length === 0" class="text-body-2 text-medium-emphasis">
                    目前沒有隱藏的 CC。CC 圖示按 Shift+Click 可以隱藏。
                </div>
                <v-list v-else density="compact">
                    <v-list-item v-for="ccId in hiddenCCList" :key="ccId">
                        <template v-slot:prepend>
                            <img width="16" height="16"
                                :src="`/icons/cc/${ccId}.png`" class="mr-2" />
                        </template>
                        <v-list-item-title>{{ condNameMap[ccId] ?? `CC ${ccId}` }}</v-list-item-title>
                        <template v-slot:append>
                            <v-btn icon="mdi-delete" size="x-small" variant="text" color="error"
                                @click="onRemoveHiddenCC(ccId)" />
                        </template>
                    </v-list-item>
                </v-list>
                <v-divider class="my-3" />

                <div class="text-subtitle-2 mb-2">隱藏的怪物列表</div>
                <div v-if="hiddenRaceList.length === 0" class="text-body-2 text-medium-emphasis">
                    目前沒有隱藏的怪物。在 Take Damage 頁籤按 X 按鈕可以隱藏。
                </div>
                <v-list v-else density="compact">
                    <v-list-item v-for="raceId in hiddenRaceList" :key="raceId">
                        <v-list-item-title>{{ raceNameMap[raceId] ?? `Race ${raceId}` }}</v-list-item-title>
                        <template v-slot:append>
                            <v-btn icon="mdi-delete" size="x-small" variant="text" color="error"
                                @click="onRemoveHiddenRace(raceId)" />
                        </template>
                    </v-list-item>
                </v-list>
                <v-divider class="my-3" />

                <div class="text-subtitle-2 mb-2">自動選擇王目標</div>
                <v-switch v-model="autoSelectBossModel" density="compact" hide-details color="primary"
                    label="在 Apply Damage (By Skill) 頁籤自動選擇最新出現的王" />
            </v-card-text>
            <v-card-actions>
                <v-spacer />
                <v-btn color="primary" variant="flat" @click="open = false">關閉</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import { defineComponent, inject, computed, Ref } from 'vue';
import { removeHiddenCC, removeHiddenRace, autoSelectBoss, setAutoSelectBoss } from '@/store';

export default defineComponent({
    props: {
        modelValue: {
            type: Boolean,
            required: true,
        },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const region = inject('region');
        const condNameMap = inject('condNameMap') as Ref<Record<number, string>>;
        const raceNameMap = inject('raceNameMap') as Ref<Record<number, string>>;
        const hiddenCCIds = inject('hiddenCCIds') as Ref<Set<number>>;
        const hiddenRaceIds = inject('hiddenRaceIds') as Ref<Set<number>>;

        const open = computed({
            get: () => props.modelValue,
            set: (v) => emit('update:modelValue', v),
        });

        const hiddenCCList = computed(() => [...hiddenCCIds.value]);
        const onRemoveHiddenCC = (ccId: number) => removeHiddenCC(ccId);

        const hiddenRaceList = computed(() => [...hiddenRaceIds.value]);
        const onRemoveHiddenRace = (raceId: number) => removeHiddenRace(raceId);

        const autoSelectBossModel = computed({
            get: () => autoSelectBoss.value,
            set: (v) => setAutoSelectBoss(v),
        });

        return {
            region,
            condNameMap,
            raceNameMap,
            open,
            hiddenCCList,
            onRemoveHiddenCC,
            hiddenRaceList,
            onRemoveHiddenRace,
            autoSelectBossModel,
        };
    },
});
</script>
