<template>
    <v-sheet class="pa-6" style="max-width: 640px;">
        <div class="text-h5 mb-4">mogugi <span style="opacity:0.5; font-size:0.7em;">v{{ appVersion }}</span></div>
        <div v-if="appTagline" class="mb-4" style="opacity:0.7; font-style: italic;">{{ appTagline }}</div>

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

        <div class="mt-4">
            <v-btn href="https://discord.gg/pJQsN4HgsD" target="_blank" rel="noopener noreferrer"
                variant="tonal" size="small" prepend-icon="mdi-discord">加入 Discord</v-btn>
        </div>

        <v-divider class="my-6" />

        <div>
            <div class="text-subtitle-2 mb-2" style="opacity:0.6;">封包擷取（Npcap）</div>
            <p class="mb-2" style="font-size:0.9em;">
                mogugi 需要 Npcap 才能讀取瑪奇的網路封包；若下方顯示未安裝，請到
                <a href="https://npcap.com" target="_blank" rel="noopener noreferrer">https://npcap.com</a>
                下載安裝（預設選項即可），安裝後重新啟動 mogugi。
            </p>

            <p v-if="isStandalone" style="opacity:0.6; font-size:0.9em;">（此版本不含擷取功能）</p>
            <v-list v-else density="compact" class="pl-0">
                <v-list-item class="pl-0">
                    <v-icon :icon="status.npcapOk ? 'mdi-check' : 'mdi-close'"
                        :color="status.npcapOk ? 'success' : 'error'" class="mr-1" />Npcap 已安裝
                </v-list-item>
                <v-list-item class="pl-0">
                    <v-icon :icon="status.gameDetected ? 'mdi-check' : 'mdi-close'"
                        :color="status.gameDetected ? 'success' : 'error'" class="mr-1" />偵測到遊戲連線
                </v-list-item>
                <v-list-item class="pl-0">
                    <v-icon :icon="status.capturing ? 'mdi-check' : 'mdi-close'"
                        :color="status.capturing ? 'success' : 'error'" class="mr-1" />正在擷取封包
                </v-list-item>
            </v-list>
        </div>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, computed, onMounted } from 'vue';
import { captureStatus } from '@/store';

export default defineComponent({
    name: 'About',
    setup() {
        const appVersion = __APP_VERSION__;
        const appTagline = __APP_TAGLINE__;
        const isStandalone = __IS_STANDALONE__;

        // Display defaults to all-unknown (shown as ✗) until a live socket
        // event or the fetch below reports something real.
        const status = computed(() => captureStatus.value ?? {
            npcapOk: false, gameDetected: false, capturing: false, lastPacketAt: 0,
        });

        // Fallback for a client that mounts before the watchdog's first
        // status publish (or missed the socket's initial snapshot).
        onMounted(async () => {
            if (isStandalone || captureStatus.value) return;
            try {
                const r = await fetch('/api/status');
                const d = await r.json();
                if (captureStatus.value) return; // a live event won the race
                captureStatus.value = {
                    npcapOk: !!d.NpcapOk,
                    gameDetected: !!d.GameDetected,
                    capturing: !!d.Capturing,
                    lastPacketAt: d.LastPacketAt || 0,
                };
            } catch { /* keep unknown; the guide text still explains setup */ }
        });

        return { appVersion, appTagline, isStandalone, status };
    },
});
</script>
