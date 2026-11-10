<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';
import { decodeShare, MAX_TEXT, SHARE_ERROR_TEXT, type ShareError, type SharePayload } from '@/lib/overlayShareCodec';
import {
    REGIONS, applyOps, mergeImport, regionSummary, undoOps,
    type Layouts, type RegionId, type RegionPick,
} from '@/lib/overlayShareMerge';
import type { OverlaySettings } from '@/lib/overlaySettings';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import { useOverlayState } from '../../overlay/useOverlayState';
import DDialog from '../../ui/DDialog.vue';
import DButton from '../../ui/DButton.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import DTextarea from '../../ui/DTextarea.vue';

const open = defineModel<boolean>({ default: false });
const { state, replaceLayouts } = useOverlayState();

const text = ref('');
const error = ref<ShareError | null>(null);
// Shallow: mergeImport structuredClones it, which fails on reactive proxies.
const payload = shallowRef<SharePayload | null>(null);
const picks = reactive({}) as Record<RegionId, RegionPick>;
const applied = ref<{ regions: number; withPos: number } | null>(null);
const undone = ref(false);
const fileInput = ref<HTMLInputElement>();

let debounce: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
// Taken at apply time; dropped when the dialog closes.
let snapshot: { settings: OverlaySettings; layouts: Layouts; ops: ReturnType<typeof mergeImport> } | null = null;

function reset() {
    clearTimeout(debounce);
    seq++;
    text.value = '';
    error.value = null;
    payload.value = null;
    applied.value = null;
    undone.value = false;
    snapshot = null;
}
watch(open, v => { if (!v) reset(); });
onBeforeUnmount(() => clearTimeout(debounce));

async function parse(raw: string, mine = ++seq) {
    if (!raw.trim()) { error.value = null; return; }
    const r = await decodeShare(raw);
    if (mine !== seq) return;
    if (!r.ok) { error.value = r.error; return; }
    error.value = null;
    for (const reg of REGIONS) picks[reg.id] = { import: true, position: false };
    payload.value = r.payload;
}

function onInput() {
    clearTimeout(debounce);
    debounce = setTimeout(() => { void parse(text.value); }, 200);
}

async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    clearTimeout(debounce);
    const mine = ++seq;
    if (file.size > MAX_TEXT) { error.value = 'tooBig'; return; }
    const raw = await file.text();
    // Closing or re-pasting during the read bumps seq; drop the late result.
    if (mine !== seq) return;
    await parse(raw, mine);
}

function repaste() {
    seq++;
    text.value = '';
    error.value = null;
    payload.value = null;
}

function setAll(col: 'import' | 'position', on: boolean) {
    for (const r of REGIONS) {
        if (col === 'import') {
            picks[r.id].import = on;
            if (!on) picks[r.id].position = false;
        } else if (r.hasPosition && picks[r.id].import) {
            picks[r.id].position = on;
        }
    }
}
function onImportToggle(id: RegionId) {
    if (!picks[id].import) picks[id].position = false;
}

const importCount = computed(() => payload.value ? REGIONS.filter(r => picks[r.id]?.import).length : 0);

function apply() {
    const p = payload.value;
    if (!p || importCount.value === 0) return;
    const eff: Partial<Record<RegionId, RegionPick>> = {};
    for (const r of REGIONS) eff[r.id] = { import: picks[r.id].import, position: r.hasPosition && picks[r.id].position };
    const layouts: Layouts = { ...(state.value?.layout ?? {}) };
    // Plain copies: reactive proxies cannot be structuredCloned.
    const settingsBefore = JSON.parse(JSON.stringify(overlaySettings.value)) as OverlaySettings;
    const r = mergeImport(settingsBefore, JSON.parse(JSON.stringify(layouts)) as Layouts, p, eff);
    snapshot = { settings: settingsBefore, layouts: JSON.parse(JSON.stringify(layouts)) as Layouts, ops: r };
    replaceLayouts(r.saves, r.removes);
    updateOverlaySettings(s => { Object.assign(s, r.settings); });
    applied.value = {
        regions: REGIONS.filter(x => eff[x.id]!.import).length,
        withPos: REGIONS.filter(x => eff[x.id]!.import && eff[x.id]!.position).length,
    };
}

function undo() {
    if (!snapshot) return;
    const u = undoOps(snapshot.layouts, applyOps(snapshot.layouts, snapshot.ops));
    replaceLayouts(u.saves, u.removes);
    const before = snapshot.settings;
    updateOverlaySettings(s => { Object.assign(s, JSON.parse(JSON.stringify(before))); });
    undone.value = true;
}
</script>

<template>
  <DDialog v-model="open" title="匯入 overlay 設定" :width="payload ? 560 : 520">
    <template v-if="applied">
      <div class="okbox" data-share-applied>
        <i :class="undone ? 'mdi mdi-undo' : 'mdi mdi-check-circle-outline'" />
        <template v-if="undone">已復原成匯入前的設定</template>
        <template v-else>已套用 {{ applied.regions }} 個大區<template v-if="applied.withPos">，其中 {{ applied.withPos }} 個連同位置</template></template>
      </div>
      <div v-if="!undone" class="hint">不滿意的話可以按「復原」回到匯入前的樣子；關閉這個視窗後就不能復原了。</div>
    </template>
    <template v-else-if="payload">
      <div class="okbox"><i class="mdi mdi-check-circle-outline" />讀取成功，選擇要套用哪些部分</div>
      <div class="tools">
        <span class="dim">匯入：</span>
        <a href="#" data-bulk="import-all" @click.prevent="setAll('import', true)">全選</a>
        <a href="#" data-bulk="import-none" @click.prevent="setAll('import', false)">全不選</a>
        <span class="grow" />
        <span class="dim">套用位置：</span>
        <a href="#" data-bulk="pos-all" @click.prevent="setAll('position', true)">全選</a>
        <a href="#" data-bulk="pos-none" @click.prevent="setAll('position', false)">全不選</a>
      </div>
      <table>
        <thead><tr><th>大區</th><th class="c">匯入</th><th class="c">套用位置</th></tr></thead>
        <tbody>
          <tr v-for="r in REGIONS" :key="r.id" data-region-row :class="{ off: !picks[r.id].import }">
            <td>{{ r.label }}<div v-if="regionSummary(payload, r.id)" class="sub">{{ regionSummary(payload, r.id) }}</div></td>
            <td class="c">
              <DCheckbox v-model="picks[r.id].import" :aria-label="`匯入${r.label}`" :[`data-import-${r.id}`]="''" @update:model-value="onImportToggle(r.id)" />
            </td>
            <td class="c">
              <DCheckbox v-model="picks[r.id].position" :aria-label="`${r.label}套用位置`" :[`data-position-${r.id}`]="''" :disabled="!r.hasPosition || !picks[r.id].import" />
              <div v-if="!r.hasPosition" class="sub">無位置</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="hint">勾了「匯入」的大區會整區換成對方的設定（圖示、外觀、排列順序、開關）。勾了「套用位置」才會連螢幕上的位置和大小一起換。</div>
    </template>
    <template v-else>
      <DTextarea v-model="text" :rows="4" class="share-text" placeholder="把別人分享的文字貼在這裡（以 mogugi-overlay: 開頭）" @input="onInput" />
      <div v-if="error" class="errbox" data-share-error><i class="mdi mdi-alert-circle-outline" />{{ SHARE_ERROR_TEXT[error] }}</div>
      <div class="hint">
        或 <DButton size="sm" @click="fileInput?.click()"><i class="mdi mdi-file-outline" />從檔案匯入</DButton>
        <input ref="fileInput" type="file" accept=".txt,text/plain" hidden @change="onFile">
      </div>
    </template>
    <template #actions>
      <template v-if="applied">
        <DButton v-if="!undone" class="left" @click="undo"><i class="mdi mdi-undo" />復原</DButton>
        <DButton variant="primary" @click="open = false">完成</DButton>
      </template>
      <template v-else-if="payload">
        <DButton class="left" @click="repaste">重新貼上</DButton>
        <DButton @click="open = false">取消</DButton>
        <DButton variant="primary" :disabled="importCount === 0" @click="apply">套用</DButton>
      </template>
      <DButton v-else @click="open = false">取消</DButton>
    </template>
  </DDialog>
</template>

<style scoped>
.share-text :deep(textarea) { height: 88px !important; overflow: auto; font-family: Consolas, monospace; font-size: var(--fs-sm); }
.hint { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-3); font-size: var(--fs-sm); color: var(--c-text-dim); }
.errbox { margin-top: var(--space-4); padding: var(--space-3) var(--space-4); border: 1px solid color-mix(in srgb, var(--c-err) 50%, transparent); border-radius: var(--radius); background: color-mix(in srgb, var(--c-err) 12%, transparent); color: var(--c-err); font-size: var(--fs-md); }
.okbox { padding: var(--space-3) var(--space-4); border: 1px solid color-mix(in srgb, var(--c-ok) 50%, transparent); border-radius: var(--radius); background: color-mix(in srgb, var(--c-ok) 12%, transparent); color: var(--c-ok); font-size: var(--fs-md); }
.okbox i, .errbox i { margin-right: var(--space-2); }
.tools { display: flex; gap: var(--space-3); margin: var(--space-4) 0 var(--space-3); font-size: var(--fs-sm); }
.tools a { color: var(--c-accent); text-decoration: none; }
.dim { color: var(--c-text-dim); }
.grow { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: var(--fs-md); }
th { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--c-line); color: var(--c-text-dim); font-size: var(--fs-sm); font-weight: 400; text-align: left; }
td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--c-line); }
th.c, td.c { width: 84px; text-align: center; }
tr.off td { color: var(--c-text-dim); }
.sub { font-size: var(--fs-xs); color: var(--c-text-dim); }
.left { margin-right: auto; }
</style>
