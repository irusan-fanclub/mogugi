<template>
    <v-sheet class="pa-3">
        <div class="text-subtitle-1 mb-1">應用程式</div>
        <div v-if="isStandalone" class="text-caption text-medium-emphasis mb-2">
            此版本不含擷取功能,沒有應用程式設定。
        </div>
        <template v-else>
            <div class="text-caption text-medium-emphasis mb-2">
                設定檔:{{ cfgPath || '讀取中' }}
                <span v-if="effectivePort" class="ml-3">目前使用 port {{ effectivePort }}</span>
            </div>
            <v-alert v-if="loadError" type="warning" variant="tonal" density="compact" class="mb-3">
                {{ loadError }}
            </v-alert>
            <v-alert v-if="fetchError" type="error" variant="tonal" density="compact" class="mb-3">
                {{ fetchError }}
            </v-alert>

            <template v-if="draft">
                <v-switch v-model="draft.savePcapng" color="primary" density="compact"
                    :disabled="!!overrides.savePcapng" label="保存封包原始紀錄(pcapng)"
                    hint="pcapng 檔可用於其他家 DPS Meter 還原;會隨時間變大。重新啟動 mogugi 後生效。"
                    persistent-hint />
                <div v-if="overrides.savePcapng" class="text-caption text-warning mb-2">{{ overrideNote(overrides.savePcapng) }}</div>

                <v-switch v-model="draft.autoOpenBrowser" color="primary" density="compact" class="mt-2"
                    :disabled="!!overrides.autoOpenBrowser" label="啟動時自動開啟瀏覽器"
                    hint="下次啟動生效。" persistent-hint />
                <div v-if="overrides.autoOpenBrowser" class="text-caption text-warning mb-2">{{ overrideNote(overrides.autoOpenBrowser) }}</div>

                <v-switch v-model="draft.autoPort" color="primary" density="compact" class="mt-2"
                    label="自動切換 port"
                    hint="port 被占用時自動往後找(8030 到 8040),並偵測已開啟的 mogugi。下次啟動生效。"
                    persistent-hint />

                <v-text-field v-model.number="draft.port" type="number" density="compact" class="mt-3" style="max-width: 320px"
                    label="網頁使用的 port" :min="PORT_MIN" :max="PORT_MAX" :error-messages="portError ?? []"
                    :disabled="draft.autoPort"
                    :hint="draft.autoPort ? '自動切換 port 開啟時此設定無效' : '想同時使用不同家 DPS Meter 可以修改,建議 8030 到 8040。重啟後生效。'"
                    persistent-hint />

                <div class="d-flex align-center mt-3" style="gap: 12px">
                    <v-btn color="primary" variant="flat" size="small" :disabled="!canSave || saving" :loading="saving" @click="save">儲存</v-btn>
                    <span v-if="saveError" class="text-error text-body-2">{{ saveError }}</span>
                </div>
                <div v-if="showSaved" class="mt-2">
                    <div class="text-body-2">已儲存。</div>
                    <div v-for="(h, i) in savedHints" :key="i" class="text-caption">{{ h }}</div>
                </div>
            </template>
        </template>

    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue';
import {
    validatePort, isDirty, saveHints, overrideNote, loadErrorNote, PORT_MIN, PORT_MAX,
    type AppConfig, type ConfigResponse, type SaveResponse,
} from '@/lib/appSettings';

// Settings tab: app-level config persisted by the backend in
// mogugi-config.toml; browser-side preferences live on 傷害分析.
export default defineComponent({
    setup() {
        // No capture backend in the standalone build, so no config to load.
        const isStandalone = __IS_STANDALONE__;
        const cfgPath = ref('');
        const file = ref<AppConfig | null>(null);
        const draft = ref<AppConfig | null>(null);
        const overrides = ref<ConfigResponse['overrides']>({});
        const loadError = ref('');
        const fetchError = ref('');
        const saveError = ref('');
        const savedHints = ref<string[]>([]);
        const saving = ref(false);
        const effectivePort = ref(0);

        const load = async () => {
            fetchError.value = '';
            try {
                const r = await fetch('/api/config');
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const d = await r.json() as ConfigResponse;
                cfgPath.value = d.path;
                file.value = { ...d.file };
                draft.value = { ...d.file };
                overrides.value = d.overrides ?? {};
                effectivePort.value = d.effective.port;
                loadError.value = d.loadError ? loadErrorNote(d.loadError) : '';
            } catch (e) {
                fetchError.value = `無法讀取設定:${e instanceof Error ? e.message : String(e)}`;
            }
        };
        onMounted(() => { if (!isStandalone) load(); });

        const portError = computed(() => draft.value ? validatePort(draft.value.port) : null);
        const canSave = computed(() =>
            !!draft.value && !!file.value && !portError.value && isDirty(draft.value, file.value));
        // Hide the stale "已儲存" block once further edits reopen the draft.
        const showSaved = computed(() =>
            savedHints.value.length > 0 && !!draft.value && !!file.value && !isDirty(draft.value, file.value));

        const save = async () => {
            if (!draft.value || !file.value) return;
            saving.value = true;
            saveError.value = '';
            savedHints.value = [];
            try {
                const r = await fetch('/api/config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(draft.value),
                });
                if (!r.ok) {
                    let msg = `HTTP ${r.status}`;
                    try {
                        const body = await r.json() as { error?: string };
                        if (body.error) msg = body.error;
                    } catch { /* non-JSON error body; keep the HTTP status */ }
                    throw new Error(msg);
                }
                const d = await r.json() as SaveResponse;
                const previous = file.value;
                file.value = { ...d.saved };
                draft.value = { ...d.saved };
                cfgPath.value = d.path;
                loadError.value = '';
                savedHints.value = saveHints(d.saved, previous, d.restartRequired);
            } catch (e) {
                saveError.value = e instanceof Error ? e.message : String(e);
            } finally {
                saving.value = false;
            }
        };

        return {
            isStandalone, cfgPath, draft, overrides, loadError, fetchError, saveError, savedHints, saving,
            effectivePort, portError, canSave, showSaved, save, overrideNote, PORT_MIN, PORT_MAX,
        };
    },
});
</script>
