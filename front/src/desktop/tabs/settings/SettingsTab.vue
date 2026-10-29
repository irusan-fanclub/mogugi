<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
    dpsDisplayBody, isDirty, loadErrorNote, saveHints, validateMemoryLimit, validatePort, type AppConfig, type DpsDisplay,
} from '@/lib/appSettings';
import { zhPunct } from '../../text/zhPunct';
import { copyWithFallback } from '@/lib/captureStatus';
import { getConfig, openConfigFile, putConfig, revealConfigFile } from '@/lib/configApi';
import { clearLogs, getLogUsage, openLogsDir, packLogs, type LogKind, type LogUsage } from '@/lib/logsApi';
import { humanReadableBytes } from '@/lib/battleFilter';
import { emitDesktop } from '@/lib/desktopBridge';
import DAlert from '../../ui/DAlert.vue';
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DSegmented from '../../ui/DSegmented.vue';
import DSwitch from '../../ui/DSwitch.vue';
import DTextField from '../../ui/DTextField.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { useToast } from '../../ui/useToast';
import { useLicenseGuard, useSession } from '../../session';
import AboutSection from './AboutSection.vue';
import { isDesktop } from '@/lib/runtimeEnv';

// The "open in browser" section only makes sense inside the desktop shell.
const desktop = isDesktop();

const session = useSession();
const guard = useLicenseGuard();
const ctx = useContextMenu();
const toast = useToast();

// Convert the fixed wording only; backend-supplied text (paths) stays as is.
function loadNote(msg: string): string {
    const note = loadErrorNote(msg);
    const i = note.indexOf(msg);
    return zhPunct(note.slice(0, i)) + msg + zhPunct(note.slice(i + msg.length));
}

const cfgPath = ref('');
const effectivePort = ref(0);
const effectiveLan = ref(false);
const lanUrls = ref<string[]>([]);
const file = ref<AppConfig | null>(null);
const draft = reactive<AppConfig>({ savePcapng: false, autoOpenBrowser: false, autoPort: false, port: 0, memoryLimitMB: 150, allowLan: false, savePacketLog: false });
const portText = ref('');
const memText = ref('');
const loadError = ref('');
const fetchError = ref('');
const saveError = ref('');
const savedHints = ref<string[]>([]);
const saving = ref(false);

function adopt(c: AppConfig) {
    file.value = { ...c };
    Object.assign(draft, { ...c, allowLan: c.allowLan ?? false, savePacketLog: c.savePacketLog ?? false });
    portText.value = String(c.port);
    memText.value = String(c.memoryLimitMB);
}

async function load() {
    fetchError.value = '';
    try {
        const d = await getConfig();
        cfgPath.value = d.path;
        adopt(d.file);
        effectivePort.value = d.effective.port;
        effectiveLan.value = d.effective.allowLan ?? false;
        lanUrls.value = d.effective.lanUrls ?? [];
        loadError.value = d.loadError ? loadNote(d.loadError) : '';
    } catch (e) {
        if (guard(e)) return;
        fetchError.value = `無法讀取設定：${e instanceof Error ? e.message : String(e)}`;
    }
}
onMounted(() => { void load(); void refreshUsage(); });
// Kept alive between tab switches: sizes may have changed meanwhile.
onActivated(() => { void refreshUsage(); });

// A type=number input may hand back a number, so normalise through String.
const portNum = computed(() => String(portText.value).trim() === '' ? NaN : Number(portText.value));
// Auto port ignores the port field, so an invalid value must not block saving.
const portError = computed(() => draft.autoPort ? null : validatePort(portNum.value));
// With auto port on, an invalid field falls back to the saved port.
const savePort = computed(() =>
    draft.autoPort && validatePort(portNum.value) ? (file.value?.port ?? 0) : portNum.value);
const memNum = computed(() => String(memText.value).trim() === '' ? NaN : Number(memText.value));
const memError = computed(() => validateMemoryLimit(memNum.value));
const lanDirty = computed(() => !!file.value && (file.value.allowLan ?? false) !== draft.allowLan);
const dirty = computed(() =>
    !!file.value && (isDirty({ ...draft, port: savePort.value, memoryLimitMB: memNum.value }, file.value) || lanDirty.value));
const canSave = computed(() => !!file.value && !portError.value && !memError.value && dirty.value && !saving.value);
// Hide the stale "已儲存" block once further edits reopen the draft.
const showSaved = computed(() => savedHints.value.length > 0 && !dirty.value);

async function save() {
    if (!file.value || !canSave.value) return;
    saving.value = true;
    saveError.value = '';
    savedHints.value = [];
    try {
        const previous = file.value;
        const d = await putConfig({ ...draft, port: savePort.value, memoryLimitMB: memNum.value, dpsDisplay: previous.dpsDisplay });
        adopt(d.saved);
        cfgPath.value = d.path;
        loadError.value = '';
        const hints = saveHints(d.saved, previous, d.restartRequired).map(zhPunct);
        if ((previous.allowLan ?? false) !== (d.saved.allowLan ?? false)) hints.push('允許區網連線：重啟後生效');
        savedHints.value = hints;
    } catch (e) {
        if (!guard(e)) saveError.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

// The DPS-display switch saves at once, apart from the draft.
const switching = ref(false);
const switchError = ref('');
async function switchDps(mode: DpsDisplay) {
    if (!file.value || mode === (file.value.dpsDisplay ?? 'desktop')) return;
    switching.value = true;
    switchError.value = '';
    try {
        const d = await putConfig(dpsDisplayBody(file.value, mode));
        file.value = { ...file.value, dpsDisplay: d.saved.dpsDisplay };
        draft.dpsDisplay = d.saved.dpsDisplay;
    } catch (e) {
        if (!guard(e)) switchError.value = `切換失敗：${e instanceof Error ? e.message : String(e)}`;
    } finally {
        switching.value = false;
    }
}

const wsPort = new URLSearchParams(location.search).get('wsPort');
// A LAN browser must not be shown its own loopback; it uses the address it came in on.
const url = computed(() => desktop
    ? `http://127.0.0.1:${effectivePort.value || wsPort || location.port}/`
    : `${location.origin}/`);

async function copy(text: string) {
    toast.show(await copyWithFallback(text) === 'copied' ? '已複製' : '複製失敗');
}
const urlCopied = ref(false);
async function copyUrl() {
    if (await copyWithFallback(url.value) === 'copied') {
        urlCopied.value = true;
        setTimeout(() => { urlCopied.value = false; }, 2000);
    } else toast.show('複製失敗');
}
const openBrowser = () => { void emitDesktop('control:open-browser'); };
async function run(fn: () => Promise<unknown>, fail: string) {
    try { await fn(); } catch (e) {
        if (!guard(e)) toast.show(`${fail}：${e instanceof Error ? e.message : String(e)}`);
    }
}
const openCfg = () => run(openConfigFile, '開啟失敗');
const revealCfg = () => run(revealConfigFile, '開啟失敗');
const openLogs = () => run(openLogsDir, '開啟失敗');

const usage = ref<LogUsage>({ logBytes: 0, pcapBytes: 0 });
async function refreshUsage() {
    try { usage.value = await getLogUsage(); } catch (e) { guard(e); }
}
// First click arms the button; a second click within 4s does the clear.
const armed = ref<LogKind | null>(null);
let armTimer: ReturnType<typeof setTimeout> | undefined;
async function clearKind(kind: LogKind) {
    if (armed.value !== kind) {
        armed.value = kind;
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed.value = null; }, 4000);
        return;
    }
    clearTimeout(armTimer);
    armed.value = null;
    try {
        const r = await clearLogs(kind);
        toast.show(r.failed.length ? `已清除 ${humanReadableBytes(r.freedBytes)}，${r.failed.length} 個檔案清除失敗` : `已清除 ${humanReadableBytes(r.freedBytes)}`);
    } catch (e) {
        if (!guard(e)) toast.show(`清除失敗：${e instanceof Error ? e.message : String(e)}`);
    }
    await refreshUsage();
}
const packing = ref(false);
async function pack() {
    packing.value = true;
    try { toast.show(`已打包：${await packLogs()}`); } catch (e) {
        if (!guard(e)) toast.show(`打包失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally { packing.value = false; void refreshUsage(); }
}
onBeforeUnmount(() => clearTimeout(armTimer));

function pathMenu(e: MouseEvent) {
    ctx.open(e, [{ label: '複製設定檔路徑', disabled: !cfgPath.value, action: () => copy(cfgPath.value) }]);
}
function lanMenu(e: MouseEvent, u: string) {
    ctx.open(e, [{ label: '複製網址', action: () => copy(u) }]);
}
function urlMenu(e: MouseEvent) {
    ctx.open(e, [{ label: '複製網址', action: () => copy(url.value) }]);
}
</script>

<template>
  <div class="settings">
    <section>
      <h2>應用程式</h2>
      <div class="meta cfg-row" data-path @contextmenu="pathMenu">
        <span class="cfg-text">設定檔：{{ cfgPath || '讀取中' }}</span>
        <template v-if="desktop">
          <DIconButton icon="mdi-file-cog-outline" title="開啟設定檔" @click="openCfg" />
          <DIconButton icon="mdi-folder-open-outline" title="開啟設定檔資料夾" @click="revealCfg" />
        </template>
      </div>
      <DAlert v-if="loadError" kind="warn">{{ loadError }}</DAlert>
      <DAlert v-if="fetchError" kind="error">{{ fetchError }}</DAlert>

      <template v-if="file">
        <div class="opt" data-memory>
          <div class="label">戰鬥資料記憶體上限</div>
          <div class="mem-row">
            <DTextField v-model="memText" type="number" class="mem-field" min="50" max="1000" step="10" :error="memError || undefined" />
            <span class="unit">MB</span>
          </div>
          <div class="hint">超過時從最舊的一場戰鬥開始回收。白名單副本另有紀錄可查。</div>
        </div>

        <div class="opt">
          <DSwitch v-model="draft.autoPort" data-autoport label="自動切換 port" />
          <div class="hint">port 被占用時自動往後找（8030 到 8040），並偵測已開啟的 mogugi。下次啟動生效。</div>
        </div>
        <div class="opt" data-port>
          <DTextField
            v-model="portText"
            type="number"
            class="port-field"
            :disabled="draft.autoPort"
            :error="portError ?? undefined"
            :hint="draft.autoPort ? '自動切換 port 開啟時此設定無效' : '網頁使用的 port；想同時使用不同家 DPS Meter 可以修改，建議 8030 到 8040。重啟後生效。'"
          />
        </div>
      </template>
    </section>

    <section v-if="file" data-web-block>
      <h2>網頁版UI設定</h2>
      <div class="label">是否使用網頁版UI</div>
      <DSegmented
        data-dps
        :model-value="file.dpsDisplay ?? 'desktop'"
        :disabled="switching"
        :options="[{ value: 'desktop', label: '否' }, { value: 'web', label: '是' }]"
        @update:model-value="switchDps"
      />
      <div class="hint" data-dps-hint>是：另外在瀏覽器顯示 DPS，主視窗照常可用。立即生效。</div>
      <div v-if="switchError" class="err">{{ switchError }}</div>

      <div class="opt">
        <DSwitch v-model="draft.autoOpenBrowser" data-autobrowser label="啟動時自動開啟瀏覽器" />
        <div class="hint">下次啟動生效。</div>
      </div>

      <div class="label">網頁版 URL</div>
      <div class="row" @contextmenu="urlMenu">
        <span class="url" data-url>{{ url }}</span>
        <DButton v-if="desktop" data-open @click="openBrowser">開啟</DButton>
        <DButton data-copy-url @click="copyUrl">{{ urlCopied ? '已複製' : '複製' }}</DButton>
      </div>

      <div class="opt">
        <DSwitch v-model="draft.allowLan" data-lan label="允許區網連線" />
        <div class="hint">允許同一區網的其他裝置連到網頁版。重啟後生效。</div>
      </div>

      <div class="label">區網連線 URL</div>
      <template v-if="effectiveLan && lanUrls.length">
        <div v-for="u in lanUrls" :key="u" class="row lan-row" data-lan-url @contextmenu="lanMenu($event, u)">
          <span class="url">{{ u }}</span>
          <DIconButton icon="mdi-content-copy" title="複製" @click="copy(u)" />
        </div>
      </template>
      <div v-else-if="effectiveLan" class="hint" data-lan-hint>找不到區網 IPv4 位址</div>
      <div v-else class="hint" data-lan-hint>需開啟允許區網連線並重新啟動</div>
    </section>

    <section v-if="file" data-log-block>
      <h2>LOG 設定</h2>
      <div class="row">
        <DButton v-if="desktop" data-open-logs @click="openLogs">開啟LOG資料夾</DButton>
      </div>

      <div class="opt">
        <DSwitch v-model="draft.savePcapng" data-pcap label="保存封包原始紀錄（pcapng）" />
        <div class="hint">pcapng 檔可用於其他家 DPS Meter 還原；會隨時間變大。重新啟動 mogugi 後生效。</div>
      </div>
      <div class="opt">
        <DSwitch v-model="draft.savePacketLog" data-save-log label="保存LOG" />
        <div class="hint">保存整個工作階段的事件紀錄（packet_log），供除錯使用，檔案可能很大。文字 LOG 一律保存。重新啟動 mogugi 後生效。</div>
      </div>

      <div class="opt">
        <div class="row">
          <DButton data-pack :loading="packing" @click="pack">打包當前LOG</DButton>
        </div>
        <div class="hint">用此功能打包除錯資訊給開發者</div>
      </div>

      <div class="row usage">
        <span class="usage-label">LOG 使用空間</span>
        <span class="usage-val" data-log-usage>{{ humanReadableBytes(usage.logBytes) }}</span>
        <DButton data-clear-log @click="clearKind('log')">{{ armed === 'log' ? '確認清除' : '清除LOG' }}</DButton>
      </div>
      <div class="row usage">
        <span class="usage-label">原始紀錄使用空間</span>
        <span class="usage-val" data-pcap-usage>{{ humanReadableBytes(usage.pcapBytes) }}</span>
        <DButton data-clear-pcap @click="clearKind('pcap')">{{ armed === 'pcap' ? '確認清除' : '清除原始紀錄' }}</DButton>
      </div>
    </section>

    <section v-if="file">
      <div class="actions">
        <DButton variant="primary" data-save :disabled="!canSave" :loading="saving" @click="save">儲存</DButton>
        <span v-if="saveError" class="err">{{ saveError }}</span>
      </div>
      <div v-if="showSaved" class="saved" data-saved>
        <div>已儲存。</div>
        <div v-for="(h, i) in savedHints" :key="i" class="hint">{{ h }}</div>
      </div>
    </section>

    <AboutSection :connected="session.connected.value" />
  </div>
</template>

<style scoped>
.settings { height: 100%; overflow-y: auto; padding: var(--space-4) var(--space-5); scrollbar-gutter: stable; }
section { max-width: 640px; margin-bottom: var(--space-5); padding-bottom: var(--space-4); border-bottom: 1px solid var(--c-line); }
h2 { margin: 0 0 var(--space-3); font-size: var(--fs-lg); }
.meta { margin-bottom: var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); word-break: break-all; }
.cfg-row { display: flex; align-items: center; gap: var(--space-2); }
.cfg-text { flex: 1; min-width: 0; }
.lan-row { margin-top: var(--space-2); }
.usage { margin-top: var(--space-3); }
.usage-label { min-width: 140px; font-size: var(--fs-md); }
.usage-val { min-width: 90px; font-family: var(--font-num); font-size: var(--fs-md); }
.label { margin: var(--space-3) 0 var(--space-2); font-size: var(--fs-md); }
.opt { margin-top: var(--space-3); }
.hint { color: var(--c-text-dim); font-size: var(--fs-xs); }
.err { color: var(--c-err); font-size: var(--fs-sm); }
.mem-row { display: flex; align-items: flex-start; gap: var(--space-2); }
.mem-field { width: 160px; }
.unit { line-height: var(--row-h); color: var(--c-text-dim); font-size: var(--fs-md); }
.port-field { max-width: 320px; }
.actions { display: flex; align-items: center; gap: var(--space-4); margin-top: var(--space-4); }
.saved { margin-top: var(--space-3); font-size: var(--fs-sm); }
.row { display: flex; align-items: center; gap: var(--space-3); }
.url { flex: 1; min-width: 0; padding: 0 var(--space-3); border: 1px solid var(--c-line); border-radius: var(--radius); background: var(--c-bg-deep); font-family: var(--font-num); font-size: var(--fs-md); line-height: var(--row-h); }
</style>
