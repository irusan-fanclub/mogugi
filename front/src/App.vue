<template>
  <license-gate v-if="!licenseActivated" @activated="onActivated" />
  <template v-else>
    <v-sheet width="100vw" class="d-flex flex-wrap pl-1 pr-1">
        <v-sheet width="100svw" class="d-flex">
            <span style="text-wrap-mode: nowrap;">mogugi <span style="opacity:0.5; font-size:0.85em;">v{{ appVersion }}</span><span v-if="licenseUser" style="opacity:0.6; font-size:0.85em;"> · {{ licenseUser }}</span><template v-if="isStandalone">
                <v-icon icon="mdi-check" color="success" />standalone
            </template><template v-else>, api
                <span v-if="socketConnected"><v-icon icon="mdi-check" color="success" />connected</span>
                <span v-else><v-icon icon="mdi-close" color="error" />disconnected</span>
            </template></span>
            <span>

            </span>
            <v-divider />
            <v-tooltip>
                <template v-slot:activator="{ props }">
                    <v-btn @click="loadFromFile" v-bind="props" :loading="isLoading" color="primary" size="small"
                        prepend-icon="mdi-upload" class="ml-1">Load</v-btn>
                </template>
                從檔案載入資料
            </v-tooltip>
            <template v-if="!isStandalone">
                <v-btn @click="download" :loading="isLoading" color="primary" size="small" prepend-icon="mdi-download"
                    class="ml-1">Download</v-btn>
                <v-tooltip>
                    <template v-slot:activator="{ props }">
                        <v-btn @click="loadFromServer" v-bind="props" :loading="isLoading" color="primary" size="small"
                            prepend-icon="mdi-refresh" class="ml-1">Reload</v-btn>
                    </template>
                    從伺服器重新載入
                </v-tooltip>
            </template>
            <v-btn @click="clearData" :loading="isLoading" color="primary" size="small" prepend-icon="mdi-close"
                class="ml-1">Clear</v-btn>
            <v-tooltip>
                <template v-slot:activator="{ props }">
                    <v-btn @click="forceRefresh" v-bind="props" color="secondary" size="small"
                        prepend-icon="mdi-refresh-circle" class="ml-1">Force Refresh</v-btn>
                </template>
                強制刷新 UI
            </v-tooltip>
            <v-tooltip>
                <template v-slot:activator="{ props }">
                    <v-btn @click="configOpen = true" v-bind="props" size="small" prepend-icon="mdi-cog"
                        class="ml-1 mr-4">Settings</v-btn>
                </template>
                設定
            </v-tooltip></v-sheet>
    </v-sheet>

    <v-sheet v-if="hasTimeRange" class="d-flex align-center pa-2" style="gap: 8px; background: rgba(255, 165, 0, 0.15);">
        <v-icon icon="mdi-clock-outline" color="warning" size="small" />
        <span style="font-size: 0.85em;">Time filter: {{ formatTime(timeRangeMin) }} ~ {{ formatTime(timeRangeMax) }}</span>
        <v-spacer />
        <v-btn @click="clearTimeRangeFilter" color="warning" size="x-small" prepend-icon="mdi-close" variant="text">Clear</v-btn>
    </v-sheet>

    <v-tabs v-model="tab">
        <v-tab value="takeDamage">Take Damage</v-tab>
        <v-tab value="applyDamageByEntity">Apply Damage (By Entity)</v-tab>
        <v-tab value="applyDamageBySkill">Apply Damage (By Skill)</v-tab>
        <v-tab value="entityList">Characters</v-tab>
        <v-tab value="itemIndex">物品索引</v-tab>
        <v-tab value="about">About</v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
        <v-tabs-window-item value="takeDamage">
            <take-damage />
        </v-tabs-window-item>

        <v-tabs-window-item value="applyDamageByEntity">
            <apply-damage-by-entity />
        </v-tabs-window-item>

        <v-tabs-window-item value="applyDamageBySkill">
            <apply-damage-by-skill />
        </v-tabs-window-item>

        <v-tabs-window-item value="entityList">
            <entity-list />
        </v-tabs-window-item>

        <v-tabs-window-item value="itemIndex">
            <item-index />
        </v-tabs-window-item>

        <v-tabs-window-item value="about">
            <v-sheet class="pa-6" style="max-width: 640px;">
                <div class="text-h5 mb-4">mogugi <span style="opacity:0.5; font-size:0.7em;">v{{ appVersion }}</span></div>

                <div class="mb-4">
                    <div class="text-subtitle-2 mb-1" style="opacity:0.6;">中文</div>
                    <p>本專案 fork 自 <strong>prilus/dilmatulgi</strong>，並在其基礎上進行二次開發。</p>
                    <p style="opacity:0.7; font-size:0.9em;">在此感謝原作者 prilus。</p>
                </div>

                <div>
                    <div class="text-subtitle-2 mb-1" style="opacity:0.6;">English</div>
                    <p>This project is forked from <strong>prilus/dilmatulgi</strong> and further developed on top of it.</p>
                    <p style="opacity:0.7; font-size:0.9em;">Thanks to the original author, prilus.</p>
                </div>
            </v-sheet>
        </v-tabs-window-item>
    </v-tabs-window>

    <config-dialog v-model="configOpen" />

    <v-dialog v-model="msgBoxOpen" max-width="500" persistent>
        <v-card>
            <v-card-title class="d-flex align-center">
                <v-icon icon="mdi-alert-circle" color="warning" class="mr-2" />
                MessageBox
            </v-card-title>
            <v-card-text style="white-space: pre-wrap;">{{ msgBoxText }}</v-card-text>
            <v-card-actions>
                <v-spacer />
                <v-btn color="primary" variant="flat" @click="msgBoxOpen = false">OK</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>

    <floating-window
        v-for="d in dialogStack.dialogs"
        :key="d.id"
        :title="d.title.value"
        @close="dialogStack.close(d.id)"
    >
        <component :is="d.component" v-bind="d.props" />
    </floating-window>

    <v-snackbar v-model="resetSnackbar" :timeout="4000" color="info" location="bottom right">
        <v-icon icon="mdi-swap-horizontal" class="mr-2" />{{ resetSnackbarText }}
    </v-snackbar>
  </template>
</template>

<script lang="ts">
import { defineComponent, onMounted, inject, ref } from "vue";

import { useDialogStack } from '@/lib/useDialogStack';
import { SocketClient } from '@/lib/socketClient';
import { eventBase, eventIdMessageBox, eventIdSessionReset, eventMessageBox, eventSessionReset } from "./protocols";
import { clearTimeRange } from '@/store';

import TakeDamageComponent from '@/components/takeDamage.vue';
import ApplyDamageByEntityComponent from '@/components/applyDamageByEntity.vue';
import ApplyDamageBySkillComponent from '@/components/applyDamageBySkill.vue';
import EntityListComponent from "./components/entityList.vue";
import ItemIndexComponent from "./components/itemIndex.vue";
import ConfigDialogComponent from "./components/configDialog.vue";
import FloatingWindowComponent from "./components/subComponents/floatingWindow.vue";
import LicenseGateComponent from "./components/licenseGate.vue";

export default defineComponent({
    name: "App",
    components: {
        TakeDamage: TakeDamageComponent,
        ApplyDamageByEntity: ApplyDamageByEntityComponent,
        ApplyDamageBySkill: ApplyDamageBySkillComponent,
        EntityList: EntityListComponent,
        ItemIndex: ItemIndexComponent,
        ConfigDialog: ConfigDialogComponent,
        FloatingWindow: FloatingWindowComponent,
        LicenseGate: LicenseGateComponent,
    },
    setup() {
        const isLoading = inject('isLoading');
        const region = inject('region');
        // const lang = inject('lang');
        const regionList = inject('regionList');
        const db = inject('db');
        const raceNameMap = inject('raceNameMap');
        const skillNameMap = inject('skillNameMap');
        const condNameMap = inject('condNameMap');
        const itemNameMap = inject('itemNameMap');
        const enchantNameMap = inject('enchantNameMap');
        const appEvent = inject('appEvent');
        const actorManager = inject('actorManager');
        const dcManager = inject('dcManager');

        const hasTimeRange = inject('hasTimeRange');
        const timeRangeMin = inject('timeRangeMin');
        const timeRangeMax = inject('timeRangeMax');

        const socketConnected = ref(false);
        const configOpen = ref(false);
        const msgBoxOpen = ref(false);
        const msgBoxText = ref('');
        const resetSnackbar = ref(false);
        const resetSnackbarText = ref('');

        const isStandalone = __IS_STANDALONE__;
        // Show the activation code screen when not yet activated; standalone builds have no backend and need no verification.
        const licenseActivated = ref(isStandalone);
        const licenseUser = ref('');
        const fetchLicenseStatus = async () => {
            try {
                const r = await fetch('/api/license/status');
                const d = await r.json();
                licenseActivated.value = !!d.activated;
                licenseUser.value = d.displayName || '';
            } catch { /* keep locked if the backend is unreachable */ }
        };
        const onActivated = () => { licenseActivated.value = true; fetchLicenseStatus(); };
        onMounted(() => {
            if (licenseActivated.value) return;
            fetchLicenseStatus();
        });
        const appVersion = __APP_VERSION__;

        const socket = new SocketClient(`/ws`);
        socket.onConnect = isConnected => socketConnected.value = isConnected;
        socket.onEvent = (events) => {
            for (const event of events) {
                if (event.EventId === eventIdMessageBox) {
                    const e = event as eventMessageBox;
                    msgBoxOpen.value = true;
                    msgBoxText.value += `${e.Message}\n`;
                    continue;
                }

                if (event.EventId === eventIdSessionReset) {
                    const e = event as eventSessionReset;
                    resetSnackbarText.value = e.Reason === 'channel_switch'
                        ? '偵測到換線'
                        : '偵測到連線異常';
                    resetSnackbar.value = true;
                    continue;
                }

                actorManager.value.onEvent(event);
            }
        }

        const loadJsonData = (jsonStr: string) => {
            let lastPos = 0;
            let count = 0;

            while (lastPos < jsonStr.length) {
                const nextPos = jsonStr.indexOf('\n', lastPos);
                if (nextPos < 0) {
                    break;
                }

                const line = jsonStr.substring(lastPos, nextPos).trim();
                lastPos = nextPos + 1;
                count++;

                if (!line) {
                    continue;
                }

                try {
                    const event = JSON.parse(line);
                    actorManager.value.onEvent(event);
                }
                catch (e) {
                    console.error(e);
                    continue;
                }
            }

            console.log(`loaded ${count} events`);
        }

        const forceRefresh = () => {
            actorManager.value.forceUpdateAll();
        }

        const clearData = () => {
            appEvent.value.dispatchEvent(new CustomEvent('clear'));

            // clear했을 때 서버도 같이 clear하는게 맞을지?
            actorManager.value.clear();
            dcManager.value.clear();
            clearTimeRange();
        }

        const clearTimeRangeFilter = () => clearTimeRange();

        const formatTime = (v: any) => {
            if (v == null) return '';
            return new Date(v * 1000).toLocaleTimeString();
        }

        const download = () => {
            window.open('/api/packet_log', '_blank');
        }

        const loadFromFile = async () => {
            const input = document.createElement('input');

            try {
                input.type = 'file';
                input.accept = '.ndjson';
                input.click();

                await new Promise<void>(resolve => {
                    input.addEventListener('cancel', () => {
                        console.log('file select cancel');
                        resolve();
                    });
                    input.addEventListener('change', () => {
                        console.log('file selected');
                        resolve();
                    });
                })

                if (!input.files?.length) {
                    // ?
                    return;
                }

                const file = input.files[0];
                const r = new FileReader();

                // 파일이 커지면 chunk로 읽는 것도 고려해야함
                r.readAsText(file);


                await new Promise<void>(resolve => {
                    r.addEventListener('abort', () => {
                        console.log('file read abort');
                        resolve();
                    });
                    r.addEventListener('error', () => {
                        console.log('file read error', r.error);
                        resolve();
                    });
                    r.addEventListener('load', () => {
                        console.log('file read complete');
                        resolve();
                    });
                });

                const jsonData = r.result as string || '';

                clearData();
                loadJsonData(jsonData);
            }
            finally {
                input.remove();
            }
        }

        const loadFromServer = async () => {
            const prevHandler = socket.onEvent;
            const temporaryStore = [] as eventBase[];

            try {
                const res = await fetch('/api/packet_log');
                if (!res.ok) {
                    throw new Error(`failed to fetch data ${res.status}`);
                }

                socket.onEvent = (e) => temporaryStore.push(...e);
                const jsonData = await res.text();

                clearData();
                loadJsonData(jsonData);
            }
            catch (e) {
                console.error(e);
                alert(`failed to load data ${e}`);
            }
            finally {
                socket.onEvent = prevHandler;

                for (const e of temporaryStore) {
                    actorManager.value.onEvent(e);
                }
                temporaryStore.length = 0;
            }
        }

        const dialogStack = useDialogStack();
        const tab = ref('applyDamageBySkill');

        onMounted(async () => {
            regionList.value = ['kr', 'krt', 'cn', 'jp', 'tw', 'us'];

            await db.value.tryOpen();
            {
                const list = await db.value.getSortedListData('RaceList');

                for (const v of list) {
                    raceNameMap.value[v.Id] = `${db.value.getCurLangString(v.Name)} ${v.Id}`;
                }

                // Manual overrides for entries the DB doesn't yet carry.
                // Remove once the DB ships an updated RaceList.
                raceNameMap.value[7615] = '雷楠的米勒：悔恨 7615';
            }
            {
                const list = await db.value.getSortedListData('SkillList');

                for (const v of list) {
                    skillNameMap.value[v.Id] = db.value.getCurLangString(v.Name);
                }
            }
            {
                const list = await db.value.getSortedListData('CharCondList');

                for (const v of list) {
                    condNameMap.value[v.Id] = `${db.value.getCurLangString(v.Name)} ${v.Id}`;
                }
            }
            {
                const list = await db.value.getSortedListData('ItemList');

                for (const v of list) {
                    itemNameMap.value[v.Id] = `${db.value.getCurLangString(v.Name)} ${v.Id}`;
                }
            }
            try {
                // Enchant names (plain, no id suffix — used verbatim in the item
                // index). Table may be absent/empty in dbs built from an upstream
                // sqlite older than mabitsequal schema v4 → ids stay as fallback.
                const list = await db.value.getSortedListData('OptionSetList');

                for (const v of list) {
                    enchantNameMap.value[v.Id] = db.value.getCurLangString(v.Name);
                }
            } catch (e) {
                console.warn('optionset list unavailable (old bundled db?)', e);
            }

            if (!isStandalone) {
                socket.connect();
            }
        });

        return {
            isLoading,
            region,
            isStandalone,
            licenseActivated,
            licenseUser,
            onActivated,

            socketConnected,
            msgBoxOpen,
            msgBoxText,
            appVersion,
            resetSnackbar,
            resetSnackbarText,
            forceRefresh,
            clearData,
            download,
            loadFromFile,
            loadFromServer,

            tab,
            dialogStack,

            configOpen,

            hasTimeRange,
            timeRangeMin,
            timeRangeMax,
            clearTimeRangeFilter,
            formatTime,
        }
    }
});

</script>

<style>
/* Compact rows for tabs 1/2/3 attacker/group lists. Vuetify defaults to
   48px min-height which is too airy for our dense data tables. */
.v-expansion-panel-title {
    min-height: 32px !important;
    padding-top: 4px !important;
    padding-bottom: 4px !important;
}
</style>
