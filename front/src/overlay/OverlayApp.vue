<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { emitDesktop } from '@/lib/desktopBridge';
import { componentsOf, layoutOf, type ComponentDef } from '@/lib/overlayComponents';
import type { Rect, Size } from '@/lib/overlayLayout';
import { offsetsFor, unclampedRect } from '@/lib/overlayLayout';
import { OV, type Anchor, type ComponentId } from '@/lib/overlayProtocol';
import { iconPx, unitId, type SectionId } from '@/lib/overlaySections';
import type { TileVM } from '@/lib/overlayTiles';
import { useOverlayData } from './useOverlayData';
import { useLayoutDrag } from './layoutDrag';
import { usePendingLayouts } from './pendingLayouts';
import { dropSpot, useTileDrag, type TileDragCtx } from './tileDrag';
import { frameOfKey, planPlace, planTakeOut, type LayoutOp, type PlaceTarget } from '@/lib/overlayGroups';
import { sampleAlerts, sampleDps, sampleTiles } from './sampleData';
import {
    bgOf, fontPxOf, frameLook, frameTitle, gateOpen, inOrder, itemEnabled, itemName, labelOf, sectionOf, sectionOrder,
    tileLook, tilesFor,
} from './sectionView';
import ComponentFrame from './ComponentFrame.vue';
import LayoutEditor from './LayoutEditor.vue';
import DpsOverlay from './DpsOverlay.vue';
import TileGroup from './TileGroup.vue';
import MemberGrid from './MemberGrid.vue';
import { buildMemberGrid, type GridRow } from '@/lib/memberGrid';
import { memberClassOf } from '@/lib/overlayFrames';
import AlertsOverlay from './AlertsOverlay.vue';

const ANCHOR_CYCLE: Anchor[] = ['tl', 'tr', 'br', 'bl', 'center'];

const data = useOverlayData();
const { settings, state } = data;
const { layouts, save, remove: removeLayout } = usePendingLayouts(() => state.value?.layout);
const components = computed(() => componentsOf(settings.value, layouts.value, itemName));
const ids = computed(() => components.value.map(c => c.id));
const layoutFor = (id: ComponentId) => layoutOf(id, layouts.value);

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
const heights = reactive<Record<string, number>>({});
// A hidden component takes no room, so the one docked under it moves up.
const heightOf = (id: ComponentId) => (visibleIds.value.has(id) ? heights[id] ?? 0 : 0);

const { drag, rects, hostOf, start, move, end, cancel, undock, free } = useLayoutDrag({
    ids, viewport, scale, layoutOf: layoutFor, heightOf, save,
});

// ---- What each frame draws ----
const isPulled = (c: ComponentDef) => c.kind === 'unit' || c.kind === 'group';
const membersOf = (c: ComponentDef): string[] => (c.kind === 'unit' ? [c.key!] : c.keys ?? []);
const detached = computed(() => {
    const out = new Map<SectionId, Set<string>>();
    for (const c of components.value) {
        if (!isPulled(c)) continue;
        const set = out.get(c.section!) ?? new Set();
        for (const k of membersOf(c)) set.add(k);
        out.set(c.section!, set);
    }
    return out;
});
const orderOf = (sec: SectionId) => sectionOrder(settings.value, sec, layoutFor(sec).order);
const keysOf = (c: ComponentDef): string[] => (isPulled(c) ? membersOf(c)
    : orderOf(c.section!).filter(k => !detached.value.get(c.section!)?.has(k)));

const samples = { dps: sampleDps(), alerts: sampleAlerts() };
interface FrameView { tiles: TileVM[]; live: boolean }
const views = computed(() => {
    const out: Record<ComponentId, FrameView> = {};
    for (const c of components.value) {
        if (c.kind === 'dps') out[c.id] = { tiles: [], live: data.dps.value.rows.length > 0 };
        else if (c.kind === 'alerts') out[c.id] = { tiles: [], live: data.alerts.value.length > 0 };
        else {
            const keys = keysOf(c);
            const live = tilesFor(data.tiles.value[c.section!], keys);
            out[c.id] = live.length || !editing.value
                ? { tiles: live, live: live.length > 0 }
                : { tiles: inOrder(sampleTiles(sectionOf(settings.value, c.section!), keys), keys), live: false };
        }
    }
    return out;
});
const useSample = (c: ComponentDef) => editing.value && !views.value[c.id].live;

const shownLocked = (c: ComponentDef): boolean => {
    if (data.replaying.value) return false;
    const gate = { bossAlive: data.bossAlive.value, inDungeon: data.inDungeon.value };
    if (c.kind === 'dps') return data.bossPresent.value && views.value[c.id].live;
    if (c.kind === 'alerts') return views.value[c.id].live;
    return gateOpen(c.section!, gate) && views.value[c.id].live;
};
const visible = computed(() => components.value.filter(c => (editing.value
    ? !isPulled(c) || membersOf(c).some(k => itemEnabled(settings.value, c.section!, k))
    : layoutFor(c.id).enabled && shownLocked(c))));
const visibleIds = computed(() => new Set(visible.value.map(c => c.id)));

// ---- Tile drags ----
const frameEl = (id: ComponentId) => root.value?.querySelector<HTMLElement>(`[data-component="${id}"]`) ?? null;
const stageRect = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    const s = scale.value;
    return { l: r.left / s, t: r.top / s, w: r.width / s, h: r.height / s };
};
const frameOf = (sec: SectionId, key: string): ComponentId => frameOfKey(sec, key, layouts.value);
const compOf = (id: ComponentId) => components.value.find(c => c.id === id);

// A frame docked under a removed one moves to its heir, else is freed where it stands.
function dropFrame(id: ComponentId, heir?: ComponentId) {
    for (const o of ids.value) {
        if (o === id || hostOf(o) !== id) continue;
        save(o, heir ? { ...layoutFor(o), dock: heir } : free(o, rects.value[o]));
    }
    removeLayout(id);
}
function apply(ops: LayoutOp[]) {
    for (const op of ops) {
        if ('save' in op) save(op.save, op.layout);
        else dropFrame(op.remove, op.heir);
    }
}
function place(sec: SectionId, keys: string[], from: ComponentId, target: PlaceTarget | { at: { l: number; t: number } }) {
    let t: PlaceTarget;
    if ('at' in target) {
        const id = unitId(sec, keys[0]);
        const lay = layoutFor(id);
        const h = heights[id] ?? iconPx(sectionOf(settings.value, sec).look) + 18;
        t = { free: free(id, { l: target.at.l, t: target.at.t, w: lay.width, h }) };
    } else t = target;
    const keysOfSec = sectionOrder(settings.value, sec, undefined);
    apply(planPlace({ sec, layouts: layouts.value, layoutOf: layoutFor, keys: keysOfSec, sectionOrder: orderOf(sec) }, keys, from, t));
}
/** 「↩ 收回」 on a unit or group: every item back into the section frame. */
function recallFrame(c: ComponentDef) {
    const keysOfSec = sectionOrder(settings.value, c.section!, undefined);
    apply(planTakeOut({ sec: c.section!, layouts: layouts.value, layoutOf: layoutFor, keys: keysOfSec }, membersOf(c), c.id));
}

const tileCtx: TileDragCtx = {
    framesOf: sec => components.value.filter(c => c.section === sec && visibleIds.value.has(c.id)).map(c => c.id),
    frameRect: id => (visibleIds.value.has(id) ? rects.value[id] : null),
    keysIn: id => { const c = compOf(id); return c ? (c.kind === 'section' ? orderOf(c.section!) : membersOf(c)) : []; },
    tileRects: id => Array.from(frameEl(id)?.querySelectorAll<HTMLElement>('[data-tile-key]') ?? [])
        .map(el => ({ key: el.dataset.tileKey!, r: stageRect(el) })),
    frameOfKey: frameOf,
    originOf: (sec, key) => {
        const el = frameEl(frameOf(sec, key))?.querySelector(`[data-tile-key="${key}"]`);
        if (!el) return null;
        const r = stageRect(el);
        return { l: r.l, t: r.t };
    },
    columnsOf: () => null,
    viewport, scale, place,
};
const { tdrag, startTile, moveTile, endTile, cancelTile } = useTileDrag(tileCtx);
// A unit or group frame dragged over another frame of its section shows the bar there and merges on release.
const frameSpot = ref<{ frame: ComponentId; display: number } | null>(null);
watch(editing, e => { if (!e) { cancel(); cancelTile(); frameSpot.value = null; } });

function tileDown(sec: SectionId, key: string, e: PointerEvent) {
    if (e.button !== 0) return;
    // The frame under the tile must not start a frame drag.
    e.stopPropagation();
    e.preventDefault?.();
    try { root.value?.setPointerCapture?.(e.pointerId); } catch { /* the drag still works without capture */ }
    startTile(sec, key, e);
}

const pulledDrag = () => {
    const d = drag.value;
    const c = d && d.mode === 'move' && d.moved ? compOf(d.id) : undefined;
    return c && isPulled(c) ? c : null;
};
const spotAt = (c: ComponentDef, e: PointerEvent) =>
    dropSpot(tileCtx, c.section!, membersOf(c), { x: e.clientX / scale.value, y: e.clientY / scale.value }, c.id);
function frameMove(e: PointerEvent) {
    move(e);
    const c = pulledDrag();
    const s = c && spotAt(c, e);
    frameSpot.value = s?.frame ? { frame: s.frame, display: s.display } : null;
}
function frameUp(e: PointerEvent) {
    const c = pulledDrag();
    frameSpot.value = null;
    const s = c && spotAt(c, e);
    if (c && s?.frame) {
        cancel();
        place(c.section!, membersOf(c), c.id, { frame: s.frame, index: s.index });
        return;
    }
    end(e);
}
function frameCancel() { cancel(); frameSpot.value = null; }

const liftedIn = (c: ComponentDef) => (tdrag.value?.moved && tdrag.value.section === c.section ? tdrag.value.keys[0] : null);
const insertIn = (c: ComponentDef): number | null => {
    const t = tdrag.value;
    if (t?.moved) return t.over === c.id ? t.insertAt : null;
    const u = frameSpot.value;
    return u && u.frame === c.id ? u.display : null;
};
const ghost = computed(() => {
    const t = tdrag.value;
    if (!t?.moved) return null;
    const tiles = (views.value[t.from]?.tiles ?? []).filter(x => t.keys.includes(x.key));
    const look = sectionOf(settings.value, t.section).look;
    return { l: t.l, t: t.t, tiles, px: iconPx(look), dim: 'dim' in look ? look.dim : 100 };
});

// ---- Frame chrome ----
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
/** Every frame back to its default place; units merge back into their sections. */
function reset() {
    for (const c of components.value) {
        if (isPulled(c)) removeLayout(c.id);
        else save(c.id, { ...c.defaultLayout, enabled: layoutFor(c.id).enabled });
    }
}
function lock() { void emitDesktop(OV.setLocked, { locked: true }); }

const titleOf = (c: ComponentDef): string => frameTitle(settings.value, c, layouts.value);
const lookOf = (c: ComponentDef) => frameLook(settings.value, c, layouts.value);
// Built once per render for every frame that draws a member grid.
const grids = computed(() => {
    const out: Record<ComponentId, GridRow[]> = {};
    if (editing.value) return out;
    for (const c of components.value) {
        const look = c.section && lookOf(c);
        if (!look || look.arrange !== 'byMember' || (c.section !== 'ccParty' && c.section !== 'cooldown')) continue;
        out[c.id] = buildMemberGrid(views.value[c.id].tiles, keysOf(c), k => memberClassOf(c.section!, k), look.gap);
    }
    return out;
});
// Flow tiles carry the label their frame's look asks for.
const flowTiles = (c: ComponentDef) => {
    const look = lookOf(c);
    return views.value[c.id].tiles.map(t => ({ ...t, label: labelOf(t, look, false) }));
};
const dpsVm = (c: ComponentDef) => (useSample(c) ? samples.dps : data.dps.value);
const alertItems = (c: ComponentDef) => (useSample(c) ? samples.alerts : data.alerts.value);

const editorComps = computed(() => ids.value.map(id => ({
    id, enabled: layoutFor(id).enabled, anchor: layoutFor(id).anchor, rect: rects.value[id], docked: !!hostOf(id),
})));
const stageStyle = computed(() => ({
    width: viewport.value.w + 'px',
    height: viewport.value.h + 'px',
    transform: `scale(${scale.value})`,
    '--ov-inv': String(1 / scale.value),
    '--hl-warn': settings.value.general.warn,
    '--hl-gone': settings.value.general.gone,
    '--hl-ok': settings.value.general.ok,
}));
</script>

<template>
  <div
    ref="root" class="ov-root" :class="{ unlocked: editing }"
    @pointermove="moveTile" @pointerup="endTile" @pointercancel="cancelTile"
  >
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
          :bg="bgOf(settings, c, layouts)" :font-px="fontPxOf(settings, c)"
          :editing="editing" :sample="useSample(c)" :back="isPulled(c)"
          :clamped="rects[c.id].clamped" :dragging="drag?.id === c.id"
          :docked="!!hostOf(c.id)" :dock-target="drag?.dock === c.id"
          @down="(e, mode) => start(c.id, mode, e)" @move="frameMove" @up="frameUp" @cancel="frameCancel"
          @anchor="cycleAnchor(c.id)" @undock="undock(c.id)" @toggle="toggle(c.id)" @height="h => (heights[c.id] = h)"
          @back="recallFrame(c)"
        >
          <DpsOverlay v-if="c.kind === 'dps'" :vm="dpsVm(c)" :look="settings.dpsLook" :rows-max="layoutFor(c.id).maxRows" />
          <AlertsOverlay
            v-else-if="c.kind === 'alerts'" :items="alertItems(c)" :settings="settings.alerts"
            :anchor="layoutFor('alerts').anchor" :max-rows="layoutFor('alerts').maxRows"
          />
          <div v-if="titleOf(c)" class="ov-title" data-title>{{ titleOf(c) }}</div>
          <MemberGrid
            v-if="grids[c.id]" :rows="grids[c.id]" v-bind="tileLook(settings, c, layouts)"
            :look="lookOf(c)"
          />
          <TileGroup
            v-else-if="c.section" :tiles="flowTiles(c)" v-bind="tileLook(settings, c, layouts)" :editing="editing"
            :lifted="liftedIn(c)" :insert-at="insertIn(c)"
            @tile-down="(key, e) => tileDown(c.section!, key, e)"
          />
        </ComponentFrame>
      </LayoutEditor>
      <div v-if="ghost" class="ov-ghost" data-ghost :style="{ left: ghost.l + 'px', top: ghost.t + 'px' }">
        <TileGroup :tiles="ghost.tiles" :px="ghost.px" :dim="100" :editing="false" :lifted="null" :insert-at="null" />
      </div>
    </div>
  </div>
</template>
