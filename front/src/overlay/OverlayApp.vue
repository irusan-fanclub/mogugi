<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { emitDesktop } from '@/lib/desktopBridge';
import { COMPONENTS, layoutOf } from '@/lib/overlayComponents';
import type { Size } from '@/lib/overlayLayout';
import { unclampedRect } from '@/lib/overlayLayout';
import { OV, type Anchor, type ComponentId, type OverlayLayout } from '@/lib/overlayProtocol';
import { FONT_PX } from '@/lib/overlaySettings';
import { offsetsFor } from '@/lib/overlayLayout';
import { useOverlayData } from './useOverlayData';
import { useLayoutDrag } from './layoutDrag';
import { sampleAlerts, sampleCc, sampleCooldown, sampleDps } from './sampleData';
import ComponentFrame from './ComponentFrame.vue';
import LayoutEditor from './LayoutEditor.vue';
import DpsOverlay from './DpsOverlay.vue';
import CcOverlay from './CcOverlay.vue';
import CooldownOverlay from './CooldownOverlay.vue';
import AlertsOverlay from './AlertsOverlay.vue';

const IDS = COMPONENTS.map(c => c.id);
const ANCHOR_CYCLE: Anchor[] = ['tl', 'tr', 'br', 'bl', 'center'];

const data = useOverlayData();
const { settings, state } = data;

const root = ref<HTMLElement | null>(null);
const raw = reactive({ w: window.innerWidth, h: window.innerHeight });
const scale = computed(() => settings.value.scale / 100);
// Geometry works in pre-scale units: the stage is scaled up, so it sees a smaller window.
const viewport = computed<Size>(() => ({ w: raw.w / scale.value, h: raw.h / scale.value }));

let ro: ResizeObserver | undefined;
function measureViewport() {
    const el = root.value;
    if (!el) return;
    raw.w = el.clientWidth || window.innerWidth;
    raw.h = el.clientHeight || window.innerHeight;
}
onMounted(() => {
    measureViewport();
    if (root.value && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(measureViewport);
        ro.observe(root.value);
    }
});
onBeforeUnmount(() => ro?.disconnect());

const editing = computed(() => state.value?.locked === false);
// A saved layout shown at once; Go echoes it back in overlay:state after it was stored.
const pending = reactive<Partial<Record<ComponentId, OverlayLayout>>>({});
const PENDING_MAX_MS = 2000;
const pendingTimers = new Map<ComponentId, ReturnType<typeof setTimeout>>();
const sameLayout = (a: OverlayLayout, b: OverlayLayout) =>
    a.enabled === b.enabled && a.anchor === b.anchor && a.x === b.x && a.y === b.y && a.width === b.width && a.maxRows === b.maxRows;
function dropPending(id: ComponentId) {
    delete pending[id];
    clearTimeout(pendingTimers.get(id));
    pendingTimers.delete(id);
}
watch(state, st => {
    for (const id of IDS) {
        const p = pending[id];
        const got = st?.layout?.[id];
        if (p && got && sameLayout(p, got)) dropPending(id);
    }
});
onBeforeUnmount(() => { pendingTimers.forEach(t => clearTimeout(t)); });
const layoutFor = (id: ComponentId) => pending[id] ?? layoutOf(id, state.value?.layout);
const heights = reactive<Record<string, number>>({});
const heightOf = (id: ComponentId) => heights[id] ?? 0;

function save(id: ComponentId, layout: OverlayLayout) {
    pending[id] = layout;
    clearTimeout(pendingTimers.get(id));
    pendingTimers.set(id, setTimeout(() => dropPending(id), PENDING_MAX_MS));
    void emitDesktop(OV.setLayout, { id, layout });
}

const { drag, rects, start, move, end, cancel } = useLayoutDrag({
    ids: IDS, viewport, scale, layoutOf: layoutFor, heightOf, save,
});
watch(editing, e => { if (!e) cancel(); });

function cycleAnchor(id: ComponentId) {
    const lay = layoutFor(id);
    const r = unclampedRect(lay, heightOf(id), viewport.value);
    const next = ANCHOR_CYCLE[(ANCHOR_CYCLE.indexOf(lay.anchor) + 1) % ANCHOR_CYCLE.length];
    const o = offsetsFor(r, next, viewport.value);
    save(id, { ...lay, anchor: next, x: o.x, y: o.y });
}
function toggle(id: ComponentId) {
    const lay = layoutFor(id);
    save(id, { ...lay, enabled: !lay.enabled });
}
function reset() {
    for (const c of COMPONENTS) save(c.id, { ...c.defaultLayout, enabled: layoutFor(c.id).enabled });
}
function lock() { void emitDesktop(OV.setLocked, { locked: true }); }

const hasData = computed<Record<ComponentId, boolean>>(() => {
    const { dps, cc, cooldown, alerts } = data;
    return {
        dps: dps.value.rows.length > 0,
        cc: !!(cc.value.boss || cc.value.self || cc.value.party.length),
        cooldown: cooldown.value.length > 0,
        alerts: alerts.value.length > 0,
    };
});

const visible = computed(() => COMPONENTS.filter(c => {
    const on = layoutFor(c.id).enabled;
    return editing.value || (on && hasData.value[c.id]);
}));

function fontPx(id: ComponentId) {
    return id === 'dps' ? FONT_PX[settings.value.dps.fontSize] : 14;
}

const samples = {
    dps: sampleDps(), cc: sampleCc(), cooldown: sampleCooldown(), alerts: sampleAlerts(),
};
const useSample = (id: ComponentId) => editing.value && !hasData.value[id];
const dpsVm = (max: number) => {
    const v = useSample('dps') ? samples.dps : data.dps.value;
    return { ...v, rows: v.rows.slice(0, max) };
};
const ccVm = (max: number) => {
    const v = useSample('cc') ? samples.cc : data.cc.value;
    return { ...v, party: v.party.slice(0, max) };
};
const cooldownRows = () => (useSample('cooldown') ? samples.cooldown : data.cooldown.value);
const alertItems = () => (useSample('alerts') ? samples.alerts : data.alerts.value);

const editorComps = computed(() => IDS.map(id => ({
    id, enabled: layoutFor(id).enabled, anchor: layoutFor(id).anchor, rect: rects.value[id],
})));
const stageStyle = computed(() => ({
    width: viewport.value.w + 'px',
    height: viewport.value.h + 'px',
    transform: `scale(${scale.value})`,
    '--ov-inv': String(1 / scale.value),
}));
</script>

<template>
  <div ref="root" class="ov-root" :class="{ unlocked: editing }">
    <div class="ov-stage" :style="stageStyle">
      <LayoutEditor
        :active="editing" :viewport="viewport" :scale="scale" :comps="editorComps"
        :drag-id="drag?.id ?? null" :drag-mode="drag?.mode ?? null" :cell="drag?.cell ?? null"
        :guides="drag?.guides ?? []" :hotkey="state?.hotkey ?? ''"
        @lock="lock" @reset="reset"
      >
        <ComponentFrame
          v-for="c in visible" :key="c.id"
          :id="c.id" :name="c.name"
          :left="rects[c.id].l" :top="rects[c.id].t" :width="rects[c.id].w"
          :anchor="layoutFor(c.id).anchor" :enabled="layoutFor(c.id).enabled"
          :opacity="settings[c.id].opacity" :font-px="fontPx(c.id)"
          :editing="editing" :sample="useSample(c.id)"
          :clamped="rects[c.id].clamped" :dragging="drag?.id === c.id"
          @down="(e, mode) => start(c.id, mode, e)" @move="move" @up="end" @cancel="cancel"
          @anchor="cycleAnchor(c.id)" @toggle="toggle(c.id)" @height="h => (heights[c.id] = h)"
        >
          <DpsOverlay v-if="c.id === 'dps'" :vm="dpsVm(layoutFor('dps').maxRows)" :settings="settings.dps" />
          <CcOverlay v-else-if="c.id === 'cc'" :vm="ccVm(layoutFor('cc').maxRows)" :settings="settings.cc" />
          <CooldownOverlay
            v-else-if="c.id === 'cooldown'" :rows="cooldownRows()" :settings="settings.cooldown"
            :max-rows="layoutFor('cooldown').maxRows"
          />
          <AlertsOverlay
            v-else :items="alertItems()" :settings="settings.alerts"
            :anchor="layoutFor('alerts').anchor" :max-rows="layoutFor('alerts').maxRows"
          />
        </ComponentFrame>
      </LayoutEditor>
    </div>
  </div>
</template>
