<template>
    <v-sheet width="100vw" class="d-flex flex-wrap pl-1 pr-1">
        <v-sheet width="100svw" class="d-flex">
            <span style="text-wrap-mode: nowrap;">dilmatulgi, api
                <span v-if="socketConnected"><v-icon icon="mdi-check" color="success" />connected</span>
                <span v-else><v-icon icon="mdi-close" color="error" />disconnected</span>
            </span>
            <span>

            </span>
            <v-divider />
            <v-tooltip>
                <template v-slot:activator="{ props }">
                    <v-btn @click="loadFromFile" v-bind="props" :loading="isLoading" color="primary" size="small"
                        prepend-icon="mdi-upload" class="ml-1">Load</v-btn>
                </template>
                Load data from file
            </v-tooltip>
            <v-btn @click="download" :loading="isLoading" color="primary" size="small" prepend-icon="mdi-download"
                class="ml-1">Download</v-btn>
            <v-tooltip>
                <template v-slot:activator="{ props }">
                    <v-btn @click="loadFromServer" v-bind="props" :loading="isLoading" color="primary" size="small"
                        prepend-icon="mdi-refresh" class="ml-1">Reload</v-btn>
                </template>
                Reload data from server
            </v-tooltip>
            <v-btn @click="clearData" :loading="isLoading" color="primary" size="small" prepend-icon="mdi-close"
                class="ml-1 mr-4">Clear</v-btn></v-sheet>
    </v-sheet>

    <v-tabs v-model="tab">
        <v-tab value="takeDamage">Take Damage</v-tab>
        <v-tab value="applyDamageByEntity">Apply Damage (By Entity)</v-tab>
        <v-tab value="applyDamageBySkill">Apply Damage (By Skill)</v-tab>
        <v-tab value="entityList">Characters</v-tab>
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
    </v-tabs-window>
</template>

<script lang="ts">
import { defineComponent, onMounted, inject, ref } from "vue";

import { SocketClient } from '@/socketClient';
import { eventBase } from "./protocols";

import TakeDamageComponent from '@/components/takeDamage.vue';
import ApplyDamageByEntityComponent from '@/components/applyDamageByEntity.vue';
import ApplyDamageBySkillComponent from '@/components/applyDamageBySkill.vue';
import EntityListComponent from "./components/entityList.vue";

export default defineComponent({
    name: "App",
    components: {
        TakeDamage: TakeDamageComponent,
        ApplyDamageByEntity: ApplyDamageByEntityComponent,
        ApplyDamageBySkill: ApplyDamageBySkillComponent,
        EntityList: EntityListComponent,
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
        const appEvent = inject('appEvent');
        const actorManager = inject('actorManager');
        const dcManager = inject('dcManager');

        const socketConnected = ref(false);
        const socket = new SocketClient(`/ws`);
        socket.onConnect = isConnected => socketConnected.value = isConnected;
        socket.onEvent = (event) => actorManager.value.onEvent(event);

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

        const clearData = () => {
            appEvent.value.dispatchEvent(new CustomEvent('clear'));

            // Should the server also be cleared when clearing?
            actorManager.value.clear();
            dcManager.value.clear();
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

                // Should consider reading in chunks if file gets large
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

                socket.onEvent = (e) => temporaryStore.push(e);
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

        const tab = ref('');

        onMounted(async () => {
            regionList.value = ['kr', 'krt', 'cn', 'jp', 'tw', 'us'];

            await db.value.tryOpen();
            {
                const list = await db.value.getSortedListData('RaceList');

                for (const v of list) {
                    raceNameMap.value[v.Id] = `${db.value.getCurLangString(v.Name)} ${v.Id}`;
                }
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

            socket.connect();
        });

        return {
            isLoading,
            region,

            socketConnected,
            clearData,
            download,
            loadFromFile,
            loadFromServer,

            tab,
        }
    }
});

</script>
